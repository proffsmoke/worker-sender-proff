import logger from '../utils/logger';
import config from '../config';
import EmailService from './EmailService';
import LogParser, { LogEntry } from '../log-parser';
import BlockManagerService from './BlockManagerService';
import { v4 as uuidv4 } from 'uuid';

interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
  name?: string;
  queueId?: string;
}

class MailerService {
  private static instance: MailerService;
  private isBlocked: boolean = false;
  private isBlockedPermanently: boolean = false;
  private blockReason: string | null = null;
  private createdAt: Date;
  private version: string = '4.3.26-1';
  private retryIntervalId: NodeJS.Timeout | null = null;
  private logParser: LogParser;
  private emailService: EmailService;
  private blockManagerService: BlockManagerService;
  private isMonitoringStarted: boolean = false;

  private constructor() {
    this.createdAt = new Date();
    this.logParser = new LogParser('/var/log/mail.log');
    this.emailService = EmailService.getInstance(this.logParser);
    this.blockManagerService = BlockManagerService.getInstance(this);

    if (!this.isMonitoringStarted) {
      this.logParser.startMonitoring();
      this.isMonitoringStarted = true;
    }

    this.initialize();
  }

  public static getInstance(): MailerService {
    if (!MailerService.instance) {
      MailerService.instance = new MailerService();
    }
    return MailerService.instance;
  }

  initialize() {
    this.sendInitialTestEmail();
  }

  getVersion(): string {
    return this.version;
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

  getBlockReason(): string | null {
    return this.blockReason;
  }

  isMailerBlocked(): boolean {
    return this.isBlocked;
  }

  isMailerPermanentlyBlocked(): boolean {
    return this.isBlockedPermanently;
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

  private scheduleRetry(): void {
    if (this.isBlockedPermanently) {
      logger.info('Mailer está permanentemente bloqueado. Não tentará reenviar emails.');
      return;
    }

    if (this.retryIntervalId) {
      return;
    }

    logger.info('Agendando tentativa de reenviar email de teste a cada 4 minutos.');
    this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000);
  }

  private clearRetryInterval(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
      logger.info('Intervalo de tentativa de reenvio cancelado.');
    }
  }

  private async retrySendEmail(): Promise<void> {
    // Verifica se o Mailer está bloqueado e o bloqueio é temporário
    if (!this.isBlocked || this.isBlockedPermanently) {
      this.clearRetryInterval();
      logger.info('Mailer não está bloqueado temporariamente. Cancelando tentativas de reenvio.');
      return;
    }

    // Se estiver bloqueado temporariamente, tenta reenviar o email
    logger.info('Tentando reenviar email de teste...');
    const result = await this.sendInitialTestEmail();

    // Se o reenvio for bem-sucedido, cancela as tentativas futuras
    if (result.success) {
      logger.info('Reenvio de email de teste bem-sucedido. Cancelando futuras tentativas.');
      this.clearRetryInterval();
    }
  }

  public async sendInitialTestEmail(): Promise<{ success: boolean; recipients: RecipientStatus[] }> {
    const testEmailParams = {
      fromName: 'Mailer Test',
      emailDomain: config.mailer.noreplyEmail.split('@')[1] || 'unknown.com',
      to: config.mailer.noreplyEmail,
      bcc: [],
      subject: 'Email de Teste Inicial',
      html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
      clientName: 'Prasminha camarada',
    };

    try {
      const requestUuid = uuidv4();
      logger.info(`UUID gerado para o teste: ${requestUuid}`);

      // Envia o e-mail de teste
      const result = await this.emailService.sendEmail(testEmailParams, requestUuid);

      logger.info(`Email de teste enviado com queueId=${result.queueId}`, { result });

      // Aguarda o log correspondente ao queueId
      const logEntry = await this.waitForLogEntry(result.queueId);
      logger.info(`Esperando log para queueId=${result.queueId}. Conteúdo aguardado: ${JSON.stringify(logEntry)}`);

      if (logEntry && logEntry.success) {
        logger.info(`Email de teste enviado com sucesso. Status do Mailer: health`);
        this.unblockMailer();
        return { success: true, recipients: [result.recipient] };
      } else {
        logger.warn(`Falha ao enviar email de teste. LogEntry: ${JSON.stringify(logEntry)}`);
        this.blockMailer('blocked_temporary', 'Falha no envio do email de teste.');
        return { success: false, recipients: [result.recipient] };
      }
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste: ${error.message}`, error);
      this.blockMailer('blocked_temporary', `Erro ao enviar email de teste: ${error.message}`);
      return { success: false, recipients: [] };
    }
  }

  private async waitForLogEntry(queueId: string): Promise<LogEntry | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn(`Timeout ao aguardar logEntry para queueId=${queueId}. Nenhuma entrada encontrada após 60 segundos.`);
        resolve(null);
      }, 60000);

      this.logParser.once('log', (logEntry: LogEntry) => {
        if (logEntry.queueId === queueId) {
          clearTimeout(timeout);
          resolve(logEntry);
        }
      });
    });
  }
}

export default MailerService.getInstance();