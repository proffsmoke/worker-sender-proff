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
      logger.warn('Invalid log entry:', JSON.stringify(logEntry));
      return false;
    }
    return true;
  }

  private isPermanentError(message: string): boolean {
    return this.blockedErrors.permanent.some(err => {
      const pattern = new RegExp(`\\b${err}\\b`, 'i');
      return pattern.test(message);
    });
  }

  private isTemporaryError(message: string): boolean {
    return this.blockedErrors.temporary.some(err => {
      const pattern = new RegExp(`\\b${err}\\b`, 'i');
      return pattern.test(message);
    });
  }

  private applyBlock(type: 'permanent' | 'temporary', reason: string): void {
    const currentStatus = this.mailerService.getStatus();

    if (type === 'permanent') {
      logger.warn(`🔥 PERMANENT BLOCK DETECTED: ${reason}`);
      this.mailerService.blockMailer('blocked_permanently', reason);
      return;
    }

    if (currentStatus === 'health') {
      logger.warn(`⏳ TEMPORARY BLOCK APPLIED: ${reason}`);
      this.mailerService.blockMailer('blocked_temporary', reason);
    }
  }

  private handleError(error: unknown): void {
    const errorMessage = error instanceof Error
      ? error.message
      : 'Unknown error processing log entry';

    logger.error(`BlockManagerService error: ${errorMessage}`);
  }
}

export default BlockManagerService;