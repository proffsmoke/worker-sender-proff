"use strict";
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
        this.transporter = nodemailer_1.default.createTransport({
            host: '127.0.0.1',
            port: 25,
            secure: false,
            tls: { rejectUnauthorized: false },
        });
        this.logParser = new log_parser_1.default('/var/log/mail.log');
    }
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc, subject, html, uuid } = params;
        const from = `"${fromName}" <no-reply@${emailDomain}>`;
        try {
            this.logParser.startMonitoring(); // Start monitoring logs before sending
            const mailOptions = { from, to, bcc, subject, html };
            const info = await this.transporter.sendMail(mailOptions);
            logger_1.default.info(`Email enviado: ${JSON.stringify(mailOptions)}`);
            logger_1.default.debug(`Resposta do servidor SMTP: ${info.response}`);
            // Extract Queue ID from SMTP response
            const queueIdMatch = info.response.match(/queued as (\S+)/i);
            const queueId = queueIdMatch ? queueIdMatch[1] : null;
            if (!queueId) {
                throw new Error('Queue ID não encontrado na resposta SMTP.');
            }
            logger_1.default.info(`Queue ID capturado diretamente: ${queueId}`);
            // Relate Queue ID with UUID
            const emailLog = new EmailLog_1.default({
                mailId: uuid,
                sendmailQueueId: queueId,
                email: to,
                message: 'E-mail enfileirado.',
                success: true,
                detail: {
                    queueId,
                    rawResponse: info.response,
                    mailOptions,
                },
            });
            await emailLog.save();
            return queueId;
        }
        catch (error) {
            // logger.error(`Erro ao enviar e-mail: ${error.message}`, { stack: error.stack });
            throw error;
        }
        finally {
            this.logParser.stopMonitoring(); // Ensure monitoring stops even on errors
        }
    }
}
exports.default = new EmailService();
