import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';

class LogParser {
  private logFilePath: string;
  private tail: Tail | null = null;
  private resolveQueueId: (queueId: string | null) => void = () => {};

  constructor(logFilePath: string = '/var/log/mail.log') {
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

  async waitForQueueId(queueId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger.warn(`Timeout ao capturar status para Queue ID: ${queueId}`);
        resolve('timeout');
      }, 10000);

      this.resolveQueueId = (logQueueId) => {
        if (logQueueId === queueId) {
          clearTimeout(timeout);
          resolve('sent');
        }
      };
    });
  }

  private handleLogLine(line: string) {
    const regex = /(?:sendmail|sm-mta)\[\d+\]: ([A-Za-z0-9]+): .*stat=(\w+)/;
    const match = line.match(regex);

    if (match) {
      const [_, queueId, status] = match;
      if (this.resolveQueueId) {
        this.resolveQueueId(queueId);
        logger.info(`Status do Queue ID ${queueId}: ${status}`);
      }
    }
  }
}

export default LogParser;
