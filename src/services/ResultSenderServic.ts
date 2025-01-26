import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';
import axios, { AxiosError } from 'axios';

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

export class ResultSenderService {
  private interval: NodeJS.Timeout | null = null;
  private isSending: boolean = false;
  private useMock: boolean;

  constructor(useMock: boolean = false) {
    this.useMock = useMock;
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
      const emailQueues = await EmailQueueModel.find({
        'queueIds.success': { $exists: true, $ne: null },
        resultSent: false,
      });

      logger.info(`Encontrados ${emailQueues.length} registros para processar.`);

      for (const emailQueue of emailQueues) {
        logger.info('Processando emailQueue:', emailQueue);
        await this.sendResults(emailQueue);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      logger.error('Erro ao processar resultados:', error);
    } finally {
      this.isSending = false;
    }
  }

  private async sendResults(emailQueue: EmailQueue): Promise<void> {
    const { uuid, queueIds } = emailQueue;

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

    const sendSuccess = await this.realSendResults(uuid, results);

    if (sendSuccess) {
      await EmailQueueModel.updateOne({ uuid }, { $set: { resultSent: true } });
      logger.info(`Resultados marcados como enviados: uuid=${uuid}`);
    } else {
      logger.error(`Falha ao enviar resultados: uuid=${uuid}`);
    }
  }

  private async realSendResults(uuid: string, results: ResultItem[]): Promise<boolean> {
    try {
      const payload = { uuid, results };

      logger.info(`Real: Enviando resultados para o servidor: uuid=${uuid}`);
      logger.info('Payload sendo enviado:', payload);

      const response = await axios.post('http://localhost:4008/api/results', payload);

      if (response.status === 200) {
        logger.info(`Resultados enviados com sucesso: uuid=${uuid}`);
        return true;
      } else {
        logger.error(`Falha ao enviar resultados: uuid=${uuid}, status=${response.status}`);
        return false;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          logger.error('Detalhes do erro:', {
            status: error.response.status,
            data: error.response.data,
          });
        } else if (error.request) {
          logger.error('Erro na requisição:', error.request);
        } else {
          logger.error('Erro desconhecido:', error.message);
        }
      } else if (error instanceof Error) {
        logger.error('Erro desconhecido:', error.message);
      } else {
        logger.error('Erro desconhecido:', error);
      }

      return false;
    }
  }
}

export default ResultSenderService;