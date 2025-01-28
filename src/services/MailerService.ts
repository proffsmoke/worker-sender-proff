import logger from '../utils/logger';
import config from '../config';
import EmailService, { TestEmailResult } from './EmailService';
import LogParser, { LogEntry } from '../log-parser';
import BlockManagerService from './BlockManagerService';
import EmailStats from '../models/EmailStats'; // Importado para atualizar estatísticas
import { v4 as uuidv4 } from 'uuid';

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
  private version: string = '4.3.26-1'; // Versão atual do serviço
  private retryIntervalId: NodeJS.Timeout | null = null;
  private logParser: LogParser;
  private emailService: EmailService;
  private blockManagerService: BlockManagerService;
  private isMonitoringStarted: boolean = false;

  /**
   * Construtor privado para suportar o padrão Singleton.
   */
  private constructor() {
    this.createdAt = new Date();
    this.logParser = new LogParser('/var/log/mail.log'); // Instancia o LogParser
    this.emailService = EmailService.getInstance(this.logParser); // Obtém a instância do EmailService, passando o LogParser
    this.blockManagerService = BlockManagerService.getInstance(this); // Instancia o BlockManagerService

    // Inicia o monitoramento do log, se ainda não tiver sido iniciado
    if (!this.isMonitoringStarted) {
      this.logParser.startMonitoring();
      this.isMonitoringStarted = true;
    }

    this.initialize(); // Inicializa o serviço
  }

  /**
   * Retorna a instância única do MailerService (Singleton).
   * @returns A instância do MailerService.
   */
  public static getInstance(): MailerService {
    if (!MailerService.instance) {
      MailerService.instance = new MailerService();
    }
    return MailerService.instance;
  }

  /**
   * Inicializa o serviço, enviando um email de teste inicial.
   */
  initialize(): void {
    this.sendInitialTestEmail();
  }

  /**
   * Retorna a versão atual do serviço.
   * @returns A versão do serviço.
   */
  getVersion(): string {
    return this.version;
  }

  /**
   * Retorna a data de criação do serviço.
   * @returns A data de criação.
   */
  getCreatedAt(): Date {
    return this.createdAt;
  }

  /**
   * Retorna o status atual do serviço.
   * @returns O status: 'health', 'blocked_temporary' ou 'blocked_permanently'.
   */
  getStatus(): string {
    if (this.isBlockedPermanently) {
      return 'blocked_permanently';
    }
    if (this.isBlocked) {
      return 'blocked_temporary';
    }
    return 'health';
  }

  /**
   * Retorna a razão do bloqueio atual, se houver.
   * @returns A razão do bloqueio ou null.
   */
  getBlockReason(): string | null {
    return this.blockReason;
  }

  /**
   * Verifica se o serviço está bloqueado temporariamente.
   * @returns True se estiver bloqueado, false caso contrário.
   */
  isMailerBlocked(): boolean {
    return this.isBlocked;
  }

  /**
   * Verifica se o serviço está bloqueado permanentemente.
   * @returns True se estiver bloqueado permanentemente, false caso contrário.
   */
  isMailerPermanentlyBlocked(): boolean {
    return this.isBlockedPermanently;
  }

  /**
   * Bloqueia o serviço temporariamente ou permanentemente.
   * @param status - 'blocked_temporary' ou 'blocked_permanently'.
   * @param reason - A razão do bloqueio.
   */
  blockMailer(status: 'blocked_permanently' | 'blocked_temporary', reason: string): void {
    if (!this.isBlocked) {
      this.isBlocked = true;
      this.blockReason = reason;
      if (status === 'blocked_permanently') {
        this.isBlockedPermanently = true;
      }
      logger.warn(`Mailer bloqueado com status: ${status}. Razão: ${reason}`);
      if (status === 'blocked_temporary') {
        this.scheduleRetry(); // Agenda tentativas de reenvio
      } else {
        this.clearRetryInterval(); // Cancela tentativas de reenvio
      }
    }
  }

  /**
   * Desbloqueia o serviço, se estiver bloqueado temporariamente.
   */
  unblockMailer(): void {
    if (this.isBlocked && !this.isBlockedPermanently) {
      this.isBlocked = false;
      this.blockReason = null;
      logger.info('Mailer desbloqueado.');
      this.clearRetryInterval();
    }
  }

  /**
   * Agenda tentativas de reenvio de email de teste a cada 4 minutos.
   */
  private scheduleRetry(): void {
    if (this.isBlockedPermanently) {
      logger.info('Mailer está permanentemente bloqueado. Não tentará reenviar emails.');
      return;
    }

    if (this.retryIntervalId) {
      return; // Já existe um intervalo agendado
    }

    logger.info('Agendando tentativa de reenviar email de teste a cada 4 minutos.');
    this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000); // 4 minutos
  }

  /**
   * Cancela o intervalo de tentativas de reenvio.
   */
  private clearRetryInterval(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
      logger.info('Intervalo de tentativa de reenvio cancelado.');
    }
  }

  /**
   * Tenta reenviar o email de teste.
   */
  private async retrySendEmail(): Promise<void> {
    if (!this.isBlocked || this.isBlockedPermanently) {
      this.clearRetryInterval();
      logger.info('Mailer não está bloqueado temporariamente. Cancelando tentativas de reenvio.');
      return;
    }

    logger.info('Tentando reenviar email de teste...');
    const result = await this.sendInitialTestEmail(); // Reenvia o email de teste

    if (result.success) {
      logger.info('Reenvio de email de teste bem-sucedido. Cancelando futuras tentativas.');
      this.clearRetryInterval();
      this.unblockMailer(); // Desbloqueia o serviço
    }
  }

  /**
   * Envia um email de teste inicial para verificar o funcionamento do serviço.
   * @returns Um objeto indicando o sucesso do envio e os recipients, incluindo o mailId do teste.
   */
  public async sendInitialTestEmail(): Promise<{ success: boolean; recipients: RecipientStatus[], mailId?: string }> {
    const testEmailParams = {
      fromName: 'Mailer Test',
      emailDomain: config.mailer.noreplyEmail.split('@')[1] || 'unknown.com', // Domínio do email de teste
      to: config.mailer.noreplyEmail, // Destinatário do email de teste
      bcc: [],
      subject: 'Email de Teste Inicial',
      html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
      clientName: 'Prasminha camarada', // Nome do cliente (para personalização do assunto)
    };

    try {
      const requestUuid = uuidv4(); // Gera um UUID único para o teste
      logger.info(`UUID gerado para o teste: ${requestUuid}`);

      // Envia o email de teste usando o EmailService, passando o UUID
      const result = await this.emailService.sendEmail(testEmailParams, requestUuid);

      logger.info(`Email de teste enviado com queueId=${result.queueId}`, { result });

      // Incrementar a contagem de emails enviados
      await EmailStats.incrementSent();

      // Aguarda pelo resultado do teste usando o método waitForTestEmailResult do EmailService
      const testResult: TestEmailResult = await this.emailService.waitForTestEmailResult(requestUuid);

      if (testResult.success) {
        logger.info(`Email de teste enviado com sucesso. Status do Mailer: health. mailId: ${testResult.mailId}`);
        this.unblockMailer(); // Desbloqueia o mailer
        return { success: true, recipients: [result.recipient], mailId: testResult.mailId };
      } else {
        logger.warn(`Falha ao enviar email de teste. mailId: ${testResult.mailId}`);
        this.blockMailer('blocked_temporary', 'Falha no envio do email de teste.'); // Bloqueia o mailer temporariamente
        return { success: false, recipients: [result.recipient], mailId: testResult.mailId };
      }
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste: ${error.message}`, error);

      // Incrementar falhas em caso de erro
      await EmailStats.incrementFail();

      this.blockMailer('blocked_temporary', `Erro ao enviar email de teste: ${error.message}`); // Bloqueia o mailer temporariamente
      return { success: false, recipients: [], mailId: undefined };
    }
  }
}

export default MailerService.getInstance();