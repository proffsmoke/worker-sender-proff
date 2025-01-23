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
        // Log analisado em tempo real
        logger.info(`Log analisado com sucesso: ${JSON.stringify(logEntry)}`);
  
        // Emite o log para que o MailerService possa processá-lo
        this.emit('log', logEntry);
      } else {
        logger.warn(`Formato de linha de log não reconhecido: ${line}`);
      }
    } catch (error) {
      logger.error(`Erro ao processar linha de log: ${line}`, error);
    }
  }
  
  private parseLogLine(line: string): LogEntry | null {
    // Regex aprimorado para capturar diferentes variações de log
    const match = line.match(/postfix\/([a-z]+)\[[0-9]+\]: ([A-Z0-9]+): (.*?)(status=[^,]+)?/);
    if (!match) {
      logger.warn(`Formato de linha de log não reconhecido: ${line}`);
      return null;
    }
  
    const [, process, queueId, details, status] = match;
    let result = details;
  
    // Caso tenha a parte do status, tenta capturar e usar como resultado
    if (status) {
      result = status.split('=')[1].trim();
    }
  
    return {
      timestamp: new Date().toISOString(),
      queueId,
      email: result.includes('to=') ? result.split('to=')[1].split(',')[0].trim() : '',
      result,
      success: result.startsWith('sent') || result.includes('queued'), // Considera 'sent' ou 'queued' como sucesso
    };
  }
  
}

export default LogParser;
