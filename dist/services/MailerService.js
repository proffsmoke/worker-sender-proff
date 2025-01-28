"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
const EmailService_1 = __importDefault(require("./EmailService"));
const log_parser_1 = __importDefault(require("../log-parser"));
const BlockManagerService_1 = __importDefault(require("./BlockManagerService"));
const EmailStats_1 = __importDefault(require("../models/EmailStats")); // Importado para atualizar estatísticas
const uuid_1 = require("uuid");
class MailerService {
    constructor() {
        this.isBlocked = false;
        this.isBlockedPermanently = false;
        this.blockReason = null;
        this.version = '4.3.26-1';
        this.retryIntervalId = null;
        this.isMonitoringStarted = false;
        this.createdAt = new Date();
        this.logParser = new log_parser_1.default('/var/log/mail.log');
        this.emailService = EmailService_1.default.getInstance(this.logParser);
        this.blockManagerService = BlockManagerService_1.default.getInstance(this);
        if (!this.isMonitoringStarted) {
            this.logParser.startMonitoring();
            this.isMonitoringStarted = true;
        }
        this.initialize();
    }
    static getInstance() {
        if (!MailerService.instance) {
            MailerService.instance = new MailerService();
        }
        return MailerService.instance;
    }
    initialize() {
        this.sendInitialTestEmail();
    }
    getVersion() {
        return this.version;
    }
    getCreatedAt() {
        return this.createdAt;
    }
    getStatus() {
        if (this.isBlockedPermanently) {
            return 'blocked_permanently';
        }
        if (this.isBlocked) {
            return 'blocked_temporary';
        }
        return 'health';
    }
    getBlockReason() {
        return this.blockReason;
    }
    isMailerBlocked() {
        return this.isBlocked;
    }
    isMailerPermanentlyBlocked() {
        return this.isBlockedPermanently;
    }
    blockMailer(status, reason) {
        if (!this.isBlocked) {
            this.isBlocked = true;
            this.blockReason = reason;
            if (status === 'blocked_permanently') {
                this.isBlockedPermanently = true;
            }
            logger_1.default.warn(`Mailer bloqueado com status: ${status}. Razão: ${reason}`);
            if (status === 'blocked_temporary') {
                this.scheduleRetry();
            }
            else {
                this.clearRetryInterval();
            }
        }
    }
    unblockMailer() {
        if (this.isBlocked && !this.isBlockedPermanently) {
            this.isBlocked = false;
            this.blockReason = null;
            logger_1.default.info('Mailer desbloqueado.');
            this.clearRetryInterval();
        }
    }
    scheduleRetry() {
        if (this.isBlockedPermanently) {
            logger_1.default.info('Mailer está permanentemente bloqueado. Não tentará reenviar emails.');
            return;
        }
        if (this.retryIntervalId) {
            return;
        }
        logger_1.default.info('Agendando tentativa de reenviar email de teste a cada 4 minutos.');
        this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000);
    }
    clearRetryInterval() {
        if (this.retryIntervalId) {
            clearInterval(this.retryIntervalId);
            this.retryIntervalId = null;
            logger_1.default.info('Intervalo de tentativa de reenvio cancelado.');
        }
    }
    async retrySendEmail() {
        if (!this.isBlocked || this.isBlockedPermanently) {
            this.clearRetryInterval();
            logger_1.default.info('Mailer não está bloqueado temporariamente. Cancelando tentativas de reenvio.');
            return;
        }
        logger_1.default.info('Tentando reenviar email de teste...');
        const result = await this.sendInitialTestEmail();
        if (result.success) {
            logger_1.default.info('Reenvio de email de teste bem-sucedido. Cancelando futuras tentativas.');
            this.clearRetryInterval();
        }
    }
    async sendInitialTestEmail() {
        const testEmailParams = {
            fromName: 'Mailer Test',
            emailDomain: config_1.default.mailer.noreplyEmail.split('@')[1] || 'unknown.com',
            to: config_1.default.mailer.noreplyEmail,
            bcc: [],
            subject: 'Email de Teste Inicial',
            html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
            clientName: 'Prasminha camarada',
        };
        try {
            const requestUuid = (0, uuid_1.v4)();
            logger_1.default.info(`UUID gerado para o teste: ${requestUuid}`);
            const result = await this.emailService.sendEmail(testEmailParams, requestUuid);
            logger_1.default.info(`Email de teste enviado com queueId=${result.queueId}`, { result });
            // Incrementar a contagem de emails enviados
            await EmailStats_1.default.incrementSent();
            const logEntry = await this.waitForLogEntry(result.queueId);
            logger_1.default.info(`Esperando log para queueId=${result.queueId}. Conteúdo aguardado: ${JSON.stringify(logEntry)}`);
            if (logEntry && logEntry.success) {
                logger_1.default.info(`Email de teste enviado com sucesso. Status do Mailer: health`);
                this.unblockMailer();
                return { success: true, recipients: [result.recipient] };
            }
            else {
                logger_1.default.warn(`Falha ao enviar email de teste. LogEntry: ${JSON.stringify(logEntry)}`);
                this.blockMailer('blocked_temporary', 'Falha no envio do email de teste.');
                return { success: false, recipients: [result.recipient] };
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email de teste: ${error.message}`, error);
            // Incrementar falhas em caso de erro
            await EmailStats_1.default.incrementFail();
            this.blockMailer('blocked_temporary', `Erro ao enviar email de teste: ${error.message}`);
            return { success: false, recipients: [] };
        }
    }
    async waitForLogEntry(queueId) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                logger_1.default.warn(`Timeout ao aguardar logEntry para queueId=${queueId}. Nenhuma entrada encontrada após 60 segundos.`);
                resolve(null);
            }, 60000);
            this.logParser.once('log', (logEntry) => {
                if (logEntry.queueId === queueId) {
                    clearTimeout(timeout);
                    resolve(logEntry);
                }
            });
        });
    }
}
exports.default = MailerService.getInstance();
