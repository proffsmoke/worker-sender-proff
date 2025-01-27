import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';
import axios from 'axios';

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

// Função utilitária para limpar objetos de referências circulares
function cleanObject(obj: any): any {
  const seen = new WeakSet();

  const replacer = (key: string, value: any) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        logger.warn(`Referência circular detectada na chave: ${key}`);
        return '[Circular Reference]';
      }
      seen.add(value);
    }
    return value;
  };

  try {
    const cleaned = JSON.parse(JSON.stringify(obj, replacer));
    return cleaned;
  } catch (error) {
    logger.error('Erro ao limpar objeto:', error);
    return null;
  }
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

      logger.info('Resultados agrupados por uuid:', cleanObject(resultsByUuid));

      // Envia os resultados agrupados por uuid
      for (const [uuid, results] of Object.entries(resultsByUuid)) {
        logger.info(`Preparando para enviar resultados: uuid=${uuid}, total de resultados=${results.length}`);
        logger.info('Resultados a serem enviados:', cleanObject(results));

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
  // Envia os resultados para o servidor
private async sendResults(uuid: string, results: ResultItem[]): Promise<void> {
  try {
    // Constrói o payload seguro (sem referências circulares)
    const payload = {
      uuid,
      results: results.map(r => ({
        queueId: r.queueId,
        email: r.email,
        success: r.success,
      })),
    };

    logger.info('Payload construído:', cleanObject(payload));

    // Envia os resultados para o servidor
    logger.info('Enviando payload para o servidor...');
    const response = await axios.post('http://localhost:4008/api/results', payload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Acessa response.data em vez de response
    const responseData = response.data;

    if (response.status === 200) {
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