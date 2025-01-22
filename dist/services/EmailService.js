"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const EmailLog_1 = __importDefault(require("../models/EmailLog"));
const logger_1 = __importDefault(require("../utils/logger"));
const log_parser_1 = __importDefault(require("../log-parser"));
const uuid_1 = require("uuid");
const config_1 = __importDefault(require("../config"));
class EmailService {
    constructor() {
        this.pendingSends = new Map();
        this.version = '1.0.0'; // Versão do serviço
        this.createdAt = new Date(); // Data de criação do serviço
        this.status = 'health'; // Status do serviço
        this.blockReason = null; // Razão do bloqueio, se houver
        this.transporter = nodemailer_1.default.createTransport({
            host: config_1.default.smtp.host,
            port: config_1.default.smtp.port,
            secure: false,
            tls: { rejectUnauthorized: false },
        });
        this.logParser = new log_parser_1.default('/var/log/mail.log');
        this.logParser.startMonitoring();
        // Escuta eventos de log
        this.logParser.on('log', this.handleLogEntry.bind(this));
    }
    // Métodos adicionais para suportar as chamadas em outros arquivos
    getVersion() {
        return this.version;
    }
    getCreatedAt() {
        return this.createdAt;
    }
    getStatus() {
        return this.status;
    }
    getBlockReason() {
        return this.blockReason;
    }
    blockMailer(blockType, reason) {
        this.status = blockType;
        this.blockReason = reason;
        logger_1.default.warn(`Mailer bloqueado com status: ${blockType}. Razão: ${reason}`);
    }
    unblockMailer() {
        this.status = 'health';
        this.blockReason = null;
        logger_1.default.info('Mailer desbloqueado.');
    }
    async sendInitialTestEmail() {
        const testEmailParams = {
            fromName: 'Mailer Test',
            emailDomain: 'outlook.com',
            to: 'no-reply@outlook.com',
            subject: 'Email de Teste Inicial',
            html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
            uuid: (0, uuid_1.v4)(),
        };
        return this.sendEmail(testEmailParams);
    }
    async handleLogEntry(logEntry) {
        const sendData = this.pendingSends.get(logEntry.queueId); // Agora usa queueId para associar
        if (!sendData) {
            return;
        }
        const success = logEntry.success;
        const recipient = logEntry.email.toLowerCase();
        // Atualiza o status do destinatário
        const recipientIndex = sendData.results.findIndex((r) => r.recipient === recipient);
        if (recipientIndex !== -1) {
            sendData.results[recipientIndex].success = success;
            if (!success) {
                sendData.results[recipientIndex].error = `Status: ${logEntry.result}`;
            }
        }
        // Atualiza o EmailLog
        try {
            const emailLog = await EmailLog_1.default.findOne({ mailId: sendData.uuid }).exec(); // Usa uuid aqui
            if (emailLog) {
                emailLog.success = sendData.results.every((r) => r.success);
                await emailLog.save();
            }
        }
        catch (err) {
            logger_1.default.error(`Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${err.message}`);
        }
        // Remove do pendingSends se todos os destinatários tiverem um resultado
        const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
        const processedRecipients = sendData.results.length;
        if (processedRecipients >= totalRecipients) {
            this.pendingSends.delete(logEntry.queueId); // Remove usando o queueId
        }
    }
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
        const from = `"${fromName}" <no-reply@${emailDomain}>`;
        const toRecipients = Array.isArray(to) ? to.map((r) => r.toLowerCase()) : [to.toLowerCase()];
        const bccRecipients = bcc.map((r) => r.toLowerCase());
        const allRecipients = [...toRecipients, ...bccRecipients];
        const messageId = `${uuid}@${emailDomain}`; // Usa o uuid para definir o messageId
        const isTestEmail = fromName === 'Mailer Test' && subject === 'Email de Teste Inicial';
        try {
            const mailOptions = {
                from,
                to: Array.isArray(to) ? to.join(', ') : to,
                bcc,
                subject,
                html,
                messageId: `<${messageId}>`,
            };
            // Envia o email
            const info = await this.transporter.sendMail(mailOptions);
            // Registra o envio no pendingSends para atualização posterior
            const recipientsStatus = allRecipients.map((recipient) => ({
                recipient,
                success: true, // Assume sucesso inicialmente
            }));
            // Armazena o uuid juntamente com o queueId para associar mais tarde
            this.pendingSends.set(info.messageId || messageId, {
                uuid,
                toRecipients,
                bccRecipients,
                results: recipientsStatus,
            });
            return {
                mailId: uuid,
                queueId: info.messageId || '',
                recipients: recipientsStatus,
            };
        }
        catch (error) {
            logger_1.default.error(`Error sending email: ${error.message}`, error);
            const recipientsStatus = allRecipients.map((recipient) => ({
                recipient,
                success: false,
                error: error.message,
            }));
            return {
                mailId: uuid,
                queueId: '',
                recipients: recipientsStatus,
            };
        }
    }
    async awaitEmailResults(queueId) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout exceeded for queueId ${queueId}`));
            }, 30000); // Timeout de 30 segundos
            this.logParser.once('log', (logEntry) => {
                if (logEntry.queueId === queueId) {
                    clearTimeout(timeout);
                    resolve();
                }
            });
        });
    }
}
exports.default = new EmailService();
