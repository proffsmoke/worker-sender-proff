import PortCheckService from './PortCheckService';
import logger from '../utils/logger';
import config from '../config';
import EmailService from './EmailService';
import { v4 as uuidv4 } from 'uuid';
import BlockManagerService from './BlockManagerService'; // Import adicionado

class MailerService {
  private isBlocked: boolean = false;
  private isBlockedPermanently: boolean = false;
  private createdAt: Date;
  private version: string = '4.3.26-1';
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.createdAt = new Date();
    this.initialize();
  }

  async initialize() {
    await this.checkPortAndUpdateStatus();

    if (!this.isBlockedPermanently) {
      this.intervalId = setInterval(() => this.checkPortAndUpdateStatus(), config.mailer.checkInterval);
    }

    // Enviar email de teste ao iniciar
    this.sendInitialTestEmail();
  }

  async checkPortAndUpdateStatus() {
    if (this.isBlockedPermanently) {
      logger.info('Mailer está permanentemente bloqueado. Não será verificada novamente a porta.');
      return;
    }

    const openPort = await PortCheckService.verifyPort('smtp.gmail.com', [25]);
    if (!openPort && !this.isBlocked) {
      this.blockMailer('blocked_permanently');
      logger.warn('Nenhuma porta disponível. Mailer bloqueado permanentemente.');
    } else if (openPort) {
      logger.info(`Porta ${openPort} aberta. Mailer funcionando normalmente.`);
    }
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

  isPort25Open(): boolean {
    return !this.isBlocked;
  }

  getVersion(): string {
    return this.version;
  }

  blockMailer(status: 'blocked_permanently' | 'blocked_temporary'): void {
    if (!this.isBlocked) {
      this.isBlocked = true;
      if (status === 'blocked_permanently') {
        this.isBlockedPermanently = true;
      }
      logger.warn(`Mailer bloqueado com status: ${status}`);
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }
  }

  unblockMailer(): void {
    if (this.isBlocked && !this.isBlockedPermanently) {
      this.isBlocked = false;
      logger.info('Mailer desbloqueado.');
      this.initialize();
    }
  }

  async sendInitialTestEmail(): Promise<{ success: boolean }> { // Alterado para retornar um objeto com sucesso
    const testUuid = uuidv4();
    const testEmailParams = {
      fromName: 'Mailer Test',
      emailDomain: config.mailer.noreplyEmail.split('@')[1] || 'unknown.com',
      to: config.mailer.noreplyEmail,
      bcc: [],
      subject: 'Email de Teste Inicial',
      html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
      uuid: testUuid,
    };

    try {
      const result = await EmailService.sendEmail(testEmailParams);
      logger.info(`Email de teste enviado com mailId=${result.mailId}`, { result });

      // Atualizar o status do Mailer baseado no resultado do email de teste
      const allSuccess = result.recipients.every((r) => r.success);
      if (allSuccess) {
        logger.info('Email de teste enviado com sucesso. Status do Mailer: health');
        // Garantir que o status não esteja bloqueado
        this.unblockMailer();
        return { success: true };
      } else {
        logger.warn('Falha ao enviar email de teste. Verifique os logs para mais detalhes.');
        // Bloquear o Mailer temporariamente
        this.blockMailer('blocked_temporary');
        return { success: false };
      }
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste: ${error.message}`, error);
      // Bloquear o Mailer temporariamente
      this.blockMailer('blocked_temporary');
      return { success: false };
    }
  }
}

export default new MailerService();
