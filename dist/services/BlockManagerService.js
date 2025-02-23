"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
class BlockManagerService {
    constructor(mailerService) {
        this.blockedErrors = {
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
                ,
                'Limit exceeded ip', 'temporarily deferred'
            ]
        };
        this.mailerService = mailerService;
    }
    static getInstance(mailerService) {
        if (!BlockManagerService.instance) {
            BlockManagerService.instance = new BlockManagerService(mailerService);
        }
        return BlockManagerService.instance;
    }
    handleLogEntry(logEntry) {
        try {
            if (!this.shouldProcessEntry(logEntry))
                return;
            const errorMessage = logEntry.result.toLowerCase();
            if (this.isPermanentError(errorMessage)) {
                this.applyBlock('permanent', logEntry.result);
            }
            else if (this.isTemporaryError(errorMessage)) {
                this.applyBlock('temporary', logEntry.result);
            }
        }
        catch (error) {
            this.handleError(error);
        }
    }
    shouldProcessEntry(logEntry) {
        if (!logEntry?.result || !logEntry.queueId) {
            logger_1.default.warn('Invalid log entry:', JSON.stringify(logEntry));
            return false;
        }
        return true;
    }
    isPermanentError(message) {
        return this.blockedErrors.permanent.some(err => {
            const pattern = new RegExp(`\\b${err}\\b`, 'i');
            return pattern.test(message);
        });
    }
    isTemporaryError(message) {
        return this.blockedErrors.temporary.some(err => {
            const pattern = new RegExp(`\\b${err}\\b`, 'i');
            return pattern.test(message);
        });
    }
    applyBlock(type, reason) {
        const currentStatus = this.mailerService.getStatus();
        if (type === 'permanent') {
            logger_1.default.warn(`🔥 PERMANENT BLOCK DETECTED: ${reason}`);
            this.mailerService.blockMailer('blocked_permanently', reason);
            return;
        }
        if (currentStatus === 'health') {
            logger_1.default.warn(`⏳ TEMPORARY BLOCK APPLIED: ${reason}`);
            this.mailerService.blockMailer('blocked_temporary', reason);
        }
    }
    handleError(error) {
        const errorMessage = error instanceof Error
            ? error.message
            : 'Unknown error processing log entry';
        logger_1.default.error(`BlockManagerService error: ${errorMessage}`);
    }
}
exports.default = BlockManagerService;
