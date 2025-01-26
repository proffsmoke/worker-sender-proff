// src/services/ResultSenderService.ts
import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';
import axios, { AxiosError } from 'axios'; // Importa o axios e AxiosError
import { inspect } from 'util'; // Para formatar erros circulares e exibir a estrutura completa

export class ResultSenderService {
  private interval: NodeJS.Timeout | null = null;
  private isSending: boolean = false;
  private useMock: boolean; // Define se o mock deve ser usado

  constructor(useMock: boolean = false) { // Por padrão, não usa o mock
    this.useMock = useMock;
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
        'queueIds.success': { $exists: true, $ne: null }, // Garante que success existe e não é null
        resultSent: false, // resultSent é false
      });

      logger.info(`Encontrados ${emailQueues.length} registros para processar.`);

      // Processa cada registro
      for (const emailQueue of emailQueues) {
        logger.info('emailQueue: ', emailQueue)
        await this.sendResults(emailQueue);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Limita a 1 envio por segundo
      }
    } catch (error) {
      // Exibe a estrutura completa do erro para depuração
      logger.error('Erro ao processar resultados:', inspect(error, { depth: null, colors: true }));
    } finally {
      this.isSending = false;
    }
  }

  // Envia os resultados (mock ou real)
  private async sendResults(emailQueue: any): Promise<void> {
    const { uuid, queueIds } = emailQueue;
    logger.info('queueIds a ser filtrados: ',queueIds)

  // Filtra os queueIds com success preenchido
  const results = queueIds
    .filter((q: any) => q.success != null) // Garante que success não seja null ou undefined
    .map((q: any) => ({
      queueId: q.queueId,
      email: q.email,
      success: q.success,
    }));

    // Exibe o UUID completo e os resultados que estão sendo enviados
    logger.info(`Preparando para enviar resultados: uuid=${uuid}, total de resultados=${results.length}`);
    logger.info('Resultados a serem enviados:', inspect(results));

    // Verifica se há resultados para enviar
    if (results.length === 0) {
      logger.warn(`Nenhum resultado válido encontrado para enviar: uuid=${uuid}`);
      return;
    }

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
      logger.info(`Resultado ${index + 1}:`, inspect(result, { depth: null, colors: true }));
    });

    // Simula um envio bem-sucedido
    logger.info(`Mock: Resultados enviados com sucesso: uuid=${uuid}`);
    return true; // Retorna true para indicar sucesso
  }

  // Real: Envia os resultados para o servidor
  private async realSendResults(uuid: string, results: any[]): Promise<boolean> {
    try {
      // Faz uma requisição POST para o servidor
      const payload = {
        uuid,
        results,
      };

      logger.info(`Real: Enviando resultados para o servidor: uuid=${uuid}`);
      logger.info('Payload sendo enviado:', inspect(payload, { depth: null, colors: true }));

      const response = await axios.post('http://localhost:4008/api/results', payload);

      // Verifica se a requisição foi bem-sucedida
      if (response.status === 200) {
        logger.info(`Resultados enviados com sucesso: uuid=${uuid}`);
        return true;
      } else {
        logger.error(`Falha ao enviar resultados: uuid=${uuid}, status=${response.status}`);
        return false;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // Erro do Axios
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
        // Erro genérico
        logger.error('Erro desconhecido:', error.message);
      } else {
        // Erro completamente desconhecido
        logger.error('Erro desconhecido:', inspect(error, { depth: null, colors: true }));
      }

      return false;
    }
  }
}

export default ResultSenderService;