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
const StateManager_1 = __importDefault(require("./StateManager"));
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
        this.stateManager = new StateManager_1.default();
        if (!this.isMonitoringStarted) {
            this.logParser.on('log', this.handleLogEntry.bind(this));
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
                this.scheduleRetry(); // Agendar tentativa de reenvio
            }
            else {
                this.clearRetryInterval(); // Cancelar qualquer tentativa de reenvio agendada
            }
        }
    }
    unblockMailer() {
        if (this.isBlocked && !this.isBlockedPermanently) {
            this.isBlocked = false;
            this.blockReason = null;
            logger_1.default.info('Mailer desbloqueado.');
            this.clearRetryInterval(); // Cancelar intervalo de tentativa de reenvio
        }
    }
    scheduleRetry() {
        if (this.isBlockedPermanently) {
            logger_1.default.info('Mailer está permanentemente bloqueado. Não tentará reenviar emails.');
            return;
        }
        if (this.retryIntervalId) {
            return; // Se já existe uma tentativa agendada, não faz nada
        }
        logger_1.default.info('Agendando tentativa de reenviar email de teste a cada 4 minutos.');
        this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000); // Reenvio a cada 4 minutos
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
            const requestUuid = (0, uuid_1.v4)(); // Gerando um UUID único
            logger_1.default.info(`UUID gerado para o teste: ${requestUuid}`);
            // Passa o UUID para o sendEmail
            const result = await this.emailService.sendEmail(testEmailParams, requestUuid);
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
    async processLogEntry(logEntry) {
        if (this.getStatus() !== 'health') {
            logger_1.default.info(`Ignorando logEntry porque o Mailer está bloqueado. Status atual: ${this.getStatus()}`);
            return;
        }
        logger_1.default.info(`Processando log para queueId=${logEntry.queueId}: ${logEntry.result}`);
        // Obtém o UUID associado ao queueId
        const mailId = this.stateManager.getUuidByQueueId(logEntry.queueId);
        if (!mailId) {
            logger_1.default.warn(`Nenhum UUID encontrado para queueId=${logEntry.queueId}`);
            return;
        }
        // Atualiza o status do queueId com base no log
        await this.stateManager.updateQueueIdStatus(logEntry.queueId, logEntry.success, mailId);
        // Verifica se todos os destinatários de um e-mail ou lista de e-mails foram processados
        const sendData = this.stateManager.getPendingSend(logEntry.queueId);
        if (sendData) {
            const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
            const processedRecipients = sendData.results.filter((r) => r.success !== undefined).length;
            if (processedRecipients === totalRecipients) {
                // Exibir os dados consolidados antes de removê-los de pendingSends
                logger_1.default.info(`Dados consolidados para queueId=${logEntry.queueId}:`, sendData.results);
                // Consumir o array de resultados antes de removê-lo de pendingSends
                const resultsToConsolidate = [...sendData.results];
                this.stateManager.deletePendingSend(logEntry.queueId); // Remover o queueId da lista de pendentes
                // Gerar a mensagem consolidada de forma assíncrona, esperando todos os logs
                await this.sendConsolidatedResults(resultsToConsolidate, logEntry.queueId);
            }
        }
    }
    async sendConsolidatedResults(results, queueId) {
        logger_1.default.info(`Aguardando todos os logs para a consolidação de resultados para queueId=${queueId}`);
        // Consolidar os resultados
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;
        // Exibe no log os resultados consolidados
        logger_1.default.info(`Todos os recipients processados para queueId=${queueId}. Resultados consolidados:`);
        logger_1.default.info(`Resumo para queueId=${queueId}:`);
        logger_1.default.info(`Emails enviados com sucesso: ${successCount}`);
        logger_1.default.info(`Emails com falha: ${failureCount}`);
        // Se houver falhas, logar os detalhes
        if (failureCount > 0) {
            logger_1.default.error(`Falha no envio de ${failureCount} emails para queueId=${queueId}. Detalhes:`, results.filter(r => !r.success));
        }
        // Aqui você pode enviar os resultados consolidados para uma API, email ou qualquer outro serviço
        // Exemplo:
        // await this.sendResultsToApi(queueId, results);
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
            // Verificar se o log já existe para o queueId
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
}
exports.default = MailerService.getInstance();
