"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const log_parser_1 = __importDefault(require("../log-parser"));
const BlockService_1 = __importDefault(require("./BlockService"));
const MailerService_1 = __importDefault(require("./MailerService"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../utils/logger"));
class BlockManagerService {
    constructor() {
        this.logParser = new log_parser_1.default('/var/log/mail.log');
        this.blockService = BlockService_1.default;
        this.mailerService = MailerService_1.default;
        this.logParser.on('log', this.handleLogEntry.bind(this));
        this.logParser.startMonitoring();
    }
    handleLogEntry(logEntry) {
        const { message } = logEntry;
        if (typeof message !== 'string') {
            logger_1.default.warn('Log entry missing or invalid message:', logEntry);
            return;
        }
        if (this.blockService.isPermanentError(message)) {
            this.applyBlock('permanent', message); // Passa a mensagem como razão
            logger_1.default.info(`Bloqueio permanente aplicado devido à linha de log: "${message}"`);
        }
        else if (this.blockService.isTemporaryError(message)) {
            this.applyBlock('temporary', message); // Passa a mensagem como razão
            logger_1.default.info(`Bloqueio temporário aplicado devido à linha de log: "${message}"`);
        }
    }
    applyBlock(type, reason) {
        if (type === 'permanent') {
            this.mailerService.blockMailer('blocked_permanently', reason);
        }
        else {
            this.mailerService.blockMailer('blocked_temporary', reason);
            // Agendar a remoção do bloqueio temporário após a duração configurada
            setTimeout(() => {
                this.checkAndUnblock();
            }, config_1.default.mailer.temporaryBlockDuration);
        }
    }
    async checkAndUnblock() {
        try {
            const testResult = await this.mailerService.sendInitialTestEmail();
            if (testResult.success) {
                this.mailerService.unblockMailer();
                logger_1.default.info('Bloqueio temporário removido após sucesso no email de teste.');
            }
            else {
                logger_1.default.warn('Falha no email de teste. Bloqueio temporário permanece.');
            }
        }
        catch (error) {
            logger_1.default.error('Erro ao realizar o email de teste para desbloqueio:', error);
        }
    }
}
exports.default = new BlockManagerService();
