import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';
import path from 'path';

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
  private MAX_CACHE_SIZE = 1000;
  private isMonitoringStarted: boolean = false;

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
      const stackTrace = new Error().stack;
      const callerInfo = this.getCallerInfo(stackTrace);
      logger.warn(`Monitoramento de logs já iniciado. Chamado por: ${callerInfo}`);
      return;
    }

    if (!this.tail) {
      logger.error('Attempting to monitor logs without initializing Tail.');
      return;
    }

    this.tail.on('line', this.handleLogLine.bind(this));
    this.tail.on('error', (error) => {
      logger.error('Error monitoring logs:', error);
    });

    this.isMonitoringStarted = true;
    logger.info(`Monitoring log file: ${this.logFilePath}`);
  }

  private getCallerInfo(stackTrace: string | undefined): string {
    if (!stackTrace) return 'Desconhecido';

    const stackLines = stackTrace.split('\n');
    if (stackLines.length >= 4) {
      const callerLine = stackLines[3].trim();
      const match = callerLine.match(/at (.+) \((.+):(\d+):(\d+)\)/);
      if (match) {
        const [, functionName, filePath, line, column] = match;
        const fileName = path.basename(filePath);
        return `${functionName} (${fileName}:${line}:${column})`;
      }
    }

    return 'Desconhecido';
  }

  private handleLogLine(line: string): void {
    try {
      const logEntry = this.parseLogLine(line);
      if (logEntry) {
        const logHash = `${logEntry.timestamp}-${logEntry.queueId}-${logEntry.result}`;

        if (this.logHashes.has(logHash)) {
          logger.info(`Log duplicado ignorado: ${logHash}`);
          return;
        }

        this.recentLogs.push(logEntry);
        this.logHashes.add(logHash);

        if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
          const oldestLog = this.recentLogs.shift();
          if (oldestLog) {
            const oldestHash = `${oldestLog.timestamp}-${oldestLog.queueId}-${oldestLog.result}`;
            this.logHashes.delete(oldestHash);
          }
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

    // Extrai o mailId da linha do log, se disponível
    const mailIdMatch = line.match(/message-id=<(.*)>/);
    const mailId = mailIdMatch ? mailIdMatch[1] : undefined;

    return {
      timestamp: new Date().toISOString(),
      queueId,
      email: email.trim(),
      result,
      success: result.startsWith('sent'),
      mailId,
    };
  }

  public getRecentLogs(): LogEntry[] {
    return this.recentLogs;
  }
}

export default LogParser;
