import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';
import EmailLog from './models/EmailLog';
import EmailQueueModel from './models/EmailQueueModel';
import EmailStats from './models/EmailStats';

export interface LogEntry {
  timestamp: string;
  queueId: string;
  email: string;
  result: string;
  success: boolean;
  mailId?: string;
}

class LogParser extends EventEmitter {
  private logFilePath: string;
  private tail: Tail | null = null;
  private recentLogs: LogEntry[] = [];
  private logHashes: Set<string> = new Set();
  private readonly MAX_CACHE_SIZE = 1000;
  private isMonitoringStarted = false;

  constructor(logFilePath: string = '/var/log/mail.log') {
    super();
    this.logFilePath = logFilePath;

    if (!fs.existsSync(this.logFilePath)) {
      logger.error(`Log file not found at path: ${this.logFilePath}`);
      throw new Error(`Log file not found: ${this.logFilePath}`);
    }

    this.tail = new Tail(this.logFilePath, { useWatchFile: true });
  }

  public startMonitoring(): void {
    if (this.isMonitoringStarted) {
      logger.warn('Log monitoring already started.');
      return;
    }

    if (!this.tail) {
      logger.error('Tail not initialized.');
      return;
    }

    this.tail.on('line', this.handleLogLine.bind(this));
    this.tail.on('error', (error) => {
      logger.error('Error monitoring logs:', error);
    });

    this.isMonitoringStarted = true;
    logger.info(`Monitoring started for log file: ${this.logFilePath}`);
  }

  private parseLogLine(line: string): LogEntry | null {
    // Extrai informações completas do log
    const queueMatch = line.match(/postfix\/smtp\[\d+\]: (\w+): .* status=\w+ \((.*)\)/);
    const emailMatch = line.match(/to=<([^>]+)>/);
    const messageIdMatch = line.match(/message-id=<([^>]+)>/);

    if (!queueMatch) return null;

    const [, queueId, errorDetails] = queueMatch;
    const email = emailMatch ? emailMatch[1] : 'unknown';
    const mailId = messageIdMatch ? messageIdMatch[1] : undefined;

    return {
      timestamp: new Date().toISOString(),
      queueId,
      email,
      result: errorDetails, // Captura a mensagem completa do erro
      success: line.includes('status=sent'),
      mailId,
    };
  }

  private async handleLogLine(line: string): Promise<void> {
    try {
      logger.info(`Processing log line: ${line}`);
      const logEntry = this.parseLogLine(line);
      if (!logEntry) return;

      const logHash = `${logEntry.queueId}-${logEntry.result}`;
      if (this.logHashes.has(logHash)) {
        logger.info(`Duplicate log ignored: ${logHash}`);
        return;
      }

      this.recentLogs.push(logEntry);
      this.logHashes.add(logHash);

      if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
        const oldestLog = this.recentLogs.shift();
        if (oldestLog) {
          this.logHashes.delete(`${oldestLog.queueId}-${oldestLog.result}`);
        }
      }

      logger.info(`Parsed log entry: ${JSON.stringify(logEntry)}`);
      await this.processLogEntry(logEntry);
      this.emit('log', logEntry); // Emite o log para o BlockManagerService
    } catch (error) {
      logger.error(`Error processing log line: ${line}`, error);
    }
  }

  private async processLogEntry(logEntry: LogEntry): Promise<void> {
    try {
      const { queueId, success, mailId, email } = logEntry;
  
      await EmailStats.incrementSent();
      if (success) {
        await EmailStats.incrementSuccess();
      } else {
        await EmailStats.incrementFail();
      }
  
      // Atualiza ou cria o registro de log com base no queueId
      await EmailLog.findOneAndUpdate(
        { queueId },
        {
          $set: {
            success,
            email,
            mailId,  // Se houver necessidade de atualizar o mailId posteriormente
            sentAt: new Date()
          }
        },
        { upsert: true, new: true }
      );
      logger.info(`Log atualizado/upserted para queueId=${queueId} com success=${success}`);
  
      // Atualiza o status na fila (EmailQueueModel)
      await EmailQueueModel.updateOne(
        { "queueIds.queueId": queueId },
        { $set: { "queueIds.$.success": success } }
      );
      logger.info(`Queue atualizada: ${queueId} => ${success}`);
  
      if (mailId) {
        this.emit('testEmailLog', { mailId, success });
      }
    } catch (error) {
      logger.error(`Error processing log entry: ${JSON.stringify(logEntry)}`, error);
    }
  }
  

  public getRecentLogs(): LogEntry[] {
    return this.recentLogs;
  }
}

export default LogParser;