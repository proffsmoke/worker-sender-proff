import logger from '../utils/logger';
import MailerService from './MailerService';
import { LogEntry } from '../log-parser';

class BlockManagerService {
  private static instance: BlockManagerService;
  private mailerService: MailerService;
  
  private readonly blockedErrors = {
    permanent: [
      '(S3140)', 'blacklisted', 'blacklistado', 'Spamhaus', 'Barracuda',
      'barracuda', "The IP you're using to send mail is not authorized",
      'Spam message rejected', 'www.spamhaus.org', 'SPFBL permanently blocked',
      'SPFBL BLOCKED', 'banned sending IP', 'on our block list', '550 5.7.1',
      '554 Refused', 'access denied', 'blocked by policy', 'IP blacklisted',
      'too many bad commands', 'rejected due to policy'
    ],
    temporary: [
      'temporary', '(S3114)', '(S844)', 'temporarily rate limited',
      '421 Temporary Failure', '421 4.7.0', 'unfortunately, messages from',
      'can not connect to any SMTP server', 'Too many complaints',
      'Connection timed out', 'Limit exceeded ip', 'temporarily deferred'
    ]
  };

  private constructor(mailerService: MailerService) {
    this.mailerService = mailerService;
  }

  public static getInstance(mailerService: MailerService): BlockManagerService {
    if (!BlockManagerService.instance) {
      BlockManagerService.instance = new BlockManagerService(mailerService);
    }
    return BlockManagerService.instance;
  }

  public handleLogEntry(logEntry: LogEntry): void {
    try {
      if (!this.shouldProcessEntry(logEntry)) return;
      
      const errorMessage = logEntry.result.toLowerCase();
      
      if (this.isPermanentError(errorMessage)) {
        this.applyBlock('permanent', logEntry.result);
      } else if (this.isTemporaryError(errorMessage)) {
        this.applyBlock('temporary', logEntry.result);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  private shouldProcessEntry(logEntry: LogEntry): boolean {
    if (!logEntry?.result || !logEntry.queueId) {
      logger.warn('Log entry inválido:', JSON.stringify(logEntry));
      return false;
    }
    return true; // Processa sempre, independente do status
  }

  private isPermanentError(message: string): boolean {
    return this.blockedErrors.permanent.some(err => 
      message.includes(err.toLowerCase())
    );
  }

  private isTemporaryError(message: string): boolean {
    return this.blockedErrors.temporary.some(err => 
      message.includes(err.toLowerCase())
    );
  }

  private applyBlock(type: 'permanent' | 'temporary', reason: string): void {
    const currentStatus = this.mailerService.getStatus();
    
    // Mantém bloqueio permanente se já existir
    if (currentStatus === 'blocked_permanently') return;

    const newStatus = type === 'permanent' 
      ? 'blocked_permanently' 
      : 'blocked_temporary';

    // Atualiza apenas se for mais crítico ou status health
    if (newStatus === 'blocked_permanently' || currentStatus === 'health') {
      logger.warn(`Aplicando bloqueio ${newStatus}: ${reason}`);
      this.mailerService.blockMailer(newStatus, reason);
    }
  }

  private handleError(error: unknown): void {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Erro desconhecido ao processar log entry';
      
    logger.error(`BlockManagerService error: ${errorMessage}`);
  }
}

export default BlockManagerService;