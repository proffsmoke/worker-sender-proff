import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';

interface QueueItem {
  queueId: string;
  email: string;
  success: boolean | null;
  data?: unknown;
}

interface ResultItem {
  queueId: string;
  email: string;
  success: boolean;
  data?: unknown;
}

const PayloadSchema = z.object({
  uuid: z.string().uuid(), // Validação de UUID
  results: z.array(
    z.object({
      queueId: z.string(),
      email: z.string().email(), // Validação de e-mail
      success: z.boolean(),
      data: z.unknown().optional(),
    })
  ),
});

const DOMAINS = ['https://sender2.construcoesltda.com'];

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
          })),
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
      const payload = { uuid, results };

      const validatedPayload = PayloadSchema.safeParse(payload);
      if (!validatedPayload.success) {
        const validationError = validatedPayload.error.format();
        logger.error('Falha na validação do payload:', validationError);
        throw new Error(`Payload inválido: ${JSON.stringify(validationError)}`);
      }

      const currentDomain = this.domainStrategy.getNextDomain();
      const url = `${currentDomain}/api/results`;

      logger.info(`Enviando para: ${url}`, validatedPayload.data);
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
