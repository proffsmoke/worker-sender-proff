"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
const EmailService_1 = __importDefault(require("./EmailService"));
const log_parser_1 = __importDefault(require("../log-parser"));
class MailerService {
    constructor() {
        this.isBlocked = false;
        this.isBlockedPermanently = false;
        this.blockReason = null;
        this.version = '4.3.26-1';
        this.retryIntervalId = null;
        this.createdAt = new Date();
        this.logParser = new log_parser_1.default('/var/log/mail.log');
        this.logParser.on('log', this.handleLogEntry.bind(this)); // Agora escutando os logs em tempo real
        this.logParser.startMonitoring(); // Garantindo que a monitorização comece
        this.initialize();
    }
    initialize() {
        this.sendInitialTestEmail();
    }
    // Checa se o Mailer está bloqueado
    isMailerBlocked() {
        return this.isBlocked;
    }
    // Checa se o Mailer está permanentemente bloqueado
    isMailerPermanentlyBlocked() {
        return this.isBlockedPermanently;
    }
    // Retorna a data de criação do serviço
    getCreatedAt() {
        return this.createdAt;
    }
    // Retorna o status do Mailer
    getStatus() {
        if (this.isBlockedPermanently) {
            return 'blocked_permanently';
        }
        if (this.isBlocked) {
            return 'blocked_temporary';
        }
        return 'health';
    }
    // Retorna a versão do serviço
    getVersion() {
        return this.version;
    }
    // Retorna o motivo do bloqueio
    getBlockReason() {
        return this.blockReason;
    }
    // Bloqueia o Mailer
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
    // Desbloqueia o Mailer
    unblockMailer() {
        if (this.isBlocked && !this.isBlockedPermanently) {
            this.isBlocked = false;
            this.blockReason = null;
            logger_1.default.info('Mailer desbloqueado.');
            this.clearRetryInterval();
        }
    }
    // Envia um email de teste inicial
    async sendInitialTestEmail() {
        const testEmailParams = {
            fromName: 'Mailer Test',
            emailDomain: config_1.default.mailer.noreplyEmail.split('@')[1] || 'unknown.com',
            to: config_1.default.mailer.noreplyEmail,
            bcc: [],
            subject: 'Email de Teste Inicial',
            html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
        };
        try {
            const result = await EmailService_1.default.sendEmail(testEmailParams);
            logger_1.default.info(`Email de teste enviado com queueId=${result.queueId}`, { result });
            // Aguarda o resultado do LogParser para verificar o sucesso
            const logEntry = await this.waitForLogEntry(result.queueId);
            logger_1.default.info(`Esperando log para queueId=${result.queueId}. Conteúdo aguardado: ${JSON.stringify(logEntry)}`);
            if (logEntry && logEntry.success) {
                logger_1.default.info(`Email de teste enviado com sucesso. Status do Mailer: health`);
                this.unblockMailer();
                return { success: true };
            }
            else {
                logger_1.default.warn(`Falha ao enviar email de teste. LogEntry: ${JSON.stringify(logEntry)}`);
                this.blockMailer('blocked_temporary', 'Falha no envio do email de teste.');
                return { success: false };
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email de teste: ${error.message}`, error);
            this.blockMailer('blocked_temporary', `Erro ao enviar email de teste: ${error.message}`);
            return { success: false };
        }
    }
    // Processa a entrada de log recebida
    handleLogEntry(logEntry) {
        logger_1.default.info(`Log recebido para queueId=${logEntry.queueId}: ${JSON.stringify(logEntry)}`);
        this.processLogEntry(logEntry);
    }
    // Processa a entrada de log e desbloqueia ou bloqueia o Mailer
    processLogEntry(logEntry) {
        logger_1.default.info(`Processando log para queueId=${logEntry.queueId}: ${logEntry.result}`);
        if (logEntry.success) {
            logger_1.default.info(`Email com queueId=${logEntry.queueId} foi enviado com sucesso.`);
            this.unblockMailer();
        }
        else {
            logger_1.default.warn(`Falha no envio para queueId=${logEntry.queueId}: ${logEntry.result}`);
            this.blockMailer('blocked_temporary', `Falha no envio para queueId=${logEntry.queueId}`);
        }
    }
    // Aguarda a entrada do log para o queueId
    waitForLogEntry(queueId) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                logger_1.default.warn(`Timeout ao aguardar logEntry para queueId=${queueId}. Nenhuma entrada encontrada após 60 segundos.`);
                resolve(null); // Timeout após 60 segundos
            }, 60000); // Alterado para 60 segundos
            // Verificando se já existe o log para o queueId
            const logEntry = this.getLogEntryByQueueId(queueId);
            if (logEntry) {
                clearTimeout(timeout);
                resolve(logEntry);
            }
            else {
                this.logParser.once('log', (logEntry) => {
                    logger_1.default.info(`Esperando log para queueId=${queueId}. Conteúdo que foi processado: ${JSON.stringify(logEntry)}`);
                    if (logEntry.queueId === queueId) {
                        clearTimeout(timeout);
                        resolve(logEntry);
                    }
                    else {
                        logger_1.default.info(`QueueId não corresponde. Log recebido: ${JSON.stringify(logEntry)}`);
                    }
                });
            }
        });
    }
    // Retorna a entrada do log correspondente ao queueId
    getLogEntryByQueueId(queueId) {
        logger_1.default.info(`Verificando log para queueId=${queueId}`);
        return null; // Retorne o log se já foi encontrado
    }
    // Agenda o reenvio do email de teste a cada 4 minutos, se necessário
    scheduleRetry() {
        if (this.isBlockedPermanently) {
            logger_1.default.info('Mailer está permanentemente bloqueado. Não tentará reenviar emails.');
            return;
        }
        if (this.retryIntervalId) {
            return;
        }
        logger_1.default.info('Agendando tentativa de reenviar email de teste a cada 4 minutos.');
        this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000); // 4 minutos
    }
    // Tenta reenviar o email de teste se estiver bloqueado temporariamente
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
    // Limpa o intervalo de reenvio agendado
    clearRetryInterval() {
        if (this.retryIntervalId) {
            clearInterval(this.retryIntervalId);
            this.retryIntervalId = null;
            logger_1.default.info('Intervalo de tentativa de reenvio cancelado.');
        }
    }
}
exports.default = new MailerService();
