import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';

class LogParser {
  private logFilePath: string;
  private tail: Tail | null = null;
  private queueIdStatuses: Record<string, string> = {};
  private resolveStatusMap: Map<string, (status: string) => void> = new Map();

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

  waitForQueueId(queueId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.queueIdStatuses[queueId]) {
          resolve(this.queueIdStatuses[queueId]);
        } else {
          logger.warn(`Timeout ao capturar status para Queue ID: ${queueId}`);
          resolve('timeout');
        }
      }, 10000); // 10 segundos

      this.resolveStatusMap.set(queueId, (status) => {
        clearTimeout(timeout);
        resolve(status);
      });
    });
  }

  private handleLogLine(line: string) {
    // Regex atualizado para Postfix SMTP logs
    const regex = /postfix\/smtp\[\d+\]:\s+([A-Z0-9]+):.*status=(\w+)/i;
    const match = line.match(regex);

    if (match) {
      const [_, queueId, status] = match;

      // Atualiza o status para o Queue ID
      this.queueIdStatuses[queueId] = status;

      // Resolve as promessas esperando por este Queue ID
      if (this.resolveStatusMap.has(queueId)) {
        this.resolveStatusMap.get(queueId)?.(status);
        this.resolveStatusMap.delete(queueId);
      }

      logger.info(`Status do Queue ID ${queueId}: ${status}`);
    }
  }
}

export default LogParser;
