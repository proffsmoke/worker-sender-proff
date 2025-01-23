"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
class BlockManagerService {
    constructor(mailerService) {
        this.mailerService = mailerService;
    }
    // Método estático para obter a instância única do BlockManagerService
    static getInstance(mailerService) {
        if (!BlockManagerService.instance) {
            BlockManagerService.instance = new BlockManagerService(mailerService);
        }
        return BlockManagerService.instance;
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
        // Verifica se o erro é permanente ou temporário e aplica o bloqueio correspondente
        if (this.isPermanentError(message)) {
            this.applyBlock('permanent', message);
            logger_1.default.info(`Bloqueio permanente aplicado devido à linha de log: "${message}"`);
        }
        else if (this.isTemporaryError(message)) {
            this.applyBlock('temporary', message);
            logger_1.default.info(`Bloqueio temporário aplicado devido à linha de log: "${message}"`);
        }
    }
    isPermanentError(message) {
        // Lógica para identificar erros permanentes
        return message.includes('permanent');
    }
    isTemporaryError(message) {
        // Lógica para identificar erros temporários
        return message.includes('temporary');
    }
    applyBlock(type, reason) {
        if (type === 'permanent') {
            this.mailerService.blockMailer('blocked_permanently', reason);
        }
        else {
            this.mailerService.blockMailer('blocked_temporary', reason);
        }
    }
}
exports.default = BlockManagerService;
