import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';

export interface LogEntry {
  timestamp: string;
  queueId: string;
  email: string;
  result: string;
  success: boolean;
}

class LogParser extends EventEmitter {
  private logFilePath: string;
  private tail: Tail | null = null;
  private recentLogs: LogEntry[] = []; // Cache para evitar duplicados
  private MAX_CACHE_SIZE = 1000; // Aumentando o tamanho do cache

  constructor(logFilePath: string = '/var/log/mail.log') {
    super();
    this.logFilePath = logFilePath;

    if (!fs.existsSync(this.logFilePath)) {
      logger.error(`Log file not found at path: ${this.logFilePath}`);
      throw new Error(`Log file not found: ${this.logFilePath}`);
    }

    this.tail = new Tail(this.logFilePath, { useWatchFile: true });
  }

  startMonitoring() {
    if (!this.tail) {
      logger.error('Attempting to monitor logs without initializing Tail.');
      return;
    }

    this.tail.on('line', this.handleLogLine.bind(this));
    this.tail.on('error', (error) => {
      logger.error('Error monitoring logs:', error);
    });

    logger.info(`Monitoring log file: ${this.logFilePath}`);
  }

  private handleLogLine(line: string) {
    try {
      const logEntry = this.parseLogLine(line);
      if (logEntry) {
        const logHash = `${logEntry.timestamp}-${logEntry.queueId}-${logEntry.result}`;
        if (this.recentLogs.some(log => `${log.timestamp}-${log.queueId}-${log.result}` === logHash)) {
          // Ignorar logs duplicados
          logger.info(`Log duplicado ignorado: ${logHash}`);
          return;
        }

        // Adicionar ao cache
        this.recentLogs.push(logEntry);
        if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
          // Remover o log mais antigo do cache
          this.recentLogs.shift();
        }

        logger.info(`Log analisado: ${JSON.stringify(logEntry)}`);
        this.emit('log', logEntry);
      }
    } catch (error) {
      logger.error(`Erro ao processar a linha do log: ${line}`, error);
    }
  }

  private parseLogLine(line: string): LogEntry | null {
    const match = line.match(/postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<(.*)>, .*, status=(.*)/);
    if (!match) return null;

    const [, queueId, email, result] = match;

    return {
      timestamp: new Date().toISOString(),
      queueId,
      email: email.trim(),
      result,
      success: result.startsWith('sent'), // Sucesso se o resultado começar com "sent"
    };
  }

  public getRecentLogs(): LogEntry[] {
    return this.recentLogs;
  }
}
export default LogParser;