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
            host: '127.0.0.1', // Substitua pelo endereço do servidor SMTP
            port: 25, // Porta do servidor SMTP
            secure: false, // True para 465, False para outras portas
            tls: { rejectUnauthorized: false }, // Aceitar certificado autoassinado
        });
        this.logParser = new log_parser_1.default('/var/log/mail.log');
    }
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc, subject, html, uuid } = params;
        const from = `"${fromName}" <no-reply@${emailDomain}>`;
        try {
            // Monitorar logs antes de enviar o e-mail
            this.logParser.startMonitoring();
            const mailOptions = {
                from,
                to,
                bcc,
                subject,
                html,
            };
            const info = await this.transporter.sendMail(mailOptions);
            logger_1.default.info(`Email enviado: ${JSON.stringify(mailOptions)}`);
            logger_1.default.debug(`Resposta do servidor SMTP: ${info.response}`);
            // Captura do Queue ID a partir da resposta SMTP
            const queueIdMatch = info.response.match(/queued as (\S+)/i);
            const queueId = queueIdMatch ? queueIdMatch[1] : null;
            if (queueId) {
                logger_1.default.info(`Queue ID capturado diretamente: ${queueId}`);
                await this.logParser.waitForQueueId(uuid); // Confirmação adicional via LogParser
            }
            else {
                logger_1.default.warn('Queue ID não capturado na resposta SMTP.');
            }
            const emailLog = new EmailLog_1.default({
                mailId: uuid,
                email: to,
                message: queueId ? 'E-mail enfileirado.' : 'Erro ao capturar Queue ID.',
                success: !!queueId,
                detail: {
                    queueId,
                    rawResponse: info.response,
                    mailOptions,
                },
            });
            await emailLog.save();
            if (!queueId) {
                throw new Error('Queue ID não encontrado.');
            }
            return queueId;
        }
        catch (error) {
            // logger.error(`Erro ao enviar e-mail: ${error.message}`, { stack: error.stack });
            throw error;
        }
        finally {
            this.logParser.stopMonitoring();
        }
    }
}
exports.default = new EmailService();
