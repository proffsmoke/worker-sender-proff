import logger from '../utils/logger';
import config from '../config';
import EmailService from './EmailService';
import { v4 as uuidv4 } from 'uuid';

class MailerService {
  private isBlocked: boolean = false;
  private isBlockedPermanently: boolean = false;
  private blockReason: string | null = null; // Novo campo para armazenar a razão do bloqueio
  private createdAt: Date;
  private version: string = '4.3.26-1';
  private retryIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.createdAt = new Date();
    this.initialize();
  }

  initialize() {
    // Enviar email de teste ao iniciar
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

  // Método para bloquear o Mailer com uma razão
  blockMailer(status: 'blocked_permanently' | 'blocked_temporary', reason: string): void {
    if (!this.isBlocked) {
      this.isBlocked = true;
      this.blockReason = reason; // Armazena a razão do bloqueio
      if (status === 'blocked_permanently') {
        this.isBlockedPermanently = true;
      }
      logger.warn(`Mailer bloqueado com status: ${status}. Razão: ${reason}`);
      if (status === 'blocked_temporary') {
        this.scheduleRetry(); // Agendar reenvio apenas para bloqueio temporário
      } else {
        this.clearRetryInterval(); // Cancelar reenvios se for bloqueio permanente
      }
    }
  }

  // Método para desbloquear o Mailer
  unblockMailer(): void {
    if (this.isBlocked && !this.isBlockedPermanently) {
      this.isBlocked = false;
      this.blockReason = null; // Limpa a razão do bloqueio
      logger.info('Mailer desbloqueado.');
      this.clearRetryInterval();
    }
  }

  getBlockReason(): string | null {
    return this.blockReason; // Método getter para obter a razão do bloqueio
  }

  // Método para enviar o email de teste inicial
  async sendInitialTestEmail(): Promise<{ success: boolean }> {
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

      // Verificar se todos os destinatários receberam o email com sucesso
      const allSuccess = result.recipients.every((r) => r.success);
      if (allSuccess) {
        logger.info('Email de teste enviado com sucesso. Status do Mailer: health');
        this.unblockMailer(); // Garantir que o Mailer esteja desbloqueado
        return { success: true };
      } else {
        logger.warn('Falha ao enviar email de teste. Verifique os logs para mais detalhes.');
        this.blockMailer('blocked_temporary', 'Falha no envio do email de teste.');
        return { success: false };
      }
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste: ${error.message}`, error);
      this.blockMailer('blocked_temporary', `Erro ao enviar email de teste: ${error.message}`);
      return { success: false };
    }
  }

  // Método para agendar tentativas de reenvio a cada 4 minutos
  private scheduleRetry(): void {
    if (this.isBlockedPermanently) {
      logger.info('Mailer está permanentemente bloqueado. Não tentará reenviar emails.');
      return;
    }

    if (this.retryIntervalId) {
      // Já existe um intervalo de retry agendado
      return;
    }

    logger.info('Agendando tentativa de reenviar email de teste a cada 4 minutos.');
    this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000); // 4 minutos
  }

  // Método para tentar reenviar o email de teste
  private async retrySendEmail(): Promise<void> {
    if (!this.isBlocked || this.isBlockedPermanently) {
      // Se não estiver temporariamente bloqueado, não tentar reenviar
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

  // Método para limpar o intervalo de reenvio
  private clearRetryInterval(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
      logger.info('Intervalo de tentativa de reenvio cancelado.');
    }
  }
}

export default new MailerService();
