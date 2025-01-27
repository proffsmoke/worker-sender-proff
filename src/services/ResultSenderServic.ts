import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';

// Definição das interfaces
interface QueueItem {
  queueId: string;
  email: string;
  success: boolean | null;
  data?: unknown; // Adicionado campo opcional para dados adicionais
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
  data?: unknown; // Adicionado campo opcional para dados adicionais
}

// Domínios alternados
const DOMAINS = ['http://localhost:4008/api'];
let currentDomainIndex = 0;

// Helper para tratamento seguro de erros
function getErrorDetails(error: unknown): { message: string; stack?: string } {
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

// Serviço para enviar resultados
export class ResultSenderService {
  private interval: NodeJS.Timeout | null = null;
  private isSending: boolean = false;

  constructor() {
    this.start();
  }

  // Inicia o serviço
  public start(): void {
    if (this.interval) {
      logger.warn('O serviço ResultSenderService já está em execução.');
      return;
    }

    this.interval = setInterval(() => this.processResults(), 10000);
    logger.info('ResultSenderService iniciado.');
  }

  // Para o serviço
  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('ResultSenderService parado.');
    }
  }

  // Processa os resultados
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
            data: q.data // Inclui dados adicionais
          }));

        if (results.length > 0) {
          resultsByUuid[uuid] = [...(resultsByUuid[uuid] || []), ...results];
        }
      }

      // Envia os resultados agrupados
      for (const [uuid, results] of Object.entries(resultsByUuid)) {
        if (results.length === 0) continue;
        await this.sendResults(uuid, results);
      }
    } catch (error) {
      const { message, stack } = getErrorDetails(error);
      logger.error(`Erro ao processar resultados: ${message}`, { stack });
    } finally {
      this.isSending = false;
      logger.info('Processamento de resultados concluído.');
    }
  }

  // Envia os resultados para o servidor (versão corrigida)
  private async sendResults(uuid: string, results: ResultItem[]): Promise<void> {
    try {
      // Construção do payload com dados completos
      const payload = {
        uuid,
        results: results.map(r => ({
          queueId: r.queueId,
          email: r.email,
          success: r.success,
          data: r.data // Inclui dados adicionais
        })),
      };
  
      // Rotação de domínios
      const currentDomain = DOMAINS[currentDomainIndex];
      currentDomainIndex = (currentDomainIndex + 1) % DOMAINS.length;
  
      // Construção da URL
      const url = `${currentDomain}/results`;
  
      // Log detalhado com payload formatado
      logger.info(`Enviando para: ${url}`, {
        fullPayload: {
          ...payload,
          results: payload.results.map(r => ({
            ...r,
            data: typeof r.data === 'object' ? JSON.stringify(r.data).slice(0, 100) + '...' : r.data
          }))
        }
      });
  
      // Configuração do timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
  
      // Envio da requisição
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
  
      clearTimeout(timeoutId);
  
      // Tratamento da resposta
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}...`);
      }
  
      // Atualização do banco de dados
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
      // Tratamento seguro de erros
      const errorDetails = getErrorDetails(error);
      const truncatedError = errorDetails.message.slice(0, 200);
      
      logger.error(`Falha no envio: ${uuid}`, {
        error: truncatedError,
        stack: errorDetails.stack?.split('\n').slice(0, 3).join(' ') // Stack trace resumido
      });
  
      // Atualização de status com retentativa
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
  
}

export default ResultSenderService;