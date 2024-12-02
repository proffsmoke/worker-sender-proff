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
            sendmail: true,
            path: '/usr/sbin/sendmail',
            args: ['-v'], // Ativa o modo verbose do Sendmail
            newline: 'unix',
        });
        this.logParser = new log_parser_1.default('/var/log/mail.log');
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
            // Start monitoring logs before sending the email
            this.logParser.startMonitoring();
            // Send email
            const info = await this.transporter.sendMail(mailOptions);
            logger_1.default.info(`Headers enviados: ${JSON.stringify(mailOptions)}`);
            logger_1.default.info(`Saída completa do Sendmail: ${info.response}`);
            // Await log parsing to capture Queue ID
            const queueId = await this.logParser.waitForQueueId(uuid);
            const emailLog = new EmailLog_1.default({
                mailId: uuid,
                email: to,
                message: queueId ? 'E-mail enfileirado.' : `Erro ao capturar Queue ID.`,
                success: queueId ? null : false,
                detail: {
                    queueId,
                    rawResponse: info.response,
                    mailOptions,
                },
            });
            await emailLog.save();
            if (!queueId) {
                logger_1.default.warn(`Queue ID não capturado. Salvando log para análise posterior.`);
                throw new Error('Não foi possível capturar o Queue ID.');
            }
            logger_1.default.info(`Queue ID capturado: ${queueId}`);
            return queueId;
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar e-mail: ${error}`);
            throw error;
        }
    }
}
exports.default = new EmailService();
