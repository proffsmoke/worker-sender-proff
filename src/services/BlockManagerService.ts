// src/services/BlockManagerService.ts

import LogParser from '../log-parser';
import BlockService from './BlockService';
import MailerService from './MailerService';
import config from '../config';
import logger from '../utils/logger';

class BlockManagerService {
  private logParser: LogParser;
  private blockService: typeof BlockService;
  private mailerService: typeof MailerService;

  constructor() {
    this.logParser = new LogParser('/var/log/mail.log');
    this.blockService = BlockService;
    this.mailerService = MailerService;

    this.logParser.on('log', this.handleLogEntry.bind(this));
    this.logParser.startMonitoring();
  }

  private handleLogEntry(logEntry: any) {
    const { message } = logEntry;

    if (this.blockService.isPermanentError(message)) {
      this.applyBlock('permanent');
      logger.info(`Bloqueio permanente aplicado devido à linha de log: "${message}"`);
    } else if (this.blockService.isTemporaryError(message)) {
      this.applyBlock('temporary');
      logger.info(`Bloqueio temporário aplicado devido à linha de log: "${message}"`);
    }
  }

  private applyBlock(type: 'permanent' | 'temporary') {
    if (type === 'permanent') {
      this.mailerService.blockMailer('blocked_permanently');
    } else {
      this.mailerService.blockMailer('blocked_temporary');
      // Agendar a remoção do bloqueio temporário após a duração configurada
      setTimeout(() => {
        this.checkAndUnblock();
      }, config.mailer.temporaryBlockDuration);
    }
  }

  private async checkAndUnblock() {
    try {
      const testResult = await this.mailerService.sendInitialTestEmail();
      if (testResult.success) {
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

export default new BlockManagerService();