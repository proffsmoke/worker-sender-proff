import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';

export interface LogEntry {
  timestamp: string; // Timestamp do log
  mailId: string; // ID do e-mail (queueId)
  email: string; // Endereço de e-mail do destinatário
  result: string; // Resultado do envio (status)
  success: boolean; // Indica se o envio foi bem-sucedido
  queueId: string
}

class LogParser extends EventEmitter {
  private logFilePath: string;
  private tail: Tail | null = null;
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
    const match = line.match(/postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<(.*)>, .*, status=(.*)/);
    if (!match) return null;

    const [, mailId, email, result] = match;

    // Extração do queueId da resposta "queued as"
    const queueIdMatch = result.match(/queued as\s([A-Z0-9]+)/);
    const queueId = queueIdMatch ? queueIdMatch[1] : '';  // Captura o queueId após 'queued as'

    const isBulk = email.includes(',');
    const emails = isBulk ? email.split(',') : [email];

    console.log('Log analisado:', { mailId, queueId, email, result }); // Log para verificar o conteúdo extraído

    return {
        timestamp: new Date().toISOString(),
        mailId,
        queueId, // Inclui o queueId no objeto
        email: emails[0].trim(),
        result,
        success: result.startsWith('sent'),
    };
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
