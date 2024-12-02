import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';

class LogParser {
  private logFilePath: string;
  private tail: Tail | null = null; // Inicialize como nulo para evitar erros.
  private queueIdPromise: Promise<string | null>;
  private resolveQueueId: (queueId: string | null) => void = () => {};

  constructor(logFilePath: string = '/var/log/mail.log') {
    this.logFilePath = logFilePath;

    if (!fs.existsSync(this.logFilePath)) {
      logger.error(`Arquivo de log não encontrado no caminho: ${this.logFilePath}`);
      throw new Error(`Arquivo de log não encontrado: ${this.logFilePath}`);
    }

    this.tail = new Tail(this.logFilePath, { useWatchFile: true });
    this.queueIdPromise = new Promise((resolve) => {
      this.resolveQueueId = resolve;
    });
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

  async waitForQueueId(uuid: string): Promise<string | null> {
    const timeout = new Promise<string | null>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timeout ao capturar Queue ID para UUID: ${uuid}`));
      }, 10000); // 10 segundos
    });

    return Promise.race([this.queueIdPromise, timeout]).finally(() => this.stopMonitoring());
  }

  private handleLogLine(line: string) {
    const regex = /(?:sendmail|sm-mta)\[\d+\]: ([A-Za-z0-9]+): .*uuid=([A-Za-z0-9-]+)/;
    const match = line.match(regex);

    if (match) {
      const [_, queueId, logUuid] = match;

      if (this.resolveQueueId) {
        this.resolveQueueId(queueId);
      }
    }
  }
}

export default LogParser;
