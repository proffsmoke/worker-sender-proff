"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const log_parser_1 = __importDefault(require("../log-parser"));
const BlockService_1 = __importDefault(require("./BlockService"));
const EmailService_1 = __importDefault(require("./EmailService")); // Import corrigido
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../utils/logger"));
class BlockManagerService {
    constructor() {
        this.logParser = new log_parser_1.default('/var/log/mail.log');
        this.blockService = BlockService_1.default;
        this.mailerService = EmailService_1.default;
        // Inicia o monitoramento de logs
        this.logParser.on('log', this.handleLogEntry.bind(this));
        this.logParser.startMonitoring();
    }
    /**
     * Manipula uma entrada de log e aplica bloqueios, se necessário.
     * @param logEntry - A entrada de log a ser processada.
     */
    handleLogEntry(logEntry) {
        const { message } = logEntry;
        // Verifica se a mensagem é válida
        if (typeof message !== 'string') {
            logger_1.default.warn('Log entry missing or invalid message:', logEntry);
            return;
        }
        // Verifica se o erro é permanente ou temporário e aplica o bloqueio correspondente
        if (this.blockService.isPermanentError(message)) {
            this.applyBlock('permanent', message); // Passa a mensagem como razão
            logger_1.default.info(`Bloqueio permanente aplicado devido à linha de log: "${message}"`);
        }
        else if (this.blockService.isTemporaryError(message)) {
            this.applyBlock('temporary', message); // Passa a mensagem como razão
            logger_1.default.info(`Bloqueio temporário aplicado devido à linha de log: "${message}"`);
        }
    }
    /**
     * Aplica um bloqueio ao MailerService.
     * @param type - Tipo de bloqueio ('permanent' ou 'temporary').
     * @param reason - Razão do bloqueio.
     */
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
    /**
     * Verifica se o bloqueio temporário pode ser removido enviando um email de teste.
     */
    async checkAndUnblock() {
        try {
            // Envia um email de teste para verificar se o bloqueio pode ser removido
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
exports.default = new BlockManagerService();
