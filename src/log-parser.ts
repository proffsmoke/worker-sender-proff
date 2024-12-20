import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';

interface LogEntry {
  queueId: string;
  recipient: string;
  status: string;
  messageId: string;
  dsn: string;
  message: string; // Adicionado para garantir que 'message' esteja sempre presente
}

class LogParser extends EventEmitter {
  private logFilePath: string;
  private tail: Tail | null = null;
  private queueIdToMessageId: Map<string, string> = new Map();

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
    logger.debug(`Processing log line: ${line}`); // Novo log

    // Regex para capturar a linha de cleanup que contém o Message-ID
    const cleanupRegex = /postfix\/cleanup\[\d+\]:\s+([A-Z0-9]+):\s+message-id=<([^>]+)>/i;
    // Regex para capturar a linha de smtp que contém o destinatário, status e dsn
    const smtpRegex = /postfix\/smtp\[\d+\]:\s+([A-Z0-9]+):\s+to=<([^>]+)>,.*dsn=(\d+\.\d+\.\d+),.*status=([a-z]+)/i;

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
      if (!messageId) {
        logger.warn(`No Message-ID found for Queue ID=${queueId}`);
      }

      const logEntry: LogEntry = {
        queueId,
        recipient,
        status,
        messageId,
        dsn,
        message: line, // Armazena a linha completa para análise de bloqueio
      };

      logger.debug(`LogParser captured: ${JSON.stringify(logEntry)}`);

      this.emit('log', logEntry);
    }
  }
}

export default LogParser;
