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
      // Busca registros no banco de dados que precisam ser processados
      const emailQueues = await EmailQueueModel.find({
        'queueIds.success': { $exists: true, $ne: null },
        resultSent: false,
      });

      logger.info(`Encontrados ${emailQueues.length} registros para processar.`);

      // Processa cada registro
      for (const emailQueue of emailQueues) {
        logger.info('Processando emailQueue:', emailQueue);
        await this.sendResults(emailQueue);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Delay entre envios
      }
    } catch (error) {
      logger.error('Erro ao processar resultados:', error);
    } finally {
      this.isSending = false;
    }
  }

  // Envia os resultados para o servidor
  private async sendResults(emailQueue: EmailQueue): Promise<void> {
    const { uuid, queueIds } = emailQueue;

    // Filtra os resultados válidos
    const filteredQueueIds = queueIds.filter((q: QueueItem) => q.success != null);
    const results: ResultItem[] = filteredQueueIds.map((q: QueueItem) => ({
      queueId: q.queueId,
      email: q.email,
      success: q.success!,
    }));

    logger.info(`Preparando para enviar resultados: uuid=${uuid}, total de resultados=${results.length}`);
    logger.info('Resultados a serem enviados:', results);

    if (results.length === 0) {
      logger.warn(`Nenhum resultado válido encontrado para enviar: uuid=${uuid}`);
      return;
    }

    try {
      // Constrói o payload seguro (sem referências circulares)
      const payload = {
        uuid,
        results: results.map(r => ({ queueId: r.queueId, email: r.email, success: r.success })),
      };

      logger.info('Payload:', payload);

      // Envia os resultados para o servidor
      const response = await axios.post('http://localhost:4008/api/results', payload);

      if (response.status === 200) {
        logger.info(`Resultados enviados com sucesso: uuid=${uuid}`);
        // Marca o registro como enviado no banco de dados
        await EmailQueueModel.updateOne({ uuid }, { $set: { resultSent: true } });
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