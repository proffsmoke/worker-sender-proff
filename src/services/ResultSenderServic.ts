import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';

const PayloadSchema = z.object({
  uuid: z.string().uuid(),
  results: z.array(
    z.object({
      queueId: z.string(),
      email: z.string().email(),
      success: z.boolean(),
      data: z.unknown().optional(),
    })
  ),
});

const DOMAINS = ['http://localhost:4008'];

class DomainStrategy {
  private domains: string[];
  private currentIndex: number = 0;

  constructor(domains: string[]) {
    this.domains = domains;
  }

  public getNextDomain(): string {
    const domain = this.domains[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.domains.length;
    logger.debug(`Domínio selecionado: ${domain}`);
    return domain;
  }
}

export class ResultSenderService {
  private domainStrategy: DomainStrategy;
  private axiosInstance: AxiosInstance;

  constructor() {
    this.domainStrategy = new DomainStrategy(DOMAINS);
    this.axiosInstance = axios.create({
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  public async sendResults(uuid: string, results: any[]): Promise<void> {
    try {
      const payload = { uuid, results };

      // Validação do payload
      const validatedPayload = PayloadSchema.safeParse(payload);
      if (!validatedPayload.success) {
        const validationError = validatedPayload.error.format();
        logger.error('Payload inválido:', validationError);
        throw new Error(`Payload inválido: ${JSON.stringify(validationError)}`);
      }

      const currentDomain = this.domainStrategy.getNextDomain();
      const url = `${currentDomain}/api/results`;

      logger.info(`Enviando payload para: ${url}`, validatedPayload.data);

      const response = await this.axiosInstance.post(url, validatedPayload.data);
      logger.info(`Resposta recebida: ${response.status} - ${response.statusText}`);
    } catch (error) {
      const errorDetails = this.getAxiosErrorDetails(error);
      logger.error(`Erro ao enviar resultados`, {
        uuid,
        message: errorDetails.message,
        url: errorDetails.config?.url,
        response: errorDetails.response || 'Sem resposta do servidor',
      });
    }
  }

  private getAxiosErrorDetails(error: unknown): any {
    return axios.isAxiosError(error)
      ? {
          message: error.message,
          code: error.code,
          config: error.config,
          response: error.response?.data,
        }
      : { message: 'Erro desconhecido', ...(error instanceof Error ? { stack: error.stack } : {}) };
  }
}

export default ResultSenderService;
