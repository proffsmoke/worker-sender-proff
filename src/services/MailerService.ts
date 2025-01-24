import logger from '../utils/logger';
import config from '../config';
import EmailService from './EmailService';
import LogParser, { LogEntry } from '../log-parser';
import BlockManagerService from './BlockManagerService';
import StateManager from './StateManager';
import { v4 as uuidv4 } from 'uuid';

interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
  name?: string;
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
  private stateManager: StateManager;
  private isMonitoringStarted: boolean = false;

  private constructor() {
    this.createdAt = new Date();
    this.logParser = new LogParser('/var/log/mail.log');
    this.emailService = EmailService.getInstance(this.logParser);
    this.blockManagerService = BlockManagerService.getInstance(this);
    this.stateManager = new StateManager();

    if (!this.isMonitoringStarted) {
      this.logParser.on('log', this.handleLogEntry.bind(this));
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
        this.scheduleRetry(); // Agendar tentativa de reenvio
      } else {
        this.clearRetryInterval(); // Cancelar qualquer tentativa de reenvio agendada
      }
    }
  }

  unblockMailer(): void {
    if (this.isBlocked && !this.isBlockedPermanently) {
      this.isBlocked = false;
      this.blockReason = null;
      logger.info('Mailer desbloqueado.');
      this.clearRetryInterval(); // Cancelar intervalo de tentativa de reenvio
    }
  }

  private scheduleRetry(): void {
    if (this.isBlockedPermanently) {
      logger.info('Mailer está permanentemente bloqueado. Não tentará reenviar emails.');
      return;
    }

    if (this.retryIntervalId) {
      return; // Se já existe uma tentativa agendada, não faz nada
    }

    logger.info('Agendando tentativa de reenviar email de teste a cada 4 minutos.');
    this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000); // Reenvio a cada 4 minutos
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

  public async sendInitialTestEmail(): Promise<{ success: boolean; recipients: RecipientStatus[] }> {
    const testEmailParams = {
      fromName: 'Mailer Test',
      emailDomain: config.mailer.noreplyEmail.split('@')[1] || 'unknown.com',
      to: config.mailer.noreplyEmail,
      bcc: [],
      subject: 'Email de Teste Inicial',
      html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
      clientName: 'Prasminha camarada'
    };

    try {
      const result = await this.emailService.sendEmail(testEmailParams);

      logger.info(`Email de teste enviado com queueId=${result.queueId}`, { result });

      const requestUuid = uuidv4(); // Gerando um UUID único
      logger.info(`UUID gerado para o teste: ${requestUuid}`);

      this.stateManager.addQueueIdToUuid(requestUuid, result.queueId);
      logger.info(`Associado queueId ${result.queueId} ao UUID ${requestUuid}`);

      const logEntry = await this.waitForLogEntry(result.queueId);
      logger.info(`Esperando log para queueId=${result.queueId}. Conteúdo aguardado: ${JSON.stringify(logEntry)}`);

      if (logEntry && logEntry.success) {
        logger.info(`Email de teste enviado com sucesso. Status do Mailer: health`);
        this.unblockMailer();
        return { success: true, recipients: result.recipients };
      } else {
        logger.warn(`Falha ao enviar email de teste. LogEntry: ${JSON.stringify(logEntry)}`);
        this.blockMailer('blocked_temporary', 'Falha no envio do email de teste.');
        return { success: false, recipients: result.recipients };
      }
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste: ${error.message}`, error);
      this.blockMailer('blocked_temporary', `Erro ao enviar email de teste: ${error.message}`);
      return { success: false, recipients: [] };
    }
  }

  private handleLogEntry(logEntry: LogEntry) {
    logger.info(`Log recebido para queueId=${logEntry.queueId}: ${JSON.stringify(logEntry)}`);
    this.processLogEntry(logEntry);
  }

  private async processLogEntry(logEntry: LogEntry) {
    if (this.getStatus() !== 'health') {
      logger.info(`Ignorando logEntry porque o Mailer está bloqueado. Status atual: ${this.getStatus()}`);
      return;
    }

    logger.info(`Processando log para queueId=${logEntry.queueId}: ${logEntry.result}`);

    // Atualiza o status do queueId com base no log
    await this.stateManager.updateQueueIdStatus(logEntry.queueId, logEntry.success);

    // Verifica se todos os destinatários de um e-mail ou lista de e-mails foram processados
    const sendData = this.stateManager.getPendingSend(logEntry.queueId);
    if (sendData) {
      const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
      const processedRecipients = sendData.results.filter((r: RecipientStatus) => r.success !== undefined).length;

      if (processedRecipients === totalRecipients) {
        // Exibir os dados consolidados antes de removê-los de pendingSends
        logger.info(`Dados consolidados para queueId=${logEntry.queueId}:`, sendData.results);

        // Consumir o array de resultados antes de removê-lo de pendingSends
        const resultsToConsolidate = [...sendData.results];
        this.stateManager.deletePendingSend(logEntry.queueId); // Remover o queueId da lista de pendentes

        // Gerar a mensagem consolidada de forma assíncrona, esperando todos os logs
        await this.sendConsolidatedResults(resultsToConsolidate, logEntry.queueId);
      }
    }
  }

  private async sendConsolidatedResults(results: any[], queueId: string): Promise<void> {
    logger.info(`Aguardando todos os logs para a consolidação de resultados para queueId=${queueId}`);

    // Consolidar os resultados
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    // Exibe no log os resultados consolidados
    logger.info(`Todos os recipients processados para queueId=${queueId}. Resultados consolidados:`);
    logger.info(`Resumo para queueId=${queueId}:`);
    logger.info(`Emails enviados com sucesso: ${successCount}`);
    logger.info(`Emails com falha: ${failureCount}`);

    // Se houver falhas, logar os detalhes
    if (failureCount > 0) {
      logger.error(`Falha no envio de ${failureCount} emails para queueId=${queueId}. Detalhes:`, results.filter(r => !r.success));
    }

    // Aqui você pode enviar os resultados consolidados para uma API, email ou qualquer outro serviço
    // Exemplo:
    // await this.sendResultsToApi(queueId, results);
  }

  private async waitForLogEntry(queueId: string): Promise<LogEntry | null> {
    return new Promise((resolve, reject) => {
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

      // Verificar se o log já existe para o queueId
      const logEntry = this.getLogEntryByQueueId(queueId);
      if (logEntry) {
        clearTimeout(timeout);
        resolve(logEntry);
      }
    });
  }

  private getLogEntryByQueueId(queueId: string): LogEntry | null {
    logger.info(`Verificando log para queueId=${queueId}`);
    const recentLogs = this.logParser.getRecentLogs();
    return recentLogs.find(log => log.queueId === queueId) || null;
  }
}

export default MailerService.getInstance();
