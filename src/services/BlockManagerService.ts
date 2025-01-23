import LogParser from '../log-parser';
import BlockService from './BlockService';
import MailerService from './MailerService';
import config from '../config';
import logger from '../utils/logger';

// Definir a interface RecipientStatus
interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
}

class BlockManagerService {
  private logParser: LogParser;
  private blockService: typeof BlockService;
  private mailerService: typeof MailerService;

  constructor(logParser: LogParser, mailerService: typeof MailerService) {
    this.logParser = logParser;
    this.blockService = BlockService;
    this.mailerService = mailerService;

    this.logParser.on('log', this.handleLogEntry.bind(this));
    this.logParser.startMonitoring();
  }

  private handleLogEntry(logEntry: any) {
    if (this.mailerService.getStatus() !== 'health') {
      logger.info(`Ignorando logEntry porque o Mailer está bloqueado. Status atual: ${this.mailerService.getStatus()}`);
      return;
    }

    const { message } = logEntry;

    if (typeof message !== 'string') {
      logger.warn('Log entry missing or invalid message:', logEntry);
      return;
    }

    if (this.blockService.isPermanentError(message)) {
      this.applyBlock('permanent', message);
      logger.info(`Bloqueio permanente aplicado devido à linha de log: "${message}"`);
    } else if (this.blockService.isTemporaryError(message)) {
      this.applyBlock('temporary', message);
      logger.info(`Bloqueio temporário aplicado devido à linha de log: "${message}"`);
    }
  }

  private applyBlock(type: 'permanent' | 'temporary', reason: string) {
    if (type === 'permanent') {
      this.mailerService.blockMailer('blocked_permanently', reason);
    } else {
      this.mailerService.blockMailer('blocked_temporary', reason);

      setTimeout(() => {
        this.checkAndUnblock();
      }, config.mailer.temporaryBlockDuration);
    }
  }

  private async checkAndUnblock() {
    try {
      const testResult = await this.mailerService.sendInitialTestEmail();
  
      // Verifica se todos os destinatários receberam o email com sucesso
      if (testResult.recipients.every((r: RecipientStatus) => r.success)) {
        this.mailerService.unblockMailer();
        logger.info('Bloqueio temporário removido após sucesso no email de teste.');
      } else {
        logger.warn('Falha no email de teste. Bloqueio temporário permanece.');
      }
    } catch (error) {
      logger.error('Erro ao realizar o email de teste para desbloqueio:', error);
    }
  }
}

export default BlockManagerService;