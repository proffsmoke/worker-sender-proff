import PortCheckService from './PortCheckService';
import logger from '../utils/logger';
import config from '../config';

class MailerService {
  private isBlocked: boolean = false;
  private isBlockedPermanently: boolean = false;
  private createdAt: Date;
  private version: string = '4.3.26-1'; // Atualize conforme necessário
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
  }

  async checkPortAndUpdateStatus() {
    if (this.isBlockedPermanently) {
      logger.info('Mailer está permanentemente bloqueado. Não será verificada novamente a porta.');
      return;
    }

    const openPort = await PortCheckService.verifyPort('0.0.0.0', [25, 587, 465]); // Verifica múltiplas portas
    if (!openPort && !this.isBlocked) {
      this.blockMailer('blocked_permanently'); // Bloqueio permanente
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
      this.initialize(); // Recomeça as verificações periódicas
    }
  }
}

export default new MailerService();
