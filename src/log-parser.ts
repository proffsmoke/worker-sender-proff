// log-parser.ts
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
    private logHashes: Set<string> = new Set(); // Usar Set para evitar duplicatas
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
        // Extrai informações básicas do log (queueId, email, result, message-id)
        const queueMatch = line.match(/postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<(.*)>, .*, status=(\w+)/);
        const messageIdMatch = line.match(/postfix\/cleanup\[[0-9]+\]: [A-Z0-9]+: message-id=<(.*)>/);

        if (!queueMatch) return null;

        const [, queueId, email, result] = queueMatch;
        const mailId = messageIdMatch ? messageIdMatch[1] : undefined;

        return {
            timestamp: new Date().toISOString(),
            queueId,
            email: email.trim(),
            result,
            success: result === 'sent',
            mailId,
        };
    }

    private async handleLogLine(line: string): Promise<void> {
        try {
            logger.info(`Processing log line: ${line}`);
            const logEntry = this.parseLogLine(line);
            if (!logEntry) return;

            // Usar apenas queueId e result para verificar duplicidade
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
                    // Remover hash do log mais antigo
                    this.logHashes.delete(`${oldestLog.queueId}-${oldestLog.result}`);
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
          const { queueId, success, mailId, email } = logEntry;
  
          // Atualizar estatísticas no EmailStats
          await EmailStats.incrementSent(); // Incrementa o total de emails enviados
          if (success) {
              await EmailStats.incrementSuccess(); // Incrementa os envios bem-sucedidos
          } else {
              await EmailStats.incrementFail(); // Incrementa os envios que falharam
          }
  
          // Buscar informações no EmailLog primeiro, depois no EmailQueueModel
          let emailLog = await EmailLog.findOne({ queueId });
  
          if (!emailLog) {
              // Buscar no EmailQueueModel se não encontrar no EmailLog
              const emailQueue = await EmailQueueModel.findOne({ 'queueIds.queueId': queueId });
              if (emailQueue) {
                  const associatedQueue = emailQueue.queueIds.find(q => q.queueId === queueId);
                  if (associatedQueue) {
                      emailLog = new EmailLog({
                          queueId: queueId,
                          email: associatedQueue.email,
                          mailId: emailQueue.uuid,
                          success: success,
                          sentAt: new Date()
                      });
                      await emailLog.save();
                  }
              }
          }
  
          // Emitir 'testEmailLog' se mailId estiver presente
          if (mailId) {
              this.emit('testEmailLog', { mailId, success });
          }
  
          // Atualizar log no EmailLog
          if (emailLog) {
              emailLog.success = success;
              if (mailId) emailLog.mailId = mailId;
              await emailLog.save();
              logger.info(`Log updated in EmailLog: queueId=${queueId}, mailId=${mailId}, success=${success}`);
          } else {
              logger.warn(`EmailLog not found for queueId=${queueId}.`);
          }
  
          this.emit('log', logEntry);
  
      } catch (error) {
          logger.error(`Error processing log entry: ${JSON.stringify(logEntry)}`, error);
      }
  }
  

    public getRecentLogs(): LogEntry[] {
        return this.recentLogs;
    }
}

export default LogParser;