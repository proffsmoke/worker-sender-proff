"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const child_process_1 = require("child_process");
const EmailLog_1 = __importDefault(require("../models/EmailLog"));
const logger_1 = __importDefault(require("../utils/logger"));
class EmailService {
    constructor() {
        this.transporter = nodemailer_1.default.createTransport({
            sendmail: true,
            path: '/usr/sbin/sendmail',
            args: ['-v'], // Ativa o modo verbose para captura de informações básicas
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
            // Passo 1: Enviar o e-mail com Nodemailer
            const info = await this.transporter.sendMail(mailOptions);
            logger_1.default.info(`Headers enviados: ${JSON.stringify(mailOptions)}`);
            logger_1.default.info(`Saída básica do Sendmail: ${info.response}`);
            // Passo 2: Executar Sendmail diretamente com '-v -q' para capturar detalhes
            const queueId = await this.captureQueueId();
            if (!queueId) {
                logger_1.default.warn(`Queue ID não capturado. Salvando log para análise posterior.`);
                await this.logEmail({
                    mailId: uuid,
                    email: to,
                    message: `Erro ao capturar Queue ID após envio com -v -q.`,
                    success: false,
                    detail: {
                        rawResponse: info.response,
                        mailOptions,
                    },
                });
                throw new Error('Não foi possível capturar o Queue ID.');
            }
            logger_1.default.info(`Queue ID capturado: ${queueId}`);
            // Passo 3: Salvar log de sucesso no MongoDB
            await this.logEmail({
                mailId: uuid,
                email: to,
                message: 'E-mail enfileirado com sucesso.',
                success: true,
                detail: {
                    queueId,
                    rawResponse: info.response,
                    mailOptions,
                },
            });
            return queueId;
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar e-mail: ${error}`);
            throw error;
        }
    }
    /**
     * Captura o Queue ID executando Sendmail com os argumentos -v -q.
     */
    async captureQueueId() {
        return new Promise((resolve, reject) => {
            (0, child_process_1.exec)('/usr/sbin/sendmail -v -q', (error, stdout, stderr) => {
                if (error) {
                    logger_1.default.error(`Erro ao executar Sendmail: ${error.message}`);
                    reject(null);
                }
                logger_1.default.info(`Saída completa do Sendmail (-v -q): ${stdout || stderr}`);
                // Regex para capturar Queue ID na saída do Sendmail
                const queueIdMatch = (stdout || stderr).match(/(?:Message accepted for delivery|Queued mail for delivery).*?([A-Za-z0-9]+)/);
                resolve(queueIdMatch ? queueIdMatch[1] : null);
            });
        });
    }
    /**
     * Salva um log de e-mail no MongoDB.
     */
    async logEmail(log) {
        const emailLog = new EmailLog_1.default({
            mailId: log.mailId,
            email: log.email,
            message: log.message,
            success: log.success,
            detail: log.detail,
            sentAt: new Date(),
        });
        await emailLog.save();
    }
}
exports.default = new EmailService();
