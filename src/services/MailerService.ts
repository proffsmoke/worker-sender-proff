import logger from '../utils/logger';
import config from '../config';
import EmailService from './EmailService';
import LogParser, { LogEntry } from '../log-parser';

class MailerService {
  private currentState: string = 'health'; // Estados: 'health', 'blocked_temporary', 'blocked_permanently'
  private retryIntervalId: NodeJS.Timeout | null = null;
  private logParser: LogParser;

  constructor() {
    this.logParser = new LogParser('/var/log/mail.log');
    this.logParser.on('log', this.handleLogEntry.bind(this)); // Observer para os logs

    this.initialize();
  }

  // Inicia o processo de envio de email de teste
  private initialize() {
    this.sendInitialTestEmail();
  }

  // Enviar email de teste e aguardar confirmação do log
  private async sendInitialTestEmail(): Promise<void> {
    const testEmailParams = {
      fromName: 'Mailer Test',
      emailDomain: config.mailer.noreplyEmail.split('@')[1] || 'unknown.com',
      to: config.mailer.noreplyEmail,
      bcc: [],
      subject: 'Email de Teste Inicial',
      html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
    };

    try {
      const result = await EmailService.sendEmail(testEmailParams);
      logger.info(`Email de teste enviado com queueId=${result.queueId}`, { result });

      // Espera o log associado ao queueId para confirmar o resultado
      const logEntry = await this.waitForLogEntry(result.queueId);

      if (logEntry && logEntry.success) {
        logger.info('Email de teste enviado com sucesso. Status do Mailer: health');
        this.changeState('health'); // Alterar para o estado de 'health'
      } else {
        logger.warn('Falha ao enviar email de teste.');
        this.changeState('blocked_temporary'); // Bloqueio temporário devido à falha
      }
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste: ${error.message}`, error);
      this.changeState('blocked_temporary'); // Bloqueio temporário devido ao erro
    }
  }

  // Processa o log recebido e altera o estado do mailer
  private handleLogEntry(logEntry: LogEntry): void {
    logger.info(`Log analisado: ${JSON.stringify(logEntry)}`);
    if (logEntry.success) {
      logger.info(`Log para queueId=${logEntry.queueId} é bem-sucedido.`);
      this.changeState('health'); // Envio bem-sucedido
    } else {
      logger.warn(`Falha no envio para queueId=${logEntry.queueId}: ${logEntry.result}`);
      this.changeState('blocked_temporary'); // Bloqueio temporário
    }
  }

  // Alterar o estado do mailer
  private changeState(newState: string): void {
    if (this.currentState !== newState) {
      logger.info(`Mudando estado do mailer para: ${newState}`);
      this.currentState = newState;

      // Ação dependendo do estado
      if (newState === 'blocked_temporary') {
        this.scheduleRetry();
      } else {
        this.clearRetryInterval();
      }
    }
  }

  // Aguarda o logEntry para o queueId especificado
  private waitForLogEntry(queueId: string): Promise<LogEntry | null> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger.warn(`Timeout ao aguardar logEntry para queueId=${queueId}. Nenhuma entrada encontrada após 60 segundos.`);
        resolve(null);
      }, 60000); // Timeout após 60 segundos

      this.logParser.once('log', (logEntry: LogEntry) => {
        if (logEntry.queueId === queueId) {
          clearTimeout(timeout);
          resolve(logEntry);
        }
      });
    });
  }

  // Agendar tentativas de reenvio
  private scheduleRetry(): void {
    if (this.retryIntervalId) {
      return; // Já existe um intervalo de reenvio agendado
    }

    logger.info('Agendando tentativa de reenviar email de teste a cada 4 minutos.');
    this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000); // 4 minutos
  }

  // Enviar novamente o email de teste
  private async retrySendEmail(): Promise<void> {
    if (this.currentState === 'blocked_temporary') {
      logger.info('Tentando reenviar email de teste...');
      await this.sendInitialTestEmail();
    }
  }

  // Limpar o intervalo de tentativas de reenvio
  private clearRetryInterval(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
      logger.info('Intervalo de tentativa de reenvio cancelado.');
    }
  }
}

export default new MailerService();
