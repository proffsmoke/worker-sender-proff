"use strict";
// src/services/EmailService.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const EmailLog_1 = __importDefault(require("../models/EmailLog"));
const logger_1 = __importDefault(require("../utils/logger"));
const log_parser_1 = __importDefault(require("../log-parser"));
class EmailService {
    constructor() {
        this.pendingSends = new Map();
        this.transporter = nodemailer_1.default.createTransport({
            host: '127.0.0.1',
            port: 25,
            secure: false,
            tls: { rejectUnauthorized: false },
        });
        this.logParser = new log_parser_1.default('/var/log/mail.log');
        this.logParser.startMonitoring();
        // Listen to log events
        this.logParser.on('log', this.handleLogEntry.bind(this));
    }
    async handleLogEntry(logEntry) {
        const sendData = this.pendingSends.get(logEntry.messageId);
        if (!sendData) {
            // Não há envio pendente para este messageId
            return;
        }
        const success = logEntry.dsn.startsWith('2');
        sendData.results.push({
            recipient: logEntry.recipient,
            success,
        });
        logger_1.default.info(`Updated status for ${logEntry.recipient}: ${success ? 'Sent' : 'Failed'}`);
        try {
            const emailLog = await EmailLog_1.default.findOne({ mailId: sendData.uuid }).exec();
            if (emailLog) {
                // Atualizar o status com base no destinatário
                const recipientStatus = {
                    recipient: logEntry.recipient,
                    success,
                    dsn: logEntry.dsn,
                    status: logEntry.status,
                };
                emailLog.success = emailLog.success === null ? success : emailLog.success && success;
                emailLog.detail = {
                    ...emailLog.detail,
                    [logEntry.recipient]: recipientStatus,
                };
                await emailLog.save();
                logger_1.default.debug(`EmailLog atualizado para mailId=${sendData.uuid}`);
            }
            else {
                logger_1.default.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
            }
        }
        catch (err) {
            logger_1.default.error(`Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${err.message}`);
        }
        if (sendData.results.length === sendData.recipients.length) {
            sendData.resolve(sendData.results);
            this.pendingSends.delete(logEntry.messageId);
        }
    }
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
        const from = `"${fromName}" <no-reply@${emailDomain}>`;
        const recipients = Array.isArray(to) ? [...to, ...bcc] : [to, ...bcc];
        const messageId = `${uuid}@${emailDomain}`;
        try {
            const mailOptions = {
                from,
                to: Array.isArray(to) ? to.join(', ') : to,
                bcc,
                subject,
                html,
                headers: {
                    'Message-ID': `<${messageId}>`,
                },
            };
            const info = await this.transporter.sendMail(mailOptions);
            logger_1.default.info(`Email sent: ${JSON.stringify(mailOptions)}`);
            logger_1.default.debug(`SMTP server response: ${info.response}`);
            // Criar um registro inicial no EmailLog com sucesso = null
            const emailLog = new EmailLog_1.default({
                mailId: uuid,
                sendmailQueueId: '', // Pode ser ajustado se necessário
                email: Array.isArray(to) ? to.join(', ') : to,
                message: subject,
                success: null,
                sentAt: new Date(),
            });
            await emailLog.save();
            logger_1.default.debug(`EmailLog criado para mailId=${uuid}`);
            const sendPromise = new Promise((resolve, reject) => {
                this.pendingSends.set(messageId, {
                    uuid,
                    recipients,
                    results: [],
                    resolve,
                    reject,
                });
                setTimeout(() => {
                    if (this.pendingSends.has(messageId)) {
                        const sendData = this.pendingSends.get(messageId);
                        sendData.reject(new Error('Timeout ao capturar status para todos os destinatários.'));
                        this.pendingSends.delete(messageId);
                    }
                }, 60000); // 60 segundos
            });
            const results = await sendPromise;
            const allSuccess = results.every((r) => r.success);
            logger_1.default.info(`Send results: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`);
            return {
                mailId: uuid,
                queueId: '', // Ajustar conforme necessário
                recipients: results,
            };
        }
        catch (error) {
            logger_1.default.error(`Error sending email: ${error.message}`, error);
            let recipientsStatus = [];
            // Verifica se o erro contém informações sobre destinatários rejeitados
            if (error.rejected && Array.isArray(error.rejected)) {
                const rejectedSet = new Set(error.rejected);
                const acceptedSet = new Set(error.accepted || []);
                recipientsStatus = recipients.map((recipient) => ({
                    recipient,
                    success: acceptedSet.has(recipient),
                    error: rejectedSet.has(recipient)
                        ? 'Rejeitado pelo servidor SMTP.'
                        : undefined,
                }));
            }
            else {
                // Se não houver informações específicas, marca todos como falhados
                recipientsStatus = recipients.map((recipient) => ({
                    recipient,
                    success: false,
                    error: 'Falha desconhecida ao enviar email.',
                }));
            }
            // Registrar o erro no EmailLog
            try {
                const emailLog = new EmailLog_1.default({
                    mailId: uuid,
                    sendmailQueueId: '', // Pode ser ajustado se necessário
                    email: Array.isArray(to) ? to.join(', ') : to,
                    message: subject,
                    success: recipientsStatus.some((r) => r.success),
                    detail: recipientsStatus.reduce((acc, curr) => {
                        acc[curr.recipient] = { success: curr.success, error: curr.error };
                        return acc;
                    }, {}),
                    sentAt: new Date(),
                });
                await emailLog.save();
                logger_1.default.debug(`EmailLog criado com erro para mailId=${uuid}`);
            }
            catch (saveErr) {
                logger_1.default.error(`Erro ao registrar EmailLog para mailId=${uuid}: ${saveErr.message}`);
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
