import LogParser from '../log-parser';
import BlockService from './BlockService';
import EmailService from './EmailService'; // Import corrigido
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
  private mailerService: typeof EmailService;

  constructor() {
    this.logParser = new LogParser('/var/log/mail.log');
    this.blockService = BlockService;
    this.mailerService = EmailService;

    // Inicia o monitoramento de logs
    this.logParser.on('log', this.handleLogEntry.bind(this));
    this.logParser.startMonitoring();
  }

  /**
   * Manipula uma entrada de log e aplica bloqueios, se necessário.
   * @param logEntry - A entrada de log a ser processada.
   */
  private handleLogEntry(logEntry: any) {
    const { message } = logEntry;

    // Verifica se a mensagem é válida
    if (typeof message !== 'string') {
      logger.warn('Log entry missing or invalid message:', logEntry);
      return;
    }

    // Verifica se o erro é permanente ou temporário e aplica o bloqueio correspondente
    if (this.blockService.isPermanentError(message)) {
      this.applyBlock('permanent', message); // Passa a mensagem como razão
      logger.info(`Bloqueio permanente aplicado devido à linha de log: "${message}"`);
    } else if (this.blockService.isTemporaryError(message)) {
      this.applyBlock('temporary', message); // Passa a mensagem como razão
      logger.info(`Bloqueio temporário aplicado devido à linha de log: "${message}"`);
    }
  }

  /**
   * Aplica um bloqueio ao MailerService.
   * @param type - Tipo de bloqueio ('permanent' ou 'temporary').
   * @param reason - Razão do bloqueio.
   */
  private applyBlock(type: 'permanent' | 'temporary', reason: string) {
    if (type === 'permanent') {
      this.mailerService.blockMailer('blocked_permanently', reason);
    } else {
      this.mailerService.blockMailer('blocked_temporary', reason);

      // Agendar a remoção do bloqueio temporário após a duração configurada
      setTimeout(() => {
        this.checkAndUnblock();
      }, config.mailer.temporaryBlockDuration);
    }
  }

  /**
   * Verifica se o bloqueio temporário pode ser removido enviando um email de teste.
   */
  private async checkAndUnblock() {
    try {
      // Envia um email de teste para verificar se o bloqueio pode ser removido
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

export default new BlockManagerService();