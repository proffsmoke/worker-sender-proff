"use strict";
// src/services/EmailService.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const EmailLog_1 = __importDefault(require("../models/EmailLog"));
const logger_1 = __importDefault(require("../utils/logger"));
class EmailService {
    constructor() {
        this.transporter = nodemailer_1.default.createTransport({
            sendmail: true,
            path: '/usr/sbin/sendmail',
            newline: 'unix',
        });
    }
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc, subject, html, uuid } = params;
        const fromEmail = `"${fromName}" <no-reply@${emailDomain}>`;
        try {
            const mailOptions = {
                from: fromEmail,
                to,
                bcc,
                subject,
                html,
                headers: { 'X-Mailer-ID': uuid },
            };
            const info = await this.transporter.sendMail(mailOptions);
            // Extrair o Queue ID do Sendmail
            const sendmailOutput = info.response;
            const queueIdMatch = sendmailOutput.match(/Queued! id=([A-Za-z0-9]+)/);
            const queueId = queueIdMatch ? queueIdMatch[1] : '';
            if (!queueId) {
                throw new Error('Não foi possível capturar o Queue ID.');
            }
            logger_1.default.info(`E-mail enviado. Queue ID: ${queueId}`);
            // Salvar o UUID e Queue ID no MongoDB
            const emailLog = new EmailLog_1.default({
                mailId: uuid,
                email: to,
                message: 'E-mail enfileirado.',
                success: null,
                detail: { queueId },
            });
            await emailLog.save();
            return queueId;
        }
        catch (error) {
            logger_1.default.error('Erro ao enviar o e-mail:', error);
            throw error;
        }
    }
}
exports.default = new EmailService();
