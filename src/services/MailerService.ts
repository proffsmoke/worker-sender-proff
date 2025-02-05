import logger from '../utils/logger';
import config from '../config';
import EmailService, { TestEmailResult } from './EmailService';
import LogParser, { LogEntry } from '../log-parser';
import BlockManagerService from './BlockManagerService';
import EmailStats from '../models/EmailStats';
import { v4 as uuidv4 } from 'uuid';
import EmailLog from '../models/EmailLog';

interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
  name?: string;
  queueId?: string;
  logEntry?: LogEntry;
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
  // Nova propriedade para indicar se o teste inicial foi concluído com sucesso.
  private initialTestCompleted: boolean = false;

  private constructor() {
    this.createdAt = new Date();
    this.logParser = new LogParser('/var/log/mail.log');
    this.emailService = EmailService.getInstance(this.logParser);
    this.blockManagerService = BlockManagerService.getInstance(this);

    // Conectar o LogParser ao BlockManagerService
    this.logParser.on('log', (logEntry: LogEntry) => {
      this.blockManagerService.handleLogEntry(logEntry);
    });

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

  /**
   * Modificado para retornar "disabled" enquanto o teste inicial não for concluído.
   */
  getStatus(): string {
    if (this.isBlockedPermanently) {
      return 'blocked_permanently';
    }
    if (this.isBlocked) {
      return 'blocked_temporary';
    }
    // Enquanto o teste inicial não for concluído, retorna "disabled".
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
    // Se já está permanentemente bloqueado, mantém o estado
    if (this.isBlockedPermanently) return;

    // Prioriza bloqueios permanentes
    if (status === 'blocked_permanently') {
      this.isBlocked = true;
      this.isBlockedPermanently = true;
      this.blockReason = reason;
      logger.warn(`🚨 PERMANENT BLOCK APPLIED: ${reason}`);
      this.clearRetryInterval();
      return;
    }

    // Aplica bloqueio temporário apenas se não estiver bloqueado
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
   */
  public async sendInitialTestEmail(): Promise<TestEmailResult> {
    if (this.isBlockedPermanently) {
      logger.warn('Mailer is permanently blocked. Test omitted.');
      return { success: false };
    }

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

      const logEntry = await this.waitForLogEntry(queueId, 60000);

      if (logEntry && logEntry.success) {
        logger.info(`Test email sent successfully. mailId: ${logEntry.mailId}`);
        this.unblockMailer();
        // Marca que o teste inicial foi concluído com sucesso.
        this.initialTestCompleted = true;
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