"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const BlockService_1 = __importDefault(require("./BlockService"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../utils/logger"));
class BlockManagerService {
    constructor(logParser, mailerService) {
        this.logParser = logParser;
        this.blockService = BlockService_1.default;
        this.mailerService = mailerService;
        this.logParser.on('log', this.handleLogEntry.bind(this));
        this.logParser.startMonitoring();
    }
    handleLogEntry(logEntry) {
        if (this.mailerService.getStatus() !== 'health') {
            logger_1.default.info(`Ignorando logEntry porque o Mailer está bloqueado. Status atual: ${this.mailerService.getStatus()}`);
            return;
        }
        const { message } = logEntry;
        if (typeof message !== 'string') {
            logger_1.default.warn('Log entry missing or invalid message:', logEntry);
            return;
        }
        if (this.blockService.isPermanentError(message)) {
            this.applyBlock('permanent', message);
            logger_1.default.info(`Bloqueio permanente aplicado devido à linha de log: "${message}"`);
        }
        else if (this.blockService.isTemporaryError(message)) {
            this.applyBlock('temporary', message);
            logger_1.default.info(`Bloqueio temporário aplicado devido à linha de log: "${message}"`);
        }
    }
    applyBlock(type, reason) {
        if (type === 'permanent') {
            this.mailerService.blockMailer('blocked_permanently', reason);
        }
        else {
            this.mailerService.blockMailer('blocked_temporary', reason);
            setTimeout(() => {
                this.checkAndUnblock();
            }, config_1.default.mailer.temporaryBlockDuration);
        }
    }
    async checkAndUnblock() {
        try {
            const testResult = await this.mailerService.sendInitialTestEmail();
            // Verifica se todos os destinatários receberam o email com sucesso
            if (testResult.recipients.every((r) => r.success)) {
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
exports.default = BlockManagerService;
