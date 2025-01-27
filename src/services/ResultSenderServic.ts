import axios, { AxiosInstance } from 'axios';
import { z } from 'zod'; // Importando Zod para validação
import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';

// Definição das interfaces
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

// Esquema de validação com Zod
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

// Estratégia de rotação de domínios
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
    logger.info('ResultSenderService iniciado e agendado para executar a cada 10 segundos.');
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
      logger.info('ResultSenderService já está processando resultados. Aguardando a próxima iteração.');
      return;
    }

    this.isSending = true;
    logger.info('Iniciando o processamento de resultados.');

    try {
      logger.debug('Buscando registros no banco de dados com resultado não enviado e sucesso definido.');
      const emailQueues = await EmailQueueModel.find({
        'queueIds.success': { $exists: true, $ne: null },
        resultSent: false,
      }).lean(); // Usando lean() para melhorar a performance

      logger.info(`Encontrados ${emailQueues.length} registros para processar.`);
      logger.debug('Registros encontrados:', { emailQueues });

      const resultsByUuid: Record<string, ResultItem[]> = {};

      for (const emailQueue of emailQueues) {
        const { uuid, queueIds } = emailQueue;
        logger.info(`Processando emailQueue com uuid: ${uuid}`);
        logger.debug('Dados da emailQueue:', { uuid, queueIds });

        const validQueueIds = queueIds.filter((q: QueueItem) => q.success !== null);
        logger.debug(`Filtrados ${validQueueIds.length} queueIds com sucesso definido.`);

        const results: ResultItem[] = validQueueIds.map((q: QueueItem) => ({
          queueId: q.queueId,
          email: q.email,
          success: q.success!,
          data: q.data,
        }));

        logger.debug('Resultados mapeados:', { results });

        if (results.length > 0) {
          resultsByUuid[uuid] = [...(resultsByUuid[uuid] || []), ...results];
        }
      }

      logger.debug('Resultados agrupados por UUID:', { resultsByUuid });

      for (const [uuid, results] of Object.entries(resultsByUuid)) {
        if (results.length === 0) {
          logger.warn(`Nenhum resultado válido para o uuid: ${uuid}. Pulando envio.`);
          continue;
        }
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
    logger.info(`Validando e enviando resultados para o uuid: ${uuid}`);
    logger.debug('Resultados a serem enviados:', { uuid, results });

    try {
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

      logger.debug('Payload construído:', { payload });

      // Validação do payload com Zod
      const validatedPayload = PayloadSchema.safeParse(payload);

      if (!validatedPayload.success) {
        logger.error('Validação do payload falhou.', { errors: validatedPayload.error.errors });
        throw new Error(`Payload inválido: ${validatedPayload.error.message}`);
      }

      logger.info('Payload validado com sucesso.');

      const currentDomain = this.domainStrategy.getNextDomain();
      const url = `${currentDomain}/api/results`;

      logger.info(`Enviando payload para: ${url}`);
      logger.debug('Payload enviado:', { payload: validatedPayload.data });

      const response = await this.axiosInstance.post(url, validatedPayload.data);

      logger.info(`Resposta recebida: Status ${response.status} - ${response.statusText}`);
      logger.debug('Dados da resposta:', { data: response.data });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Atualizando os registros como enviados
      const updateResult = await EmailQueueModel.updateMany(
        { uuid },
        {
          $set: {
            resultSent: true,
            lastUpdated: new Date(),
          },
        },
      );

      // Correção aplicada aqui:
      logger.info(`Sucesso no envio: ${uuid} (${results.length} resultados). Registros atualizados: ${updateResult.modifiedCount}`);
    } catch (error) {
      const errorDetails = this.getErrorDetails(error);
      const truncatedError = errorDetails.message.slice(0, 200);

      logger.error(`Falha no envio: ${uuid}`, {
        error: truncatedError,
        stack: errorDetails.stack?.split('\n').slice(0, 3).join(' '),
      });

      try {
        await EmailQueueModel.updateMany(
          { uuid },
          {
            $set: {
              lastError: truncatedError,
              errorDetails: JSON.stringify(errorDetails).slice(0, 500),
            },
            $inc: { retryCount: 1 },
          },
        );
        logger.debug(`Registro atualizado com erros para o uuid: ${uuid}`);
      } catch (updateError) {
        const { message: updateMsg, stack: updateStack } = this.getErrorDetails(updateError);
        logger.error(`Falha ao atualizar o registro de erro para o uuid: ${uuid}`, {
          error: updateMsg,
          stack: updateStack,
        });
      }
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
