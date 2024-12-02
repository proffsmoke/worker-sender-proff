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

    this.tail = new Tail(this.logFilePath, { useWatchFile: true, follow: true, logger: console });
  }

  startMonitoring() {
    if (!this.tail) {
      logger.error('Attempted to monitor logs without initializing Tail.');
      return;
    }

    this.tail.on('line', this.handleLogLine.bind(this));
    this.tail.on('error', (error) => {
      logger.error('Error while monitoring logs:', error);
    });

    logger.info(`Monitoring log file: ${this.logFilePath}`);
  }

  stopMonitoring() {
    if (this.tail) {
      this.tail.unwatch();
      logger.info('Stopped log monitoring.');
    } else {
      logger.warn('No active log monitoring to stop.');
    }
  }

  private handleLogLine(line: string) {
    // Enhanced Regex to capture various statuses
    const regex = /postfix\/smtp\[\d+\]:\s+([A-Z0-9]+):\s+to=<([^>]+)>,.*status=(\w+).*<([^>]+)>/i;
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

      // Emit an event with the log entry details
      this.emit('log', logEntry);
    }
  }
}

export default LogParser;
