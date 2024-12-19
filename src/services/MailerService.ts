// src/services/MailerService.ts

import PortCheckService from './PortCheckService';
import logger from '../utils/logger';
import config from '../config';
import EmailService from './EmailService'; // Import adicionado
import { v4 as uuidv4 } from 'uuid'; // Import para gerar UUID

class MailerService {
  private isBlocked: boolean = false;
  private isBlockedPermanently: boolean = false;
  private createdAt: Date;
  private version: string = '4.3.26-1';
  private intervalId: NodeJS.Timeout | null = null;
  private retryTimeoutId: NodeJS.Timeout | null = null; // Novo atributo para gerenciar retries

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

    const openPort = await PortCheckService.verifyPort('smtp.gmail.com', [25]); // Alterado para smtp.gmail.com e porta 25
    if (!openPort && !this.isBlocked) {
      this.blockMailer('blocked_permanently');
      logger.warn('Nenhuma porta disponível. Mailer bloqueado permanentemente.');
    } else if (openPort) {
      logger.info(`Porta ${openPort} aberta. Mailer funcionando normalmente.`);
      // Se estava temporariamente bloqueado, desbloquear
      if (this.isBlocked && !this.isBlockedPermanently) {
        this.unblockMailer();
      }
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

      if (status === 'blocked_temporary') {
        // Agendar a tentativa de desbloqueio após 5 minutos
        this.retryTimeoutId = setTimeout(() => {
          this.retryUnblock();
        }, config.mailer.temporaryBlockDuration);
        logger.info('Tentativa de desbloqueio agendada para bloqueio temporário em 5 minutos.');
      }
    }
  }

  async retryUnblock() {
    if (this.isBlockedPermanently) {
      logger.info('Mailer está permanentemente bloqueado. Tentativa de reativação não será realizada.');
      return;
    }

    logger.info('Tentando reativar o Mailer após bloqueio temporário.');

    try {
      // Enviar um email de teste para verificar se pode ser reativado
      await this.sendRetryTestEmail();
    } catch (error: any) {
      logger.error(`Falha na tentativa de reativação do Mailer: ${error.message}`);
      // Manter o bloqueio temporário e tentar novamente após o mesmo intervalo
      this.retryTimeoutId = setTimeout(() => {
        this.retryUnblock();
      }, config.mailer.temporaryBlockDuration);
      logger.info('Nova tentativa de reativação agendada para bloqueio temporário.');
    }
  }

  private async sendRetryTestEmail() {
    const testUuid = uuidv4();
    const testEmailParams = {
      fromName: 'Mailer Retry Test',
      emailDomain: config.mailer.noreplyEmail.split('@')[1] || 'unknown.com',
      to: config.mailer.noreplyEmail,
      bcc: [],
      subject: 'Tentativa de Reativação do Mailer',
      html: '<p>Este é um email de teste para verificar se o Mailer pode ser reativado após bloqueio temporário.</p>',
      uuid: testUuid,
    };

    try {
      const result = await EmailService.sendEmail(testEmailParams);
      logger.info(`Email de teste de reativação enviado com mailId=${result.mailId}`, { result });

      // Verificar se o email de teste foi enviado com sucesso
      const allSuccess = result.recipients.every((r) => r.success);
      if (allSuccess) {
        logger.info('Email de teste de reativação enviado com sucesso. Mailer será desbloqueado.');
        this.unblockMailer();
      } else {
        logger.warn('Falha ao enviar email de teste de reativação. Mailer permanecerá bloqueado temporariamente.');
        // Manter o bloqueio temporário e agendar nova tentativa
        this.retryTimeoutId = setTimeout(() => {
          this.retryUnblock();
        }, config.mailer.temporaryBlockDuration);
      }
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste de reativação: ${error.message}`);
      // Manter o bloqueio temporário e agendar nova tentativa
      this.retryTimeoutId = setTimeout(() => {
        this.retryUnblock();
      }, config.mailer.temporaryBlockDuration);
    }
  }

  unblockMailer(): void {
    if (this.isBlocked && !this.isBlockedPermanently) {
      this.isBlocked = false;
      logger.info('Mailer desbloqueado.');
      this.initialize();
    }
  }

  private async sendInitialTestEmail() {
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
      } else {
        logger.warn('Falha ao enviar email de teste. Verifique os logs para mais detalhes.');
        // Opcional: bloquear o Mailer se o email de teste falhar
        this.blockMailer('blocked_temporary');
      }
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste: ${error.message}`, error);
      // Opcional: bloquear o Mailer se ocorrer um erro ao enviar o email de teste
      this.blockMailer('blocked_temporary');
    }
  }
}

export default new MailerService();
