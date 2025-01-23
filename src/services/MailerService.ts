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

    this.initialize();
  }

  initialize() {
    this.sendInitialTestEmail();
  }

  isMailerBlocked(): boolean {
    return this.isBlocked;
  }

  isMailerPermanentlyBlocked(): boolean {
    return this.isBlockedPermanently;
  }

  getCreatedAt(): Date {
    return this.createdAt;
  }

  getStatus(): string {
    if (this.isBlockedPermanently) {
      return 'blocked_permanently';
    }
    if (this.isBlocked) {
      return 'blocked_temporary';
    }
    return 'health';
  }

  getVersion(): string {
    return this.version;
  }

  getBlockReason(): string | null {
    return this.blockReason;
  }

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

  unblockMailer(): void {
    if (this.isBlocked && !this.isBlockedPermanently) {
      this.isBlocked = false;
      this.blockReason = null;
      logger.info('Mailer desbloqueado.');
      this.clearRetryInterval();
    }
  }

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
      logger.info(`Email de teste enviado com queueId=${result.queueId}`);
  
      // Aguarda o resultado do LogParser para verificar o sucesso
      const logEntry = await this.waitForLogEntry(result.queueId);
      if (logEntry && logEntry.success) {
        logger.info(`Email de teste enviado com sucesso. Status do Mailer: health`);
        this.unblockMailer();
        return { success: true };
      } else {
        logger.warn(`Falha ao enviar email de teste. LogEntry: ${logEntry ? 'Falha no log' : 'Sem log'}`);
        this.blockMailer('blocked_temporary', 'Falha no envio do email de teste.');
        return { success: false };
      }
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste: ${error.message}`, error);
      this.blockMailer('blocked_temporary', `Erro ao enviar email de teste: ${error.message}`);
      return { success: false };
    }
  }

  private handleLogEntry(logEntry: LogEntry) {
    // Apenas registra a ação sem os dados sensíveis
    logger.info(`Log recebido para queueId=${logEntry.queueId}. Status: ${logEntry.result}`);
    this.processLogEntry(logEntry);
  }

  private processLogEntry(logEntry: LogEntry) {
    logger.info(`Processando log para queueId=${logEntry.queueId}. Status do resultado: ${logEntry.result}`);
    if (logEntry.success) {
      logger.info(`Email com queueId=${logEntry.queueId} foi enviado com sucesso.`);
      this.unblockMailer();
    } else {
      logger.warn(`Falha no envio para queueId=${logEntry.queueId}: ${logEntry.result}`);
      this.blockMailer('blocked_temporary', `Falha no envio para queueId=${logEntry.queueId}`);
    }
  }

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
          if (logEntry.queueId === queueId) {
            clearTimeout(timeout);
            resolve(logEntry);
          }
        });
      }
    });
  }

  private getLogEntryByQueueId(queueId: string): LogEntry | null {
    // Verifica se o log já foi emitido para o queueId
    logger.info(`Verificando log para queueId=${queueId}`);
    return null; // Retorne o log se já foi encontrado
  }

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

  private clearRetryInterval(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
      logger.info('Intervalo de tentativa de reenvio cancelado.');
    }
  }
}

export default new MailerService();
