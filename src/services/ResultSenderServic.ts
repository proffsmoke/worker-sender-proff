import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';

// Interfaces e esquemas de validação
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

const ResultItemSchema = z.object({
  queueId: z.string(),
  email: z.string().email(),
  success: z.boolean(),
  data: z.unknown().optional(),
});

const PayloadSchema = z.object({
  fullPayload: z.object({
    uuid: z.string(),
    results: z.array(ResultItemSchema),
  }),
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
            data: q.data,
          }));

        if (results.length > 0) {
          resultsByUuid[uuid] = [...(resultsByUuid[uuid] || []), ...results];
        }
      }

      for (const [uuid, results] of Object.entries(resultsByUuid)) {
        if (results.length === 0) continue;
        await this.validateAndSendResults(uuid, results);
      }
    } catch (error) {
      const { message, stack } = this.getErrorDetails(error);
      logger.error(`Erro ao processar resultados: ${message}`, { stack });
    } finally {
      this.isSending = false;
      logger.info('Processamento de resultados concluído.');
    }
  }

  private async validateAndSendResults(uuid: string, results: ResultItem[]): Promise<void> {
    try {
      logger.info(`Validando payload para uuid: ${uuid}`);

      const payload = {
        fullPayload: {
          uuid,
          results: results.map((r) => ({
            queueId: r.queueId,
            email: r.email,
            success: r.success,
            data: r.data,
          })),
        },
      };

      // Validação do payload com Zod
      const validatedPayload = PayloadSchema.safeParse(payload);

      if (!validatedPayload.success) {
        logger.error(`Payload inválido: ${validatedPayload.error.message}`);
        return;
      }

      const currentDomain = this.domainStrategy.getNextDomain();
      const url = `${currentDomain}/api/results`;

      logger.info(`Enviando payload para URL: ${url}`);

      const response = await this.axiosInstance.post(url, validatedPayload.data);

      if (response.status !== 200) {
        throw new Error(`Erro HTTP ${response.status}: ${response.statusText}`);
      }

      logger.info(`Envio bem-sucedido para uuid: ${uuid}. Atualizando registros no banco de dados.`);

      await EmailQueueModel.updateMany(
        { uuid },
        {
          $set: {
            resultSent: true,
            lastUpdated: new Date(),
          },
        },
      );
    } catch (error) {
      const errorDetails = this.getErrorDetails(error);
      logger.error(`Erro no envio para uuid: ${uuid}`, {
        message: errorDetails.message,
        stack: errorDetails.stack,
      });

      await EmailQueueModel.updateMany(
        { uuid },
        {
          $set: {
            lastError: errorDetails.message,
            errorDetails: JSON.stringify(errorDetails),
          },
          $inc: { retryCount: 1 },
        },
      );
    }
  }

  private getErrorDetails(error: unknown): { message: string; stack?: string } {
    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack,
      };
    }
    return {
      message: 'Erro desconhecido',
    };
  }
}

export default ResultSenderService;
