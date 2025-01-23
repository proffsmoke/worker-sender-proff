import logger from '../utils/logger';
import MailerService from './MailerService';
import { LogEntry } from '../log-parser';

class BlockManagerService {
  private static instance: BlockManagerService;
  private mailerService: typeof MailerService;

  private constructor(mailerService: typeof MailerService) {
    this.mailerService = mailerService;
  }

  public static getInstance(mailerService: typeof MailerService): BlockManagerService {
    if (!BlockManagerService.instance) {
      BlockManagerService.instance = new BlockManagerService(mailerService);
    }
    return BlockManagerService.instance;
  }

  public handleLogEntry(logEntry: LogEntry) {
    if (this.mailerService.getStatus() !== 'health') {
      logger.info(`Ignorando logEntry porque o Mailer está bloqueado. Status atual: ${this.mailerService.getStatus()}`);
      return;
    }

    if (!logEntry || typeof logEntry !== 'object' || !logEntry.queueId || !logEntry.result) {
      logger.warn('Log entry missing or invalid:', logEntry);
      return;
    }

    if (this.isPermanentError(logEntry.result)) {
      this.applyBlock('permanent', logEntry.result);
      logger.info(`Bloqueio permanente aplicado devido à linha de log: "${logEntry.result}"`);
    } else if (this.isTemporaryError(logEntry.result)) {
      this.applyBlock('temporary', logEntry.result);
      logger.info(`Bloqueio temporário aplicado devido à linha de log: "${logEntry.result}"`);
    }
  }

  private isPermanentError(message: string): boolean {
    return message.includes('permanent');
  }

  private isTemporaryError(message: string): boolean {
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