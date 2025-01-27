import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';

// Definição das interfaces
interface QueueItem {
  queueId: string;
  email: string;
  success: boolean | null;
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
}

// Domínios alternados
const DOMAINS = ['http://localhost:4008'];
let currentDomainIndex = 0;

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

      // Agrupa os resultados por uuid
      const resultsByUuid: { [uuid: string]: ResultItem[] } = {};

      for (const emailQueue of emailQueues) {
        const { uuid, queueIds } = emailQueue;
        logger.info(`Processando emailQueue com uuid: ${uuid}`);

        // Filtra os resultados válidos
        const filteredQueueIds = queueIds.filter((q: QueueItem) => q.success != null);
        const results: ResultItem[] = filteredQueueIds.map((q: QueueItem) => ({
          queueId: q.queueId,
          email: q.email,
          success: q.success!,
        }));

        logger.info(`Filtrados ${results.length} resultados válidos para uuid: ${uuid}`);

        // Agrupa os resultados por uuid
        if (!resultsByUuid[uuid]) {
          resultsByUuid[uuid] = [];
        }
        resultsByUuid[uuid].push(...results);
      }

      logger.info('Resultados agrupados por uuid:', JSON.stringify(resultsByUuid));

      // Envia os resultados agrupados por uuid
      for (const [uuid, results] of Object.entries(resultsByUuid)) {
        logger.info(`Preparando para enviar resultados: uuid=${uuid}, total de resultados=${results.length}`);
        logger.info('Resultados a serem enviados:', JSON.stringify(results));

        if (results.length === 0) {
          logger.warn(`Nenhum resultado válido encontrado para enviar: uuid=${uuid}`);
          continue;
        }

        await this.sendResults(uuid, results);
      }
    } catch (error) {
      logger.error('Erro ao processar resultados:', error);
    } finally {
      this.isSending = false;
      logger.info('Processamento de resultados concluído.');
    }
  }

  // Envia os resultados para o servidor
  private async sendResults(uuid: string, results: ResultItem[]): Promise<void> {
    try {
      // Constrói o payload
      const payload = {
        uuid,
        results: results.map(r => ({
          queueId: r.queueId,
          email: r.email,
          success: r.success,
        })),
      };

      logger.info('Payload construído:', payload);

      // Seleciona o domínio atual e alterna para o próximo
      const currentDomain = DOMAINS[currentDomainIndex];
      currentDomainIndex = (currentDomainIndex + 1) % DOMAINS.length; // Alterna entre os domínios

      const url = `${currentDomain}/api/results`;
      logger.info(`Enviando payload para a URL: ${url}`);

      // Envia os resultados para o servidor
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      // Verifica se a resposta foi bem-sucedida
      if (response.ok) {
        const responseData = await response.json();
        logger.info('Resposta do servidor:', responseData);

        logger.info(`Resultados enviados com sucesso: uuid=${uuid}`);
        // Marca o registro como enviado no banco de dados
        await EmailQueueModel.updateMany({ uuid }, { $set: { resultSent: true } });
        logger.info(`Resultados marcados como enviados: uuid=${uuid}`);
      } else {
        logger.error(`Falha ao enviar resultados: uuid=${uuid}, status=${response.status}`);
      }
    } catch (error) {
      logger.error('Erro ao enviar resultados:', error);
    }
  }
}

export default ResultSenderService;