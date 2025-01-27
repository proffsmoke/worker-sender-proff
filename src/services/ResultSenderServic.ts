import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';

interface QueueItem {
  queueId: string;
  email: string;
  success: boolean | null;
  data?: unknown;
}

interface EmailQueue {
  uuid: string;
  queueIds: QueueItem[];
  resultSent: boolean;
}

interface ResultItem {
  queueId: string;
  email: string;
  success: boolean;
  data?: unknown;
}

const DOMAINS = ['http://localhost:4008'];

class DomainStrategy {
  private domains: string[];
  private currentIndex: number;

  constructor(domains: string[]) {
    this.domains = domains;
    this.currentIndex = 0;
  }

  public getNextDomain(): string {
    const domain = this.domains[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.domains.length;
    return domain;
  }
}

export class ResultSenderService {
  private interval: NodeJS.Timeout | null = null;
  private isSending: boolean = false;
  private domainStrategy: DomainStrategy;
  private axiosInstance: AxiosInstance;

  constructor() {
    this.domainStrategy = new DomainStrategy(DOMAINS);
    this.axiosInstance = axios.create({
      timeout: 8000,
      headers: { 'Content-Type': 'application/json' },
    });
    this.start();
  }

  public start(): void {
    if (this.interval) {
      logger.warn('O serviço ResultSenderService já está em execução.');
      return;
    }

    this.interval = setInterval(() => this.processResults(), 10000);
    logger.info('ResultSenderService iniciado.');
  }

  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('ResultSenderService parado.');
    }
  }

  private async processResults(): Promise<void> {
    if (this.isSending) {
      logger.info('ResultSenderService já está processando resultados. Aguardando...');
      return;
    }

    this.isSending = true;

    try {
      logger.info('Iniciando busca de registros no banco de dados...');
      const emailQueues = await EmailQueueModel.find({
        'queueIds.success': { $exists: true, $ne: null },
        resultSent: false,
      });

      logger.info(`Encontrados ${emailQueues.length} registros para processar.`);

      const resultsByUuid: Record<string, ResultItem[]> = {};

      for (const emailQueue of emailQueues) {
        const { uuid, queueIds } = emailQueue;
        logger.info(`Processando emailQueue com uuid: ${uuid}`);

        const results: ResultItem[] = queueIds
          .filter((q: QueueItem) => q.success !== null)
          .map((q: QueueItem) => ({
            queueId: q.queueId,
            email: q.email,
            success: q.success!,
            data: q.data
          }));

        if (results.length > 0) {
          resultsByUuid[uuid] = [...(resultsByUuid[uuid] || []), ...results];
        }
      }

      for (const [uuid, results] of Object.entries(resultsByUuid)) {
        if (results.length === 0) continue;
        await this.sendResults(uuid, results);
      }
    } catch (error) {
      const { message, stack } = this.getErrorDetails(error);
      logger.error(`Erro ao processar resultados: ${message}`, { stack });
    } finally {
      this.isSending = false;
      logger.info('Processamento de resultados concluído.');
    }
  }

  private async sendResults(uuid: string, results: ResultItem[]): Promise<void> {
    try {
      const payload = {
        fullPayload: {
          uuid,
          results: results.map(r => ({
            queueId: r.queueId,
            email: r.email,
            success: r.success,
            data: r.data
          })),
        },
      };

      const currentDomain = this.domainStrategy.getNextDomain();
      const url = `${currentDomain}/api/results`;

      logger.info(`Enviando para: ${url}`);

      const response = await this.axiosInstance.post(url, payload);

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      await EmailQueueModel.updateMany(
        { uuid },
        { 
          $set: { 
            resultSent: true,
            lastUpdated: new Date()
          }
        }
      );

      logger.info(`Sucesso no envio: ${uuid} (${results.length} resultados)`);

    } catch (error) {
      const errorDetails = this.getErrorDetails(error);
      const truncatedError = errorDetails.message.slice(0, 200);
      
      logger.error(`Falha no envio: ${uuid}`, {
        error: truncatedError,
        stack: errorDetails.stack?.split('\n').slice(0, 3).join(' ')
      });

      await EmailQueueModel.updateMany(
        { uuid },
        {
          $set: {
            lastError: truncatedError,
            errorDetails: JSON.stringify(errorDetails).slice(0, 500)
          },
          $inc: { retryCount: 1 }
        }
      );
    }
  }

  private getErrorDetails(error: unknown): { message: string; stack?: string } {
    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack
      };
    }
    return {
      message: 'Erro desconhecido'
    };
  }
}

export default ResultSenderService;