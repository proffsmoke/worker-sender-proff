import logger from '../utils/logger';
import config from '../config';
import EmailService from './EmailService';
import LogParser, { LogEntry } from '../log-parser';

class MailerService {
  private isBlocked: boolean = false;
  private isBlockedPermanently: boolean = false;
  private blockReason: string | null = null;
  private createdAt: Date;
  private version: string = '4.3.26-1';
  private retryIntervalId: NodeJS.Timeout | null = null;
  private logParser: LogParser;

  constructor() {
    this.createdAt = new Date();
    this.logParser = new LogParser('/var/log/mail.log');
    this.logParser.on('log', this.handleLogEntry.bind(this)); // Agora escutando os logs em tempo real
    this.logParser.startMonitoring();  // Garantindo que a monitorização comece

    this.initialize();
  }

  initialize() {
    this.sendInitialTestEmail();
  }

  // Checa se o Mailer está bloqueado
  isMailerBlocked(): boolean {
    return this.isBlocked;
  }

  // Checa se o Mailer está permanentemente bloqueado
  isMailerPermanentlyBlocked(): boolean {
    return this.isBlockedPermanently;
  }

  // Retorna a data de criação do serviço
  getCreatedAt(): Date {
    return this.createdAt;
  }

  // Retorna o status do Mailer
  getStatus(): string {
    if (this.isBlockedPermanently) {
      return 'blocked_permanently';
    }
    if (this.isBlocked) {
      return 'blocked_temporary';
    }
    return 'health';
  }

  // Retorna a versão do serviço
  getVersion(): string {
    return this.version;
  }

  // Retorna o motivo do bloqueio
  getBlockReason(): string | null {
    return this.blockReason;
  }

  // Bloqueia o Mailer
  blockMailer(status: 'blocked_permanently' | 'blocked_temporary', reason: string): void {
    if (!this.isBlocked) {
      this.isBlocked = true;
      this.blockReason = reason;
      if (status === 'blocked_permanently') {
        this.isBlockedPermanently = true;
      }
      logger.warn(`Mailer bloqueado com status: ${status}. Razão: ${reason}`);
      if (status === 'blocked_temporary') {
        this.scheduleRetry();
      } else {
        this.clearRetryInterval();
      }
    }
  }

  // Desbloqueia o Mailer
  unblockMailer(): void {
    if (this.isBlocked && !this.isBlockedPermanently) {
      this.isBlocked = false;
      this.blockReason = null;
      logger.info('Mailer desbloqueado.');
      this.clearRetryInterval();
    }
  }

  // Envia um email de teste inicial
  private async sendInitialTestEmail(): Promise<{ success: boolean }> {
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

      // Aguarda o resultado do LogParser para verificar o sucesso
      const logEntry = await this.waitForLogEntry(result.queueId);
      logger.info(`Esperando log para queueId=${result.queueId}. Conteúdo aguardado: ${JSON.stringify(logEntry)}`);

      if (logEntry && logEntry.success) {
        logger.info(`Email de teste enviado com sucesso. Status do Mailer: health`);
        this.unblockMailer();
        return { success: true };
      } else {
        logger.warn(`Falha ao enviar email de teste. LogEntry: ${JSON.stringify(logEntry)}`);
        this.blockMailer('blocked_temporary', 'Falha no envio do email de teste.');
        return { success: false };
      }
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste: ${error.message}`, error);
      this.blockMailer('blocked_temporary', `Erro ao enviar email de teste: ${error.message}`);
      return { success: false };
    }
  }

  // Processa a entrada de log recebida
  private handleLogEntry(logEntry: LogEntry) {
    logger.info(`Log recebido para queueId=${logEntry.queueId}: ${JSON.stringify(logEntry)}`);
    this.processLogEntry(logEntry);
  }

  // Processa a entrada de log e desbloqueia ou bloqueia o Mailer
  private processLogEntry(logEntry: LogEntry) {
    logger.info(`Processando log para queueId=${logEntry.queueId}: ${logEntry.result}`);
    if (logEntry.success) {
      logger.info(`Email com queueId=${logEntry.queueId} foi enviado com sucesso.`);
      this.unblockMailer();
    } else {
      logger.warn(`Falha no envio para queueId=${logEntry.queueId}: ${logEntry.result}`);
      this.blockMailer('blocked_temporary', `Falha no envio para queueId=${logEntry.queueId}`);
    }
  }

  // Aguarda a entrada do log para o queueId
  private waitForLogEntry(queueId: string): Promise<LogEntry | null> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger.warn(`Timeout ao aguardar logEntry para queueId=${queueId}. Nenhuma entrada encontrada após 60 segundos.`);
        resolve(null); // Timeout após 60 segundos
      }, 60000); // Alterado para 60 segundos

      // Verificando se já existe o log para o queueId
      const logEntry = this.getLogEntryByQueueId(queueId);
      if (logEntry) {
        clearTimeout(timeout);
        resolve(logEntry);
      } else {
        this.logParser.once('log', (logEntry: LogEntry) => {
          logger.info(`Esperando log para queueId=${queueId}. Conteúdo que foi processado: ${JSON.stringify(logEntry)}`);
          if (logEntry.queueId === queueId) {
            clearTimeout(timeout);
            resolve(logEntry);
          } else {
            logger.info(`QueueId não corresponde. Log recebido: ${JSON.stringify(logEntry)}`);
          }
        });
      }
    });
  }

  // Retorna a entrada do log correspondente ao queueId
  private getLogEntryByQueueId(queueId: string): LogEntry | null {
    logger.info(`Verificando log para queueId=${queueId}`);
    return null; // Retorne o log se já foi encontrado
  }

  // Agenda o reenvio do email de teste a cada 4 minutos, se necessário
  private scheduleRetry(): void {
    if (this.isBlockedPermanently) {
      logger.info('Mailer está permanentemente bloqueado. Não tentará reenviar emails.');
      return;
    }

    if (this.retryIntervalId) {
      return;
    }

    logger.info('Agendando tentativa de reenviar email de teste a cada 4 minutos.');
    this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000); // 4 minutos
  }

  // Tenta reenviar o email de teste se estiver bloqueado temporariamente
  private async retrySendEmail(): Promise<void> {
    if (!this.isBlocked || this.isBlockedPermanently) {
      this.clearRetryInterval();
      logger.info('Mailer não está temporariamente bloqueado ou está permanentemente bloqueado. Cancelando tentativas de reenvio.');
      return;
    }

    logger.info('Tentando reenviar email de teste...');
    const result = await this.sendInitialTestEmail();

    if (result.success) {
      logger.info('Reenvio de email de teste bem-sucedido. Cancelando futuras tentativas.');
      this.clearRetryInterval();
    }
  }

  // Limpa o intervalo de reenvio agendado
  private clearRetryInterval(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
      logger.info('Intervalo de tentativa de reenvio cancelado.');
    }
  }
}

export default new MailerService();
