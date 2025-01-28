import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';
import path from 'path';
import EmailLog from './models/EmailLog'; // Modelo para salvar logs
import EmailQueueModel from './models/EmailQueueModel'; // Modelo para buscar email associado ao queueId e mailId

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
    // Extrai informações básicas do log (queueId, email, result)
    const queueMatch = line.match(/postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<(.*)>, .*, status=(\w+)/);
    
    // **Modificado para extrair mailId após o log de 'removed'**
    const mailIdMatch = line.match(/postfix\/qmgr\[.*\]: ([A-Z0-9]+): removed/);

    if (!queueMatch) return null;

    const [, queueId, email, result] = queueMatch;
    // **mailId agora é extraído de outra linha que contém 'removed'**
    const mailId = mailIdMatch ? mailIdMatch[1] : undefined;

    return {
      timestamp: new Date().toISOString(),
      queueId,
      email: email.trim(),
      result,
      success: result === 'sent',
      mailId, // Adiciona o mailId ao objeto LogEntry
    };
  }

  private async handleLogLine(line: string): Promise<void> {
    try {
      logger.info(`Processing log line: ${line}`);
      const logEntry = this.parseLogLine(line);
      if (!logEntry) return;

      const logHash = `${logEntry.timestamp}-${logEntry.queueId}-${logEntry.result}`;
      if (this.logHashes.has(logHash)) {
        logger.info(`Duplicate log ignored: ${logHash}`);
        return;
      }

      this.recentLogs.push(logEntry);
      this.logHashes.add(logHash);

      if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
        const oldestLog = this.recentLogs.shift();
        if (oldestLog) {
          this.logHashes.delete(`${oldestLog.timestamp}-${oldestLog.queueId}-${oldestLog.result}`);
        }
      }

      logger.info(`Parsed log entry: ${JSON.stringify(logEntry)}`);
      await this.processLogEntry(logEntry);
    } catch (error) {
      logger.error(`Error processing log line: ${line}`, error);
    }
  }

  private async processLogEntry(logEntry: LogEntry): Promise<void> {
    try {
      const { queueId, success, mailId } = logEntry;

      // **Modificado para buscar pelo mailId no EmailQueueModel e no EmailLog**
      const emailQueue = await EmailQueueModel.findOne({ 'queueIds.queueId': queueId });
      const emailLog = await EmailLog.findOne({ mailId });
      
      // **Emitir 'testEmailLog' se mailId estiver presente (indicando um possível email de teste)**
      if (mailId) {
        this.emit('testEmailLog', { mailId, success });
      }
      
      if (!emailQueue && !emailLog) {
        logger.warn(`EmailQueue and EmailLog not found for queueId=${queueId} and mailId=${mailId}`);
        return;
      }

      // **Obter o email correto do EmailLog, se disponível, senão do EmailQueueModel**
      const email = emailLog ? emailLog.email : (emailQueue ? emailQueue.queueIds.find((q) => q.queueId === queueId)?.email : undefined);

      if (!email) {
        logger.error(`Email not found for queueId=${queueId} and mailId=${mailId}. Skipping log save.`);
        return;
      }

      // **Usar mailId do logEntry, se disponível**
      const logMailId = mailId || emailQueue?.uuid;

      // Atualizar log no EmailLog
      await this.saveOrUpdateEmailLog(queueId, email, logMailId, success, logEntry.timestamp);

    } catch (error) {
      logger.error(`Error processing log entry: ${JSON.stringify(logEntry)}`, error);
    }
  }

  private async saveOrUpdateEmailLog(
    queueId: string,
    email: string,
    mailId: string | undefined, // Agora aceita undefined
    success: boolean,
    timestamp: string
  ): Promise<void> {
    try {
      // **Verificação se mailId é undefined**
      if (!mailId) {
        logger.warn(`mailId is undefined for queueId=${queueId}. Log will be saved without mailId.`);
      }

      const existingLog = await EmailLog.findOne({ mailId });
      if (existingLog) {
        // Atualizar log existente
        existingLog.success = success;
        existingLog.email = email; // Atualiza o email para o correto
        existingLog.queueId = queueId;
        await existingLog.save();
        logger.info(`Log updated in EmailLog: queueId=${queueId}, mailId=${mailId}`);
      } else {
        // Criar novo log
        // **Verificação se mailId é undefined ao criar novo log**
        const emailLog = new EmailLog({
          mailId: mailId || null, // Se mailId for undefined, salva como null
          queueId,
          email,
          success,
          sentAt: new Date(timestamp),
        });
        await emailLog.save();
        logger.info(`Log saved in EmailLog: queueId=${queueId}, mailId=${mailId}`);
      }
    } catch (error) {
      logger.error(`Error saving/updating log in EmailLog for queueId=${queueId}, mailId=${mailId}:`, error);
    }
  }

  public getRecentLogs(): LogEntry[] {
    return this.recentLogs;
  }
}

export default LogParser;