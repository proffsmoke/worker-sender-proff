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
    /**
     * Construtor privado para suportar o padrão Singleton.
     */
    constructor() {
        this.isBlocked = false;
        this.isBlockedPermanently = false;
        this.blockReason = null;
        this.version = '4.3.26-1'; // Versão atual do serviço
        this.retryIntervalId = null;
        this.isMonitoringStarted = false;
        this.createdAt = new Date();
        this.logParser = new log_parser_1.default('/var/log/mail.log'); // Instancia o LogParser
        this.emailService = EmailService_1.default.getInstance(this.logParser); // Obtém a instância do EmailService, passando o LogParser
        this.blockManagerService = BlockManagerService_1.default.getInstance(this); // Instancia o BlockManagerService
        // Inicia o monitoramento do log, se ainda não tiver sido iniciado
        if (!this.isMonitoringStarted) {
            this.logParser.startMonitoring();
            this.isMonitoringStarted = true;
        }
        this.initialize(); // Inicializa o serviço
    }
    /**
     * Retorna a instância única do MailerService (Singleton).
     * @returns A instância do MailerService.
     */
    static getInstance() {
        if (!MailerService.instance) {
            MailerService.instance = new MailerService();
        }
        return MailerService.instance;
    }
    /**
     * Inicializa o serviço, enviando um email de teste inicial.
     */
    initialize() {
        this.sendInitialTestEmail();
    }
    /**
     * Retorna a versão atual do serviço.
     * @returns A versão do serviço.
     */
    getVersion() {
        return this.version;
    }
    /**
     * Retorna a data de criação do serviço.
     * @returns A data de criação.
     */
    getCreatedAt() {
        return this.createdAt;
    }
    /**
     * Retorna o status atual do serviço.
     * @returns O status: 'health', 'blocked_temporary' ou 'blocked_permanently'.
     */
    getStatus() {
        if (this.isBlockedPermanently) {
            return 'blocked_permanently';
        }
        if (this.isBlocked) {
            return 'blocked_temporary';
        }
        return 'health';
    }
    /**
     * Retorna a razão do bloqueio atual, se houver.
     * @returns A razão do bloqueio ou null.
     */
    getBlockReason() {
        return this.blockReason;
    }
    /**
     * Verifica se o serviço está bloqueado temporariamente.
     * @returns True se estiver bloqueado, false caso contrário.
     */
    isMailerBlocked() {
        return this.isBlocked;
    }
    /**
     * Verifica se o serviço está bloqueado permanentemente.
     * @returns True se estiver bloqueado permanentemente, false caso contrário.
     */
    isMailerPermanentlyBlocked() {
        return this.isBlockedPermanently;
    }
    /**
     * Bloqueia o serviço temporariamente ou permanentemente.
     * @param status - 'blocked_temporary' ou 'blocked_permanently'.
     * @param reason - A razão do bloqueio.
     */
    blockMailer(status, reason) {
        if (!this.isBlocked) {
            this.isBlocked = true;
            this.blockReason = reason;
            if (status === 'blocked_permanently') {
                this.isBlockedPermanently = true;
            }
            logger_1.default.warn(`Mailer bloqueado com status: ${status}. Razão: ${reason}`);
            if (status === 'blocked_temporary') {
                this.scheduleRetry(); // Agenda tentativas de reenvio
            }
            else {
                this.clearRetryInterval(); // Cancela tentativas de reenvio
            }
        }
    }
    /**
     * Desbloqueia o serviço, se estiver bloqueado temporariamente.
     */
    unblockMailer() {
        if (this.isBlocked && !this.isBlockedPermanently) {
            this.isBlocked = false;
            this.blockReason = null;
            logger_1.default.info('Mailer desbloqueado.');
            this.clearRetryInterval();
        }
    }
    /**
     * Agenda tentativas de reenvio de email de teste a cada 4 minutos.
     */
    scheduleRetry() {
        if (this.isBlockedPermanently) {
            logger_1.default.info('Mailer está permanentemente bloqueado. Não tentará reenviar emails.');
            return;
        }
        if (this.retryIntervalId) {
            return; // Já existe um intervalo agendado
        }
        logger_1.default.info('Agendando tentativa de reenviar email de teste a cada 4 minutos.');
        this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000); // 4 minutos
    }
    /**
     * Cancela o intervalo de tentativas de reenvio.
     */
    clearRetryInterval() {
        if (this.retryIntervalId) {
            clearInterval(this.retryIntervalId);
            this.retryIntervalId = null;
            logger_1.default.info('Intervalo de tentativa de reenvio cancelado.');
        }
    }
    /**
     * Tenta reenviar o email de teste.
     */
    async retrySendEmail() {
        if (!this.isBlocked || this.isBlockedPermanently) {
            this.clearRetryInterval();
            logger_1.default.info('Mailer não está bloqueado temporariamente. Cancelando tentativas de reenvio.');
            return;
        }
        logger_1.default.info('Tentando reenviar email de teste...');
        const result = await this.sendInitialTestEmail(); // Reenvia o email de teste
        if (result.success) {
            logger_1.default.info('Reenvio de email de teste bem-sucedido. Cancelando futuras tentativas.');
            this.clearRetryInterval();
            this.unblockMailer(); // Desbloqueia o serviço
        }
    }
    /**
     * Envia um email de teste inicial para verificar o funcionamento do serviço.
     * @returns Um objeto indicando o sucesso do envio e os recipients, incluindo o mailId do teste.
     */
    async sendInitialTestEmail() {
        const testEmailParams = {
            fromName: 'Mailer Test',
            emailDomain: config_1.default.mailer.noreplyEmail.split('@')[1] || 'unknown.com', // Domínio do email de teste
            to: config_1.default.mailer.noreplyEmail, // Destinatário do email de teste
            bcc: [],
            subject: 'Email de Teste Inicial',
            html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
            clientName: 'Prasminha camarada', // Nome do cliente (para personalização do assunto)
        };
        try {
            const requestUuid = (0, uuid_1.v4)(); // Gera um UUID único para o teste
            logger_1.default.info(`UUID gerado para o teste: ${requestUuid}`);
            // Envia o email de teste usando o EmailService, passando o UUID
            const result = await this.emailService.sendEmail(testEmailParams, requestUuid);
            logger_1.default.info(`Email de teste enviado com queueId=${result.queueId}`, { result });
            // Incrementar a contagem de emails enviados
            await EmailStats_1.default.incrementSent();
            // Aguarda pelo resultado do teste usando o método waitForTestEmailResult do EmailService
            const testResult = await this.emailService.waitForTestEmailResult(requestUuid);
            if (testResult.success) {
                logger_1.default.info(`Email de teste enviado com sucesso. Status do Mailer: health. mailId: ${testResult.mailId}`);
                this.unblockMailer(); // Desbloqueia o mailer
                return { success: true, recipients: [result.recipient], mailId: testResult.mailId };
            }
            else {
                logger_1.default.warn(`Falha ao enviar email de teste. mailId: ${testResult.mailId}`);
                this.blockMailer('blocked_temporary', 'Falha no envio do email de teste.'); // Bloqueia o mailer temporariamente
                return { success: false, recipients: [result.recipient], mailId: testResult.mailId };
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email de teste: ${error.message}`, error);
            // Incrementar falhas em caso de erro
            await EmailStats_1.default.incrementFail();
            this.blockMailer('blocked_temporary', `Erro ao enviar email de teste: ${error.message}`); // Bloqueia o mailer temporariamente
            return { success: false, recipients: [], mailId: undefined };
        }
    }
}
exports.default = MailerService.getInstance();
