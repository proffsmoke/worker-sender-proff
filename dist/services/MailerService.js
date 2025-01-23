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
class MailerService {
    constructor() {
        this.isBlocked = false;
        this.isBlockedPermanently = false;
        this.blockReason = null;
        this.version = '4.3.26-1';
        this.retryIntervalId = null;
        this.isMonitoringStarted = false; // Flag para controlar a inicialização
        this.createdAt = new Date();
        this.logParser = new log_parser_1.default('/var/log/mail.log');
        this.emailService = EmailService_1.default.getInstance(this.logParser);
        this.blockManagerService = BlockManagerService_1.default.getInstance(this);
        // Inicia o monitoramento de logs apenas uma vez
        if (!this.isMonitoringStarted) {
            this.logParser.on('log', this.handleLogEntry.bind(this));
            this.logParser.startMonitoring();
            this.isMonitoringStarted = true; // Marca como inicializado
        }
        this.initialize();
    }
    // Método estático para obter a instância única do MailerService
    static getInstance() {
        if (!MailerService.instance) {
            MailerService.instance = new MailerService();
        }
        return MailerService.instance;
    }
    initialize() {
        this.sendInitialTestEmail();
    }
    // Métodos públicos para checar o status e outros
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
    // Método público para enviar email de teste
    async sendInitialTestEmail() {
        const testEmailParams = {
            fromName: 'Mailer Test',
            emailDomain: config_1.default.mailer.noreplyEmail.split('@')[1] || 'unknown.com',
            to: config_1.default.mailer.noreplyEmail,
            bcc: [],
            subject: 'Email de Teste Inicial',
            html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
            clientName: 'Prasminha camarada'
        };
        try {
            const result = await this.emailService.sendEmail(testEmailParams);
            logger_1.default.info(`Email de teste enviado com queueId=${result.queueId}`, { result });
            const logEntry = await this.waitForLogEntry(result.queueId);
            logger_1.default.info(`Esperando log para queueId=${result.queueId}. Conteúdo aguardado: ${JSON.stringify(logEntry)}`);
            if (logEntry && logEntry.success) {
                logger_1.default.info(`Email de teste enviado com sucesso. Status do Mailer: health`);
                this.unblockMailer();
                return { success: true, recipients: result.recipients };
            }
            else {
                logger_1.default.warn(`Falha ao enviar email de teste. LogEntry: ${JSON.stringify(logEntry)}`);
                this.blockMailer('blocked_temporary', 'Falha no envio do email de teste.');
                return { success: false, recipients: result.recipients };
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email de teste: ${error.message}`, error);
            this.blockMailer('blocked_temporary', `Erro ao enviar email de teste: ${error.message}`);
            return { success: false, recipients: [] };
        }
    }
    handleLogEntry(logEntry) {
        logger_1.default.info(`Log recebido para queueId=${logEntry.queueId}: ${JSON.stringify(logEntry)}`);
        this.processLogEntry(logEntry);
    }
    processLogEntry(logEntry) {
        if (this.getStatus() !== 'health') {
            logger_1.default.info(`Ignorando logEntry porque o Mailer está bloqueado. Status atual: ${this.getStatus()}`);
            return;
        }
        logger_1.default.info(`Processando log para queueId=${logEntry.queueId}: ${logEntry.result}`);
        if (logEntry.success) {
            logger_1.default.info(`Email com queueId=${logEntry.queueId} foi enviado com sucesso.`);
            // this.unblockMailer();
        }
        else {
            logger_1.default.warn(`Falha no envio para queueId=${logEntry.queueId}: ${logEntry.result}`);
            // this.blockMailer('blocked_temporary', `Falha no envio para queueId=${logEntry.queueId}`);
        }
        // Notifica o BlockManagerService sobre o log
        this.blockManagerService.handleLogEntry(logEntry);
    }
    async waitForLogEntry(queueId) {
        return new Promise((resolve, reject) => {
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
            const logEntry = this.getLogEntryByQueueId(queueId);
            if (logEntry) {
                clearTimeout(timeout);
                resolve(logEntry);
            }
        });
    }
    getLogEntryByQueueId(queueId) {
        logger_1.default.info(`Verificando log para queueId=${queueId}`);
        const recentLogs = this.logParser.getRecentLogs();
        return recentLogs.find(log => log.queueId === queueId) || null;
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
    async retrySendEmail() {
        if (!this.isBlocked || this.isBlockedPermanently) {
            this.clearRetryInterval();
            logger_1.default.info('Mailer não está temporariamente bloqueado ou está permanentemente bloqueado. Cancelando tentativas de reenvio.');
            return;
        }
        logger_1.default.info('Tentando reenviar email de teste...');
        const result = await this.sendInitialTestEmail();
        if (result.success) {
            logger_1.default.info('Reenvio de email de teste bem-sucedido. Cancelando futuras tentativas.');
            this.clearRetryInterval();
        }
    }
    clearRetryInterval() {
        if (this.retryIntervalId) {
            clearInterval(this.retryIntervalId);
            this.retryIntervalId = null;
            logger_1.default.info('Intervalo de tentativa de reenvio cancelado.');
        }
    }
    getEmailService() {
        return this.emailService;
    }
}
exports.default = MailerService.getInstance();
