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
      logger.error(`Arquivo de log não encontrado no caminho: ${this.logFilePath}`);
      throw new Error(`Arquivo de log não encontrado: ${this.logFilePath}`);
    }

    this.tail = new Tail(this.logFilePath, { useWatchFile: true });
  }

  startMonitoring() {
    if (!this.tail) {
      logger.error('Tentativa de monitorar logs sem inicializar o Tail.');
      return;
    }

    this.tail.on('line', this.handleLogLine.bind(this));
    this.tail.on('error', (error) => {
      logger.error('Erro ao monitorar os logs:', error);
    });

    logger.info(`Monitorando o arquivo de log: ${this.logFilePath}`);
  }

  stopMonitoring() {
    if (this.tail) {
      this.tail.unwatch();
      logger.info('Monitoramento de logs interrompido.');
    } else {
      logger.warn('Nenhum monitoramento ativo para interromper.');
    }
  }

  private handleLogLine(line: string) {
    // Regex atualizado para capturar Queue ID, recipient, status e Message-ID
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

      logger.info(`LogParser capturou: Queue ID=${queueId}, Recipient=${recipient}, Status=${status}, Message-ID=${messageId}`);

      // Emitir um evento com os detalhes do logEntry
      this.emit('log', logEntry);
    }
  }
}

export default LogParser;
