"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
const EmailService_1 = __importDefault(require("./EmailService"));
const uuid_1 = require("uuid");
class MailerService {
    constructor() {
        this.isBlocked = false;
        this.isBlockedPermanently = false;
        this.blockReason = null; // Novo campo para armazenar a razão do bloqueio
        this.version = '4.3.26-1';
        this.retryIntervalId = null;
        this.createdAt = new Date();
        this.initialize();
    }
    initialize() {
        // Enviar email de teste ao iniciar
        this.sendInitialTestEmail();
    }
    isMailerBlocked() {
        return this.isBlocked;
    }
    isMailerPermanentlyBlocked() {
        return this.isBlockedPermanently;
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
    getVersion() {
        return this.version;
    }
    // Método para bloquear o Mailer com uma razão
    blockMailer(status, reason) {
        if (!this.isBlocked) {
            this.isBlocked = true;
            this.blockReason = reason; // Armazena a razão do bloqueio
            if (status === 'blocked_permanently') {
                this.isBlockedPermanently = true;
            }
            logger_1.default.warn(`Mailer bloqueado com status: ${status}. Razão: ${reason}`);
            if (status === 'blocked_temporary') {
                this.scheduleRetry(); // Agendar reenvio apenas para bloqueio temporário
            }
            else {
                this.clearRetryInterval(); // Cancelar reenvios se for bloqueio permanente
            }
        }
    }
    // Método para desbloquear o Mailer
    unblockMailer() {
        if (this.isBlocked && !this.isBlockedPermanently) {
            this.isBlocked = false;
            this.blockReason = null; // Limpa a razão do bloqueio
            logger_1.default.info('Mailer desbloqueado.');
            this.clearRetryInterval();
        }
    }
    getBlockReason() {
        return this.blockReason; // Método getter para obter a razão do bloqueio
    }
    // Método para enviar o email de teste inicial
    async sendInitialTestEmail() {
        const testUuid = (0, uuid_1.v4)();
        const testEmailParams = {
            fromName: 'Mailer Test',
            emailDomain: config_1.default.mailer.noreplyEmail.split('@')[1] || 'unknown.com',
            to: config_1.default.mailer.noreplyEmail,
            bcc: [],
            subject: 'Email de Teste Inicial',
            html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
            uuid: testUuid,
        };
        try {
            const result = await EmailService_1.default.sendEmail(testEmailParams);
            logger_1.default.info(`Email de teste enviado com mailId=${result.mailId}`, { result });
            // Verificar se todos os destinatários receberam o email com sucesso
            const allSuccess = result.recipients.every((r) => r.success);
            if (allSuccess) {
                logger_1.default.info('Email de teste enviado com sucesso. Status do Mailer: health');
                this.unblockMailer(); // Garantir que o Mailer esteja desbloqueado
                return { success: true };
            }
            else {
                logger_1.default.warn('Falha ao enviar email de teste. Verifique os logs para mais detalhes.');
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
    // Método para agendar tentativas de reenvio a cada 4 minutos
    scheduleRetry() {
        if (this.isBlockedPermanently) {
            logger_1.default.info('Mailer está permanentemente bloqueado. Não tentará reenviar emails.');
            return;
        }
        if (this.retryIntervalId) {
            // Já existe um intervalo de retry agendado
            return;
        }
        logger_1.default.info('Agendando tentativa de reenviar email de teste a cada 4 minutos.');
        this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000); // 4 minutos
    }
    // Método para tentar reenviar o email de teste
    async retrySendEmail() {
        if (!this.isBlocked || this.isBlockedPermanently) {
            // Se não estiver temporariamente bloqueado, não tentar reenviar
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
    // Método para limpar o intervalo de reenvio
    clearRetryInterval() {
        if (this.retryIntervalId) {
            clearInterval(this.retryIntervalId);
            this.retryIntervalId = null;
            logger_1.default.info('Intervalo de tentativa de reenvio cancelado.');
        }
    }
}
exports.default = new MailerService();
