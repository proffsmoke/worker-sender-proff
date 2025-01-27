import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';
import axios from 'axios';

// Definição das interfaces
interface QueueItem {
  queueId: string;
  email: string;
  success: boolean | null;
}

interface ResultItem {
  queueId: string;
  email: string;
  success: boolean;
}

// Função utilitária para limpar objetos de referências circulares
const replacerFunc = () => {
  const visited = new WeakSet();

  return (key: string, value: any) => {
    if (typeof value === 'object' && value !== null) {
      if (visited.has(value)) {
        return; // Ignora referências circulares
      }
      visited.add(value);
    }
    return value;
  };
};

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
      // Constrói o payload seguro (sem referências circulares)
      const payload = {
        uuid,
        results: results.map(r => ({
          queueId: r.queueId,
          email: r.email,
          success: r.success,
        })),
      };

      // Limpa o payload para evitar referências circulares antes de enviá-lo
      const cleanedPayload = JSON.stringify(payload, replacerFunc());

      logger.info('Payload limpo construído:', cleanedPayload);

      // Envia os resultados para o servidor
      logger.info('Enviando payload para o servidor...');
      const response = await axios.post('http://localhost:4008/api/results', JSON.parse(cleanedPayload), {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Verifica se a resposta existe e se contém dados
      if (response && response.data) {
        logger.info('Resposta do servidor:', JSON.stringify(response.data));

        if (response.status === 200) {
          logger.info(`Resultados enviados com sucesso: uuid=${uuid}`);
          // Marca o registro como enviado no banco de dados
          await EmailQueueModel.updateMany({ uuid }, { $set: { resultSent: true } });
          logger.info(`Resultados marcados como enviados: uuid=${uuid}`);
        } else {
          logger.error(`Falha ao enviar resultados: uuid=${uuid}, status=${response.status}`);
        }
      } else {
        logger.error('Resposta do servidor inválida ou sem dados.');
      }
    } catch (error) {
      logger.error('Erro ao enviar resultados:', JSON.stringify(error, replacerFunc()));
    }
  }
}

export default ResultSenderService;
