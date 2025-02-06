import logger from '../utils/logger';
import config from '../config';
import EmailService, { TestEmailResult } from './EmailService';
import LogParser, { LogEntry } from '../log-parser';
import BlockManagerService from './BlockManagerService';
import EmailStats from '../models/EmailStats';
import { v4 as uuidv4 } from 'uuid';
import EmailLog from '../models/EmailLog';

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
  private initialTestCompleted: boolean = false;

  /**
   * Flags para evitar reenvio imediato:
   */
  private isTestEmailSending: boolean = false;   // se já estamos enviando/testando
  private lastTestEmailAttempt: number = 0;      // timestamp da última tentativa de envio
  private readonly testEmailInterval: number = 4 * 60 * 1000; // intervalo de 4 min

  private constructor() {
    this.createdAt = new Date();
    this.logParser = new LogParser('/var/log/mail.log');
    this.emailService = EmailService.getInstance(this.logParser);
    this.blockManagerService = BlockManagerService.getInstance(this);

    // Conectar logParser ao BlockManagerService
    this.logParser.on('log', (logEntry: LogEntry) => {
      this.blockManagerService.handleLogEntry(logEntry);
    });

    // Inicia leitura do /var/log/mail.log (caso ainda não tenha iniciado).
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

  initialize(): void {
    if (!this.isBlockedPermanently) {
      this.sendInitialTestEmail();
    } else {
      logger.warn('Mailer is permanently blocked. Initial test omitted.');
    }
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
    // Se ainda não concluímos o teste inicial, retorna "disabled".
    if (!this.initialTestCompleted) {
      return 'disabled';
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
    if (this.isBlockedPermanently) return;

    if (status === 'blocked_permanently') {
      this.isBlocked = true;
      this.isBlockedPermanently = true;
      this.blockReason = reason;
      logger.warn(`🚨 PERMANENT BLOCK APPLIED: ${reason}`);
      this.clearRetryInterval();
      return;
    }

    if (!this.isBlocked) {
      this.isBlocked = true;
      this.blockReason = reason;
      logger.warn(`⏳ TEMPORARY BLOCK APPLIED: ${reason}`);
      this.scheduleRetry();
    }
  }

  unblockMailer(): void {
    if (this.isBlocked && !this.isBlockedPermanently) {
      this.isBlocked = false;
      this.blockReason = null;
      logger.info('Mailer unblocked.');
      this.clearRetryInterval();
    }
  }

  private scheduleRetry(): void {
    if (this.isBlockedPermanently) {
      logger.info('Mailer is permanently blocked. No retries will be attempted.');
      return;
    }
    // Se já tiver um interval ativo, não agenda outro
    if (this.retryIntervalId) {
      return;
    }
    logger.info('Scheduling test email retry every 4 minutes.');
    this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000);
  }

  private clearRetryInterval(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
      logger.info('Retry interval cleared.');
    }
  }

  private async retrySendEmail(): Promise<void> {
    // Se não está mais bloqueado (ou virou bloqueio permanente), encerra
    if (!this.isBlocked || this.isBlockedPermanently) {
      this.clearRetryInterval();
      logger.info('Mailer is not temporarily blocked. Canceling retries.');
      return;
    }

    logger.info('Attempting to resend test email...');
    const result = await this.sendInitialTestEmail();

    if (result.success) {
      logger.info('Test email resend successful. Canceling further retries.');
      this.clearRetryInterval();
    }
  }

  /**
   * Envia o teste inicial e, em caso de sucesso, define o teste como concluído.
   * Agora com bloqueio para evitar múltiplas tentativas em curto prazo.
   */
  public async sendInitialTestEmail(): Promise<TestEmailResult> {
    // Se já bloqueado permanentemente, sai
    if (this.isBlockedPermanently) {
      logger.warn('Mailer is permanently blocked. Test omitted.');
      return { success: false };
    }

    // Se já concluímos o teste, não precisa reenviar
    if (this.initialTestCompleted) {
      logger.info('Initial test already completed successfully. Skipping test email.');
      return { success: true };
    }

    // Se já estamos tentando enviar teste (aguardando retorno), não dispara outro
    if (this.isTestEmailSending) {
      logger.warn('A test email send is already in progress. Skipping...');
      return { success: false };
    }

    // Se ainda não se passaram 4 min desde a última tentativa, não enviar de novo
    const now = Date.now();
    if (now - this.lastTestEmailAttempt < this.testEmailInterval) {
      logger.warn(
        `Last test email attempt was too recent (${Math.round(
          (now - this.lastTestEmailAttempt) / 1000
        )}s ago). Skipping...`
      );
      return { success: false };
    }

    // Marca que estamos enviando e atualiza o timestamp
    this.isTestEmailSending = true;
    this.lastTestEmailAttempt = now;

    const testEmailParams = {
      fromName: 'Mailer Test',
      emailDomain: config.mailer.noreplyEmail.split('@')[1] || 'unknown.com',
      to: config.mailer.noreplyEmail,
      bcc: [],
      subject: 'Initial Test Email',
      html: '<p>This is an initial test email to verify Mailer functionality.</p>',
      clientName: 'Test Client',
    };

    try {
      const requestUuid = uuidv4();
      logger.info(`UUID generated for test: ${requestUuid}`);
      const result = await this.emailService.sendEmail(testEmailParams, requestUuid);
      const queueId = result.queueId;
      logger.info(`Test email sent with queueId=${queueId}`);

      // Aguarda log do MTA (até 1 min) pra ver se deu sucesso
      const logEntry = await this.waitForLogEntry(queueId, 60000);

      if (logEntry && logEntry.success) {
        logger.info(`Test email sent successfully. mailId: ${logEntry.mailId}`);
        this.unblockMailer();
        this.initialTestCompleted = true; // <- teste inicial concluído
        return { success: true, mailId: logEntry.mailId };
      } else {
        logger.warn(`Failed to send test email. Details: ${JSON.stringify(logEntry)}`);
        if (!this.isBlockedPermanently) {
          this.blockMailer('blocked_temporary', 'Failed to send test email.');
        }
        return { success: false, mailId: logEntry?.mailId };
      }
    } catch (error: any) {
      logger.error(`Error sending test email: ${error.message}`, error);
      if (!this.isBlockedPermanently) {
        this.blockMailer('blocked_temporary', `Error sending test email: ${error.message}`);
      }
      await EmailStats.incrementFail();
      return { success: false };
    } finally {
      // Ao final (com sucesso ou erro), desbloqueia o "envio em progresso"
      this.isTestEmailSending = false;
    }
  }

  private async waitForLogEntry(queueId: string, timeout: number): Promise<LogEntry | null> {
    return new Promise((resolve) => {
      const checkInterval = 500;
      let elapsedTime = 0;

      const intervalId = setInterval(async () => {
        const emailLog = await EmailLog.findOne({ queueId: queueId });

        if (emailLog && emailLog.success !== null) {
          clearInterval(intervalId);
          const logEntry: LogEntry = {
            timestamp: emailLog.sentAt.toISOString(),
            queueId: emailLog.queueId,
            email: emailLog.email,
            result: emailLog.success ? 'sent' : 'failed',
            success: emailLog.success,
            mailId: emailLog.mailId,
          };
          resolve(logEntry);
        } else {
          elapsedTime += checkInterval;
          if (elapsedTime >= timeout) {
            clearInterval(intervalId);
            resolve(null);
          }
        }
      }, checkInterval);
    });
  }
}

export default MailerService;