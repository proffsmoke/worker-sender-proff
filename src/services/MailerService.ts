import logger from '../utils/logger';
import config from '../config';
import EmailService, { TestEmailResult } from './EmailService';
import LogParser, { LogEntry } from '../log-parser';
import BlockManagerService from './BlockManagerService';
import EmailStats from '../models/EmailStats'; // Importado para atualizar estatísticas
import { v4 as uuidv4 } from 'uuid';
import EmailLog from '../models/EmailLog';
import os from 'os'; // Adicionado para obter o hostname

interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
  name?: string;
  queueId?: string;
  logEntry?: LogEntry; // Adicionado para incluir o log completo
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

  initialize(): void {
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
    if (!this.isBlocked || this.isBlockedPermanently) {
      this.clearRetryInterval();
      logger.info('Mailer não está bloqueado temporariamente. Cancelando tentativas de reenvio.');
      return;
    }

    logger.info('Tentando reenviar email de teste...');
    const result = await this.sendInitialTestEmail();

    if (result.success) {
      logger.info('Reenvio de email de teste bem-sucedido. Cancelando futuras tentativas.');
      this.clearRetryInterval();
    }
  }

  public async sendInitialTestEmail(): Promise<TestEmailResult> {
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
        const result = await this.emailService.sendEmail(testEmailParams, requestUuid);
        const queueId = result.queueId;
        logger.info(`Email de teste enviado com queueId=${queueId}`);

        const logEntry = await this.waitForLogEntry(queueId, 60000);

        if (logEntry?.success) {
            logger.info(`Email de teste enviado com sucesso. mailId: ${logEntry.mailId}`);
            this.unblockMailer();
            return { success: true, mailId: logEntry.mailId };
        } else {
            const errorMessage = logEntry 
                ? `Falha: ${logEntry.result}` 
                : 'Timeout sem confirmação';
            
            logger.warn(`Falha no teste: ${errorMessage}`);
            this.blockMailer('blocked_temporary', errorMessage);
            
            return { 
                success: false,
                mailId: logEntry?.mailId || '' // Mantém compatibilidade com o tipo
            };
        }
    } catch (error: any) {
        const errorMessage = error instanceof Error 
            ? error.message 
            : 'Erro desconhecido';
        
        logger.error(`Falha crítica: ${errorMessage}`);
        await EmailStats.incrementFail();
        this.blockMailer('blocked_temporary', errorMessage);
        
        return { 
            success: false,
            mailId: '' // Valor vazio para manter a estrutura
        };
    }
}

  private async waitForLogEntry(queueId: string, timeout: number): Promise<LogEntry | null> {
    return new Promise((resolve) => {
      const checkInterval = 500; // Intervalo de checagem em ms
      let elapsedTime = 0;

      const intervalId = setInterval(async () => {
        const emailLog = await EmailLog.findOne({ queueId: queueId });

        if (emailLog && emailLog.success) {
          clearInterval(intervalId);
          // Converter o documento do Mongoose para LogEntry
          const logEntry: LogEntry = {
            timestamp: emailLog.sentAt.toISOString(),
            queueId: emailLog.queueId,
            email: emailLog.email,
            result: emailLog.success ? 'sent' : 'failed', // Ou outra lógica baseada em suas necessidades
            success: emailLog.success,
            mailId: emailLog.mailId,
          };
          resolve(logEntry);
        } else {
          elapsedTime += checkInterval;
          if (elapsedTime >= timeout) {
            clearInterval(intervalId);
            resolve(null); // Timeout
          }
        }
      }, checkInterval);
    });
  }

  // Métodos adicionais para obter informações do sistema
  public getSystemInfo() {
    const version = this.getVersion();
    const createdAt = this.getCreatedAt().getTime();

    // Calcular o domínio do hostname do sistema
    const hostname = os.hostname();
    const domainParts = hostname.split('.').slice(1);
    const domain = domainParts.length > 0 ? domainParts.join('.') : 'unknown.com';

    const status = this.getStatus();
    const blockReason = this.getBlockReason();

    return {
      version,
      createdAt,
      hostname,
      domain,
      status,
      blockReason,
    };
  }
}

// Exporta a CLASSE para uso em tipagem
export default MailerService;