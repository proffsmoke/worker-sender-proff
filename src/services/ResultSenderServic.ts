import axios, { AxiosInstance, AxiosError } from 'axios';
import { z } from 'zod';
import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';
import util from 'util';

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
  lastError?: string;
  errorDetails?: string;
  retryCount?: number;
}

interface ResultItem {
  queueId: string;
  email: string;
  success: boolean;
  data?: unknown;
}

const ResultItemSchema = z.object({
  queueId: z.string(),
  email: z.string().email(),
  success: z.boolean(),
  data: z.unknown().optional(),
});

const PayloadSchema = z.object({
  uuid: z.string(),
  results: z.array(ResultItemSchema),
});

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
    logger.debug(`Selecionado o domínio: ${domain}`);
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
      timeout: 15000,
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
    if (this.isSending) return;
    this.isSending = true;

    try {
      const emailQueues = await EmailQueueModel.find({
        'queueIds.success': { $exists: true, $ne: null },
        resultSent: false,
      }).lean();

      const resultsByUuid: Record<string, ResultItem[]> = {};

      for (const emailQueue of emailQueues) {
        const { uuid, queueIds } = emailQueue;
        const validQueueIds = queueIds.filter((q: QueueItem) => q.success !== null);

        resultsByUuid[uuid] = [
          ...(resultsByUuid[uuid] || []),
          ...validQueueIds.map((q: QueueItem) => ({
            queueId: q.queueId,
            email: q.email,
            success: q.success!,
            data: q.data,
          }))
        ];
      }

      for (const [uuid, results] of Object.entries(resultsByUuid)) {
        if (results.length > 0) {
          await this.validateAndSendResults(uuid, results);
        }
      }
    } catch (error) {
      const { message, stack } = this.getErrorDetails(error);
      logger.error(`Erro ao processar resultados: ${message}`, { stack });
    } finally {
      this.isSending = false;
    }
  }

  private async validateAndSendResults(uuid: string, results: ResultItem[]): Promise<void> {
    try {
      const payload = {
        uuid,
        results: results.map(r => ({
          queueId: r.queueId,
          email: r.email,
          success: r.success,
          data: r.data,
        })),
      };

      const validatedPayload = PayloadSchema.safeParse(payload);
      if (!validatedPayload.success) {
        logger.error('Validação falhou:', validatedPayload.error);
        throw new Error(`Payload inválido: ${validatedPayload.error}`);
      }

      const currentDomain = this.domainStrategy.getNextDomain();
      const url = `${currentDomain}/api/results`;

      logger.info(`Enviando para: ${url}`, payload);
      const response = await this.axiosInstance.post(url, validatedPayload.data);

      await EmailQueueModel.updateMany(
        { uuid },
        { $set: { resultSent: true, lastUpdated: new Date() } }
      );

      logger.info(`Sucesso: ${uuid} (${results.length} resultados)`);

    } catch (error) {
      const errorDetails = this.getAxiosErrorDetails(error);
      logger.error(`Falha no envio: ${uuid}`, {
        error: errorDetails.message,
        url: errorDetails.config?.url,
      });

      await EmailQueueModel.updateMany(
        { uuid },
        {
          $set: {
            lastError: errorDetails.message.slice(0, 200),
            errorDetails: JSON.stringify(errorDetails.response?.data || {}).slice(0, 500),
          },
          $inc: { retryCount: 1 },
        }
      );
    }
  }

  private getErrorDetails(error: unknown): { message: string; stack?: string } {
    return error instanceof Error 
      ? { message: error.message, stack: error.stack }
      : { message: 'Erro desconhecido' };
  }

  private getAxiosErrorDetails(error: unknown): any {
    return axios.isAxiosError(error)
      ? {
          message: error.message,
          code: error.code,
          config: error.config,
          response: error.response?.data,
        }
      : this.getErrorDetails(error);
  }
}

export default ResultSenderService;