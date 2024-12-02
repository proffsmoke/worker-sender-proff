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
            args: ['-v'], // Ativa o modo verbose do Sendmail
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
            };
            // Enviar o e-mail e capturar a resposta completa
            const info = await this.transporter.sendMail(mailOptions);
            logger_1.default.info(`Headers enviados: ${JSON.stringify(mailOptions)}`);
            logger_1.default.info(`Saída completa do Sendmail: ${info.response}`);
            // Regex para capturar possíveis Queue IDs ou fallback
            const queueIdMatch = info.response.match(/(?:Message accepted for delivery|Queued mail for delivery).*?([A-Za-z0-9]+)/);
            const queueId = queueIdMatch ? queueIdMatch[1] : null;
            if (!queueId) {
                logger_1.default.warn(`Queue ID não capturado. Salvando saída completa para análise posterior.`);
                // Salvar fallback com rawResponse para análise posterior
                const emailLog = new EmailLog_1.default({
                    mailId: uuid,
                    email: to,
                    message: `Erro ao capturar Queue ID: ${info.response}`,
                    success: null,
                    detail: {
                        rawResponse: info.response,
                        mailOptions,
                    },
                });
                await emailLog.save();
                throw new Error('Não foi possível capturar o Queue ID.');
            }
            logger_1.default.info(`Queue ID capturado: ${queueId}`);
            // Salvar no MongoDB
            const emailLog = new EmailLog_1.default({
                mailId: uuid,
                email: to,
                message: 'E-mail enfileirado.',
                success: null,
                detail: {
                    queueId,
                    rawResponse: info.response,
                },
            });
            await emailLog.save();
            return queueId;
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar e-mail: ${error}`);
            throw error;
        }
    }
}
exports.default = new EmailService();
