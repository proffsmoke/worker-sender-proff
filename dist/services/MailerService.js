"use strict";
// src/services/MailerService.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const PortCheckService_1 = __importDefault(require("./PortCheckService"));
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
const EmailService_1 = __importDefault(require("./EmailService")); // Import adicionado
const uuid_1 = require("uuid"); // Import para gerar UUID
class MailerService {
    constructor() {
        this.isBlocked = false;
        this.isBlockedPermanently = false;
        this.version = '4.3.26-1';
        this.intervalId = null;
        this.createdAt = new Date();
        this.initialize();
    }
    async initialize() {
        await this.checkPortAndUpdateStatus();
        if (!this.isBlockedPermanently) {
            this.intervalId = setInterval(() => this.checkPortAndUpdateStatus(), config_1.default.mailer.checkInterval);
        }
        // Enviar email de teste ao iniciar
        this.sendInitialTestEmail();
    }
    async checkPortAndUpdateStatus() {
        if (this.isBlockedPermanently) {
            logger_1.default.info('Mailer está permanentemente bloqueado. Não será verificada novamente a porta.');
            return;
        }
        const openPort = await PortCheckService_1.default.verifyPort('smtp.gmail.com', [25]); // Alterado para smtp.gmail.com e porta 25
        if (!openPort && !this.isBlocked) {
            this.blockMailer('blocked_permanently');
            logger_1.default.warn('Nenhuma porta disponível. Mailer bloqueado permanentemente.');
        }
        else if (openPort) {
            logger_1.default.info(`Porta ${openPort} aberta. Mailer funcionando normalmente.`);
        }
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
    isPort25Open() {
        return !this.isBlocked;
    }
    getVersion() {
        return this.version;
    }
    blockMailer(status) {
        if (!this.isBlocked) {
            this.isBlocked = true;
            if (status === 'blocked_permanently') {
                this.isBlockedPermanently = true;
            }
            logger_1.default.warn(`Mailer bloqueado com status: ${status}`);
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
        }
    }
    unblockMailer() {
        if (this.isBlocked && !this.isBlockedPermanently) {
            this.isBlocked = false;
            logger_1.default.info('Mailer desbloqueado.');
            this.initialize();
        }
    }
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
            // Atualizar o status do Mailer baseado no resultado do email de teste
            const allSuccess = result.recipients.every((r) => r.success);
            if (allSuccess) {
                logger_1.default.info('Email de teste enviado com sucesso. Status do Mailer: health');
                // Garantir que o status não esteja bloqueado
                this.unblockMailer();
            }
            else {
                logger_1.default.warn('Falha ao enviar email de teste. Verifique os logs para mais detalhes.');
                // Opcional: bloquear o Mailer se o email de teste falhar
                this.blockMailer('blocked_temporary');
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email de teste: ${error.message}`, error);
            // Opcional: bloquear o Mailer se ocorrer um erro ao enviar o email de teste
            this.blockMailer('blocked_temporary');
        }
    }
}
exports.default = new MailerService();
