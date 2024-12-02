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
        const recipients = Array.isArray(to) ? to : [to];
        const allRecipients = [...recipients, ...(bcc || [])];
        try {
            this.logParser.startMonitoring();
            const mailOptions = { from, to: recipients.join(', '), bcc, subject, html };
            const info = await this.transporter.sendMail(mailOptions);
            logger_1.default.info(`Email enviado: ${JSON.stringify(mailOptions)}`);
            logger_1.default.debug(`Resposta do servidor SMTP: ${info.response}`);
            const queueIdMatch = info.response.match(/queued as (\S+)/i);
            const queueId = queueIdMatch ? queueIdMatch[1] : null;
            if (!queueId) {
                throw new Error('Queue ID não encontrado na resposta SMTP.');
            }
            logger_1.default.info(`Queue ID capturado diretamente: ${queueId}`);
            const results = await Promise.all(allRecipients.map(async (recipient) => {
                const logStatus = await this.logParser.waitForQueueId(queueId);
                // Ensure logStatus is a string before comparing
                const success = typeof logStatus === 'string' && logStatus === 'sent';
                const emailLog = new EmailLog_1.default({
                    mailId: uuid,
                    sendmailQueueId: queueId,
                    email: recipient,
                    message: `Status: ${success ? 'Enviado' : 'Falha'}`,
                    success,
                    detail: {
                        queueId,
                        rawResponse: info.response,
                        mailOptions,
                    },
                });
                await emailLog.save();
                return { recipient, success };
            }));
            logger_1.default.info(`Resultado do envio: MailID: ${uuid}, QueueID: ${queueId}, Recipients: ${JSON.stringify(results)}`);
            return {
                mailId: uuid,
                queueId,
                recipients: results,
            };
        }
        catch (error) {
            if (error instanceof Error) {
                logger_1.default.error(`Erro ao enviar e-mail: ${error.message}`, { stack: error.stack });
            }
            else {
                logger_1.default.error(`Erro desconhecido ao enviar e-mail: ${JSON.stringify(error)}`);
            }
            throw error;
        }
        finally {
            this.logParser.stopMonitoring();
        }
    }
}
exports.default = new EmailService();
