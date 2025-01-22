import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';

export interface LogEntry {
  queueId: string;
  recipient: string;
  status: string;
  messageId: string;
  dsn: string;
  message: string;
  success: boolean; // Adicionado campo success
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
    try {
      const logTimestamp = this.extractTimestamp(line);
      if (logTimestamp && logTimestamp < this.startTime) {
        return; // Ignora logs antigos
      }

      // Tenta extrair informações do log
      const logEntry = this.parseLogLine(line);
      if (logEntry) {
        logger.debug(`LogParser captured: ${JSON.stringify(logEntry)}`);
        this.emit('log', logEntry);
      }
    } catch (error) {
      logger.error(`Error processing log line: ${line}`, error);
    }
  }

  private parseLogLine(line: string): LogEntry | null {
    const cleanupRegex = /postfix\/cleanup\[\d+\]:\s+([A-Z0-9]+):\s+message-id=<([^>]+)>/i;
    const smtpRegex = /postfix\/smtp\[\d+\]:\s+([A-Z0-9]+):\s+to=<([^>]+)>,.*dsn=(\d+\.\d+\.\d+),.*status=([a-z]+)/i;
    const bounceRegex = /postfix\/bounce\[\d+\]:\s+([A-Z0-9]+):\s+sender non-delivery notification:/i;
    const deferredRegex = /postfix\/smtp\[\d+\]:\s+([A-Z0-9]+):\s+to=<([^>]+)>,.*status=deferred/i;

    let match = line.match(cleanupRegex);
    if (match) {
      const [_, queueId, messageId] = match;
      this.queueIdToMessageId.set(queueId, messageId);
      logger.debug(`Mapped Queue ID=${queueId} to Message-ID=${messageId}`);
      return null; // Não é um log de entrega, apenas mapeia o messageId
    }

    match = line.match(smtpRegex);
    if (match) {
      const [_, queueId, recipient, dsn, status] = match;
      const messageId = this.queueIdToMessageId.get(queueId) || '';

      return {
        queueId,
        recipient,
        status,
        messageId,
        dsn,
        message: line,
        success: status === 'sent', // Determina se o envio foi bem-sucedido
      };
    }

    match = line.match(bounceRegex);
    if (match) {
      const [_, queueId] = match;
      const messageId = this.queueIdToMessageId.get(queueId) || '';

      return {
        queueId,
        recipient: '',
        status: 'bounced',
        messageId,
        dsn: '5.0.0',
        message: line,
        success: false, // Bounced nunca é sucesso
      };
    }

    match = line.match(deferredRegex);
    if (match) {
      const [_, queueId, recipient] = match;
      const messageId = this.queueIdToMessageId.get(queueId) || '';

      return {
        queueId,
        recipient,
        status: 'deferred',
        messageId,
        dsn: '4.0.0',
        message: line,
        success: false, // Deferred não é sucesso
      };
    }

    return null; // Ignora logs que não correspondem a nenhum padrão
  }

  private extractTimestamp(line: string): Date | null {
    const timestampRegex = /(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/;
    const match = line.match(timestampRegex);
    if (match) {
      const timestampStr = match[0];
      const currentYear = new Date().getFullYear();
      return new Date(`${timestampStr} ${currentYear}`);
    }
    return null;
  }
}

export default LogParser;