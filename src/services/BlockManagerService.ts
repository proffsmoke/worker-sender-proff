import logger from '../utils/logger';
import MailerService from './MailerService'; // Importando o MailerService

class BlockManagerService {
  private static instance: BlockManagerService; // Singleton instance
  private mailerService: typeof MailerService; // Usando typeof para referenciar o tipo da classe

  private constructor(mailerService: typeof MailerService) {
    this.mailerService = mailerService;
  }

  // Método estático para obter a instância única do BlockManagerService
  public static getInstance(mailerService: typeof MailerService): BlockManagerService {
    if (!BlockManagerService.instance) {
      BlockManagerService.instance = new BlockManagerService(mailerService);
    }
    return BlockManagerService.instance;
  }

  public handleLogEntry(logEntry: any) {
    if (this.mailerService.getStatus() !== 'health') {
      logger.info(`Ignorando logEntry porque o Mailer está bloqueado. Status atual: ${this.mailerService.getStatus()}`);
      return;
    }

    const { message } = logEntry;

    if (typeof message !== 'string') {
      logger.warn('Log entry missing or invalid message:', logEntry);
      return;
    }

    // Verifica se o erro é permanente ou temporário e aplica o bloqueio correspondente
    if (this.isPermanentError(message)) {
      this.applyBlock('permanent', message);
      logger.info(`Bloqueio permanente aplicado devido à linha de log: "${message}"`);
    } else if (this.isTemporaryError(message)) {
      this.applyBlock('temporary', message);
      logger.info(`Bloqueio temporário aplicado devido à linha de log: "${message}"`);
    }
  }

  private isPermanentError(message: string): boolean {
    // Lógica para identificar erros permanentes
    return message.includes('permanent');
  }

  private isTemporaryError(message: string): boolean {
    // Lógica para identificar erros temporários
    return message.includes('temporary');
  }

  private applyBlock(type: 'permanent' | 'temporary', reason: string) {
    if (type === 'permanent') {
      this.mailerService.blockMailer('blocked_permanently', reason);
    } else {
      this.mailerService.blockMailer('blocked_temporary', reason);
    }
  }
}

export default BlockManagerService;