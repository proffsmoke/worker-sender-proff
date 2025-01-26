// src/services/ResultSenderService.ts
import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';

export class ResultSenderService {
  private interval: NodeJS.Timeout | null = null;
  private isSending: boolean = false;
  private useMock: boolean; // Define se o mock deve ser usado

  constructor(useMock: boolean = true) {
    this.useMock = useMock; // Por padrão, usa o mock
    this.start();
  }

  // Inicia o serviço
  public start(): void {
    if (this.interval) {
      logger.warn('O serviço ResultSenderService já está em execução.');
      return;
    }

    this.interval = setInterval(() => this.processResults(), 10000); // Verifica a cada 10 segundos
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

  // Processa os resultados pendentes
  private async processResults(): Promise<void> {
    if (this.isSending) {
      logger.info('ResultSenderService já está processando resultados. Aguardando...');
      return;
    }

    this.isSending = true;

    try {
      // Busca registros com success preenchido e resultSent = false
      const emailQueues = await EmailQueueModel.find({
        'queueIds.success': { $ne: null }, // success não é null
        resultSent: false, // resultSent é false
      });

      logger.info(`Encontrados ${emailQueues.length} registros para processar.`);

      // Processa cada registro
      for (const emailQueue of emailQueues) {
        await this.sendResults(emailQueue);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Limita a 1 envio por segundo
      }
    } catch (error) {
      logger.error('Erro ao processar resultados:', error);
    } finally {
      this.isSending = false;
    }
  }

  // Envia os resultados (mock ou real)
  private async sendResults(emailQueue: any): Promise<void> {
    const { uuid, queueIds } = emailQueue;

    // Filtra os queueIds com success preenchido
    const results = queueIds
      .filter((q: any) => q.success !== null)
      .map((q: any) => ({
        queueId: q.queueId,
        email: q.email,
        success: q.success,
      }));

    logger.info(`Preparando para enviar resultados: uuid=${uuid}`);

    // Usa o mock ou o envio real
    const sendSuccess = this.useMock
      ? await this.mockSendResults(uuid, results) // Usa o mock
      : await this.realSendResults(uuid, results); // Usa o envio real

    if (sendSuccess) {
      // Atualiza o campo resultSent para true
      await EmailQueueModel.updateOne(
        { uuid },
        { $set: { resultSent: true } }
      );

      logger.info(`Resultados marcados como enviados: uuid=${uuid}`);
    } else {
      logger.error(`Falha ao enviar resultados: uuid=${uuid}`);
    }
  }

  // Mock: Simula o envio de resultados
  private async mockSendResults(uuid: string, results: any[]): Promise<boolean> {
    // Simula um delay de 500ms para o envio
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Exibe os resultados que estão sendo enviados
    logger.info(`Mock: Enviando resultados para uuid=${uuid}`);
    results.forEach((result, index) => {
      logger.info(`Resultado ${index + 1}:`, {
        queueId: result.queueId,
        email: result.email,
        success: result.success,
      });
    });

    // Simula um envio bem-sucedido
    logger.info(`Mock: Resultados enviados com sucesso: uuid=${uuid}`);
    return true; // Retorna true para indicar sucesso
  }

  // Real: Envia os resultados para o servidor (implementação futura)
  private async realSendResults(uuid: string, results: any[]): Promise<boolean> {
    try {
      // Substitua por uma requisição HTTP real
      // Exemplo: await axios.post('https://seu-dominio.env/results', { uuid, results });
      logger.info(`Real: Enviando resultados para uuid=${uuid}`);

      // Simula um envio bem-sucedido
      return true;
    } catch (error) {
      logger.error(`Erro ao enviar resultados ao servidor: uuid=${uuid}`, error);
      return false;
    }
  }
}

export default ResultSenderService;