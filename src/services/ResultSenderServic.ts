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

// Command Pattern: Interface para o comando de envio
interface SendResultCommand {
  execute(): Promise<boolean>;
}

// Real Sender Command
class RealSendResultCommand implements SendResultCommand {
  private uuid: string;
  private results: ResultItem[];

  constructor(uuid: string, results: ResultItem[]) {
    this.uuid = uuid;
    this.results = results;
  }

  public async execute(): Promise<boolean> {
    try {
      const payload = this.buildPayload();
      logger.info(`Enviando resultados reais para o servidor: uuid=${this.uuid}`);
      logger.info('Payload:', payload);

      const response = await axios.post('http://localhost:4008/api/results', payload);

      if (response.status === 200) {
        logger.info(`Resultados enviados com sucesso: uuid=${this.uuid}`);
        return true;
      } else {
        logger.error(`Falha ao enviar resultados: uuid=${this.uuid}, status=${response.status}`);
        return false;
      }
    } catch (error) {
      logger.error('Erro ao enviar resultados reais:', error);
      return false;
    }
  }

  private buildPayload(): any {
    return {
      uuid: this.uuid,
      results: this.results.map(r => ({ queueId: r.queueId, email: r.email, success: r.success }))
    };
  }
}

// Mock Sender Command
class MockSendResultCommand implements SendResultCommand {
  private uuid: string;
  private results: ResultItem[];

  constructor(uuid: string, results: ResultItem[]) {
    this.uuid = uuid;
    this.results = results;
  }

  public async execute(): Promise<boolean> {
    logger.info(`Simulação de envio para uuid=${this.uuid} com resultados:`, this.results);
    return true; // Simula um sucesso no envio
  }
}

// Builder Pattern: Para construir o payload de forma segura
class PayloadBuilder {
  private uuid: string;
  private results: ResultItem[];

  constructor(uuid: string, results: ResultItem[]) {
    this.uuid = uuid;
    this.results = results;
  }

  public build(): any {
    return {
      uuid: this.uuid,
      results: this.results.map(r => ({ queueId: r.queueId, email: r.email, success: r.success }))
    };
  }
}

// Fábrica para criar comandos de envio
class SendResultCommandFactory {
  public static createCommand(uuid: string, results: ResultItem[], useMock: boolean): SendResultCommand {
    return useMock ? new MockSendResultCommand(uuid, results) : new RealSendResultCommand(uuid, results);
  }
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

    const command = SendResultCommandFactory.createCommand(uuid, results, this.useMock);
    const sendSuccess = await command.execute();

    if (sendSuccess) {
      await EmailQueueModel.updateOne({ uuid }, { $set: { resultSent: true } });
      logger.info(`Resultados marcados como enviados: uuid=${uuid}`);
    } else {
      logger.error(`Falha ao enviar resultados: uuid=${uuid}`);
    }
  }
}

export default ResultSenderService;