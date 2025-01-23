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
}

class LogParser extends EventEmitter {
  private logFilePath: string;
  private tail: Tail | null = null;
  private recentLogs: LogEntry[] = []; // Cache para evitar duplicados
  private MAX_CACHE_SIZE = 1000; // Aumentando o tamanho do cache
  private isMonitoringStarted: boolean = false; // Flag para evitar inicialização dupla

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

    // Verifica se o monitoramento já foi iniciado
    if (this.isMonitoringStarted) {
      const stackTrace = new Error().stack; // Captura a stack trace
      const callerInfo = this.getCallerInfo(stackTrace); // Extrai informações do chamador
      logger.warn(`Monitoramento de logs já iniciado. Chamado por: ${callerInfo}`);
      return;
    }

    this.tail.on('line', this.handleLogLine.bind(this));
    this.tail.on('error', (error) => {
      logger.error('Error monitoring logs:', error);
    });

    this.isMonitoringStarted = true; // Marca como iniciado
    logger.info(`Monitoring log file: ${this.logFilePath}`);
  }

  private getCallerInfo(stackTrace: string | undefined): string {
    if (!stackTrace) return 'Desconhecido';

    // Divide a stack trace em linhas
    const stackLines = stackTrace.split('\n');

    // A linha 3 da stack trace contém informações sobre o chamador
    if (stackLines.length >= 4) {
      const callerLine = stackLines[3].trim();
      const match = callerLine.match(/at (.+) \((.+):(\d+):(\d+)\)/);
      if (match) {
        const [, functionName, filePath, line, column] = match;
        const fileName = path.basename(filePath); // Extrai o nome do arquivo
        return `${functionName} (${fileName}:${line}:${column})`;
      }
    }

    return 'Desconhecido';
  }

  private handleLogLine(line: string) {
    try {
      const logEntry = this.parseLogLine(line);
      if (logEntry) {
        const logHash = `${logEntry.timestamp}-${logEntry.queueId}-${logEntry.result}`;

        // Verifica se o log já está no cache
        if (this.recentLogs.some(log => `${log.timestamp}-${log.queueId}-${log.result}` === logHash)) {
          logger.info(`Log duplicado ignorado: ${logHash}`);
          return;
        }

        // Adiciona ao cache
        this.recentLogs.push(logEntry);
        if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
          this.recentLogs.shift(); // Remove o log mais antigo
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