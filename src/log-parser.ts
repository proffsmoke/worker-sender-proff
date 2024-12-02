// LogParser.js
import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';

interface LogEntry {
  queueId: string;
  recipient: string;
  status: string;
  messageId: string;
}

class LogParser extends EventEmitter {
  private logFilePath: string;
  private tail: Tail | null = null;

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

  stopMonitoring() {
    if (this.tail) {
      this.tail.unwatch();
      logger.info('Log monitoring stopped.');
    } else {
      logger.warn('No active monitoring to stop.');
    }
  }

  private handleLogLine(line: string) {
    const regex = /postfix\/smtp\[\d+\]:\s+([A-Z0-9]+):\s+to=<([^>]+)>,.*status=([a-z]+).*<([^>]+)>/i;
    const match = line.match(regex);

    if (match) {
      const [_, queueId, recipient, status, messageId] = match as RegExpMatchArray;

      const logEntry: LogEntry = {
        queueId,
        recipient,
        status,
        messageId,
      };

      logger.info(`LogParser captured: Queue ID=${queueId}, Recipient=${recipient}, Status=${status}, Message-ID=${messageId}`);

      this.emit('log', logEntry);
    }
  }
}

export default LogParser;
