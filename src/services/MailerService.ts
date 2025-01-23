import logger from '../utils/logger';
import config from '../config';
import EmailService from './EmailService';
import LogParser, { LogEntry } from '../log-parser';
import BlockManagerService from './BlockManagerService';
import StateManager from './StateManager';  // Importando o StateManager
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
  private stateManager: StateManager;  // Adicionando o stateManager
  private isMonitoringStarted: boolean = false;

  private constructor() {
    this.createdAt = new Date();
    this.logParser = new LogParser('/var/log/mail.log');
    this.emailService = EmailService.getInstance(this.logParser);
    this.blockManagerService = BlockManagerService.getInstance(this);
    this.stateManager = new StateManager();  // Inicializando o stateManager

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

  public async sendInitialTestEmail(): Promise<{ success: boolean; recipients: RecipientStatus[] }> {
    // Verifica se o Mailer está bloqueado antes de enviar o email
    if (this.getStatus() === 'health') {
      logger.info("Mailer está em estado 'health', não enviando email de teste.");
      return { success: true, recipients: [] };  // Retorna sem enviar o email
    }
    
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

  private processLogEntry(logEntry: LogEntry) {
    if (this.getStatus() !== 'health') {
      logger.info(`Ignorando logEntry porque o Mailer está bloqueado. Status atual: ${this.getStatus()}`);
      return;
    }
  
    logger.info(`Processando log para queueId=${logEntry.queueId}: ${logEntry.result}`);
    
    if (logEntry.success) {
      logger.info(`Email com queueId=${logEntry.queueId} foi enviado com sucesso.`);
    } else {
      logger.warn(`Falha no envio para queueId=${logEntry.queueId}: ${logEntry.result}`);
    }
  
    // Processar status de todos os destinatários
    this.blockManagerService.handleLogEntry(logEntry);
  
    // Verificar se todos os destinatários de um e-mail ou lista de e-mails foram processados
    const sendData = this.stateManager.getPendingSend(logEntry.queueId);
    if (sendData) {
      const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
      const processedRecipients = sendData.results.filter((r: RecipientStatus) => r.success !== undefined).length;
  
      if (processedRecipients === totalRecipients) {
        // Todos os destinatários foram processados, gerar a mensagem consolidada
        const consolidatedMessage = sendData.results.map((r: RecipientStatus) => {
          return {
            email: r.recipient,
            name: r.name || 'Desconhecido',  // Certificando-se que 'name' é tratado
            result: r.success 
              ? 'Sucesso' 
              : `Falha: ${r.error || 'Erro desconhecido'}`  // Garantir que o erro seja incluído corretamente
          };
        });
  
        logger.info(`Todos os recipients processados para queueId=${logEntry.queueId}. Resultados consolidados:`, consolidatedMessage);
        this.stateManager.deletePendingSend(logEntry.queueId); // Remover da lista de pendentes
  
        // Enviar os resultados consolidados, se necessário (para uma API, email, etc.)
        this.sendConsolidatedResults(consolidatedMessage);
      }
    }
  }
  

  private async sendConsolidatedResults(results: any[]): Promise<void> {
    // Exemplo de como você pode enviar esses resultados a uma API ou outro serviço
    logger.info('Enviando resultados consolidados para API ou outro serviço:', results);
    // Aqui você pode implementar a lógica de envio dos dados consolidados
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

  public getEmailService(): EmailService {
    return this.emailService;
  }
}

export default MailerService.getInstance();
