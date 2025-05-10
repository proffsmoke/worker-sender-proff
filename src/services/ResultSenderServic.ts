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

const logPrefix = '[resultservice]';
const DOMAINS = ['https://sender.construcoesltda.com'];

const PayloadSchema = z.object({
  uuid: z.string().uuid(),
  results: z.array(
    z.object({
      queueId: z.string().min(1, "ID da fila inválido"),
      email: z.string().email("Formato de e-mail inválido"),
      success: z.boolean(),
      data: z.unknown().optional(),
    })
  ).nonempty("A lista de resultados não pode estar vazia"),
});

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
    logger.debug(`${logPrefix} Domínio selecionado: ${domain}`);
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
      logger.warn(`${logPrefix} Serviço já está em execução`);
      return;
    }

    this.interval = setInterval(() => this.processResults(), 10000);
    logger.info(`${logPrefix} Serviço iniciado com intervalo de 10s`);
  }

  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info(`${logPrefix} Serviço parado`);
    }
  }

  // Substitua o método processResults por:
private async processResults(): Promise<void> {
  if (this.isSending) {
    logger.debug(`${logPrefix} Processamento já em andamento`);
    return;
  }
  
  this.isSending = true;
  logger.info(`${logPrefix} Iniciando ciclo de processamento`);

  try {
    const emailQueues = await EmailQueueModel.find({
      'queueIds.success': { $exists: true, $ne: null },
      resultSent: false,
      $expr: {
        $gt: [
          { $size: {
            $filter: {
              input: "$queueIds",
              cond: { $ne: ["$$this.success", null] }
            }
          }},
          0
        ]
      }
    }).lean();

    logger.info(`${logPrefix} Filas encontradas: ${emailQueues.length}`);

    const resultsByUuid = this.groupResultsByUuid(emailQueues);
    await this.processUuidResults(resultsByUuid);

  } catch (error) {
    const errorDetails = this.getErrorDetails(error);
    logger.error(`${logPrefix} Erro no processamento geral`, {
      message: errorDetails.message,
      stack: errorDetails.stack
    });
  } finally {
    this.isSending = false;
    logger.info(`${logPrefix} Ciclo de processamento finalizado`);
  }
}

  private groupResultsByUuid(emailQueues: any[]): Record<string, ResultItem[]> {
    const results: Record<string, ResultItem[]> = {};

    for (const queue of emailQueues) {
      const validResults = queue.queueIds
        .filter((q: QueueItem) => q.success !== null)
        .map((q: QueueItem) => ({
          queueId: q.queueId,
          email: q.email,
          success: q.success!,
          data: q.data
        }));

      if (validResults.length > 0) {
        results[queue.uuid] = validResults;
        logger.debug(`${logPrefix} UUID ${queue.uuid} tem ${validResults.length} resultados válidos`);
      } else {
        logger.warn(`${logPrefix} UUID ${queue.uuid} ignorado - sem resultados válidos`);
      }
    }

    return results;
  }

  private async processUuidResults(resultsByUuid: Record<string, ResultItem[]>): Promise<void> {
    for (const [uuid, results] of Object.entries(resultsByUuid)) {
      try {
        logger.info(`${logPrefix} Processando UUID ${uuid} com ${results.length} resultados`);
        await this.validateAndSendResults(uuid, results);
        
      } catch (error) {
        const errorDetails = this.getAxiosErrorDetails(error);
        logger.error(`${logPrefix} Falha no UUID ${uuid}`, {
          error: errorDetails.message,
          code: errorDetails.code,
          attempts: errorDetails.response?.retryCount || 1
        });
      }
    }
  }

  private async validateAndSendResults(uuid: string, results: ResultItem[]): Promise<void> {
    const validation = PayloadSchema.safeParse({ uuid, results });
    
    if (!validation.success) {
      const errors = validation.error.errors
        .map(err => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      
      logger.error(`${logPrefix} Validação falhou para ${uuid}`, {
        errors,
        resultCount: results.length,
        sampleEmail: results[0]?.email
      });
      throw new Error(`Erro de validação: ${errors}`);
    }

    const domain = this.domainStrategy.getNextDomain();
    await this.sendResults(domain, uuid, validation.data);
    await this.markAsSent(uuid, results.length);
  }

  private async sendResults(domain: string, uuid: string, payload: any): Promise<void> {
    const url = `${domain}/api/results`;
    logger.info(`${logPrefix} Enviando ${payload.results.length} resultados para ${url}`, {
      uuid,
      domain,
      firstQueueId: payload.results[0]?.queueId
    });

    const response = await this.axiosInstance.post(url, payload);
    
    logger.info(`${logPrefix} Resposta recebida de ${domain}`, {
      status: response.status,
      uuid,
      responseSummary: response.data?.success ? 'Sucesso' : 'Erro'
    });
  }

  private async markAsSent(uuid: string, resultCount: number): Promise<void> {
    const updateResult = await EmailQueueModel.updateOne(
      { uuid },
      { 
        $set: { 
          resultSent: true,
          lastUpdated: new Date(),
          'queueIds.$[].success': null
        }
      }
    );

    logger.info(`${logPrefix} UUID ${uuid} atualizado`, {
      resultCount,
      matched: updateResult.matchedCount,
      modified: updateResult.modifiedCount
    });
  }

  private getErrorDetails(error: unknown): { message: string; stack?: string } {
    if (error instanceof Error) {
      return { message: error.message, stack: error.stack };
    }
    return { message: 'Erro desconhecido', stack: String(error) };
  }

  private getAxiosErrorDetails(error: unknown): { 
    message: string;
    code?: string;
    config?: any;
    response?: any;
  } {
    if (axios.isAxiosError(error)) {
      return {
        message: error.message,
        code: error.code,
        config: error.config,
        response: error.response?.data,
      };
    }
    return this.getErrorDetails(error);
  }
}

export default ResultSenderService;