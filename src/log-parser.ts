import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';

// Definir e exportar a interface LogEntry
export interface LogEntry {
  queueId: string;
  recipient: string;
  status: string;
  messageId: string;
  dsn: string;
  message: string;
}

class LogParser extends EventEmitter {
  private logFilePath: string;
  private tail: Tail | null = null;
  private queueIdToMessageId: Map<string, string> = new Map();
  private startTime: Date;

  constructor(logFilePath: string = '/var/log/mail.log') {
    super();
    this.logFilePath = logFilePath;
    this.startTime = new Date();

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

  stopMonitoring() {
    if (this.tail) {
      this.tail.unwatch();
      logger.info('Log monitoring stopped.');
    } else {
      logger.warn('No active monitoring to stop.');
    }
  }

  private handleLogLine(line: string) {
    const logTimestamp = this.extractTimestamp(line);
    if (logTimestamp && logTimestamp < this.startTime) {
      return;
    }

    const smtpRegex = /postfix\/smtp\[\d+\]:\s+([A-Z0-9]+):\s+to=<([^>]+)>,.*dsn=(\d+\.\d+\.\d+),.*status=([a-z]+)/i;
    const cleanupRegex = /postfix\/cleanup\[\d+\]:\s+([A-Z0-9]+):\s+message-id=<([^>]+)>/i;

    let match = line.match(cleanupRegex);
    if (match) {
      const [_, queueId, messageId] = match;
      this.queueIdToMessageId.set(queueId, messageId);
      logger.debug(`Mapped Queue ID=${queueId} to Message-ID=${messageId}`);
      return;
    }

    match = line.match(smtpRegex);
    if (match) {
      const [_, queueId, recipient, dsn, status] = match;
      const messageId = this.queueIdToMessageId.get(queueId) || '';

      const logEntry: LogEntry = {
        queueId,
        recipient,
        status,
        messageId,
        dsn,
        message: line,
      };

      logger.debug(`LogParser captured: ${JSON.stringify(logEntry)}`);

      this.emit('log', logEntry);
    }
  }

  private extractTimestamp(line: string): Date | null {
    const timestampRegex = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/;
    const match = line.match(timestampRegex);
    if (match) {
      return new Date(match[1]);
    }
    return null;
  }
}

export default LogParser;