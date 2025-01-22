"use strict";
// EmailService.ts
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
        // Listen to log events
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
        const cleanMessageId = logEntry.messageId.replace(/[<>]/g, '');
        const sendData = this.pendingSends.get(cleanMessageId);
        if (!sendData) {
            return;
        }
        const success = logEntry.dsn.startsWith('2');
        const recipient = logEntry.recipient.toLowerCase();
        const isToRecipient = sendData.toRecipients.includes(recipient);
        if (isToRecipient) {
            try {
                const emailLog = await EmailLog_1.default.findOne({ mailId: sendData.uuid }).exec();
                if (emailLog) {
                    emailLog.success = success;
                    await emailLog.save();
                }
            }
            catch (err) {
                logger_1.default.error(`Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${err.message}`);
            }
            sendData.results.push({
                recipient: recipient,
                success: success
            });
        }
        else {
            sendData.results.push({
                recipient: recipient,
                success,
            });
            try {
                const emailLog = await EmailLog_1.default.findOne({ mailId: sendData.uuid }).exec();
                if (emailLog) {
                    const recipientStatus = {
                        recipient: recipient,
                        success,
                        dsn: logEntry.dsn,
                        status: logEntry.status,
                    };
                    emailLog.detail = {
                        ...emailLog.detail,
                        [recipient]: recipientStatus,
                    };
                    await emailLog.save();
                }
            }
            catch (err) {
                logger_1.default.error(`Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${err.message}`);
            }
        }
        const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
        const processedRecipients = sendData.results.length;
        if (processedRecipients >= totalRecipients) {
            sendData.resolve(sendData.results);
            this.pendingSends.delete(cleanMessageId);
        }
    }
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
        const from = `"${fromName}" <no-reply@${emailDomain}>`;
        const toRecipients = Array.isArray(to) ? to.map(r => r.toLowerCase()) : [to.toLowerCase()];
        const bccRecipients = bcc.map(r => r.toLowerCase());
        const allRecipients = [...toRecipients, ...bccRecipients];
        const messageId = `${uuid}@${emailDomain}`;
        const isTestEmail = fromName === 'Mailer Test' && subject === 'Email de Teste Inicial';
        if (isTestEmail) {
            logger_1.default.debug(`Setting Message-ID: <${messageId}> for mailId=${uuid}`);
        }
        try {
            const mailOptions = {
                from,
                to: Array.isArray(to) ? to.join(', ') : to,
                bcc,
                subject,
                html,
                messageId: `<${messageId}>`,
            };
            const info = await this.transporter.sendMail(mailOptions);
            if (isTestEmail) {
                logger_1.default.info(`Email sent: ${JSON.stringify(mailOptions)}`);
                logger_1.default.debug(`SMTP server response: ${info.response}`);
            }
            const sendPromise = new Promise((resolve, reject) => {
                this.pendingSends.set(messageId, {
                    uuid,
                    toRecipients,
                    bccRecipients,
                    results: [],
                    resolve,
                    reject,
                });
                setTimeout(() => {
                    if (this.pendingSends.has(messageId)) {
                        const sendData = this.pendingSends.get(messageId);
                        sendData.reject(new Error('Timeout ao capturar status para todos os destinatários.'));
                        this.pendingSends.delete(messageId);
                        if (isTestEmail) {
                            logger_1.default.warn(`Timeout: Failed to capture status for mailId=${uuid}`);
                        }
                    }
                }, 10000); // 10 segundos
            });
            const results = await sendPromise;
            if (isTestEmail) {
                logger_1.default.info(`Send results for test email: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`);
            }
            else {
                const emailLog = new EmailLog_1.default({
                    mailId: uuid,
                    sendmailQueueId: '',
                    email: Array.isArray(to) ? to.join(', ') : to,
                    message: subject,
                    success: null,
                    sentAt: new Date(),
                });
                await emailLog.save();
                if (results.length > 0) {
                    const emailLogUpdate = await EmailLog_1.default.findOne({ mailId: uuid }).exec();
                    if (emailLogUpdate) {
                        const allBccSuccess = results.every(r => r.success);
                        emailLogUpdate.success = allBccSuccess;
                        await emailLogUpdate.save();
                    }
                }
            }
            return {
                mailId: uuid,
                queueId: '',
                recipients: results,
            };
        }
        catch (error) {
            logger_1.default.error(`Error sending email: ${error.message}`, error);
            let recipientsStatus = [];
            if (error.rejected && Array.isArray(error.rejected)) {
                const rejectedSet = new Set(error.rejected.map((r) => r.toLowerCase()));
                const acceptedSet = new Set((error.accepted || []).map((r) => r.toLowerCase()));
                recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
                    recipient,
                    success: acceptedSet.has(recipient),
                    error: rejectedSet.has(recipient)
                        ? 'Rejeitado pelo servidor SMTP.'
                        : undefined,
                }));
            }
            else {
                recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
                    recipient,
                    success: false,
                    error: 'Falha desconhecida ao enviar email.',
                }));
            }
            return {
                mailId: uuid,
                queueId: '',
                recipients: recipientsStatus,
            };
        }
    }
}
exports.default = new EmailService();
