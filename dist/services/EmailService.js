"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const logger_1 = __importDefault(require("../utils/logger"));
const log_parser_1 = __importDefault(require("../log-parser"));
class EmailService {
    constructor(logParser) {
        this.pendingSends = new Map();
        this.transporter = nodemailer_1.default.createTransport({
            host: 'localhost', // Configura para usar o Postfix local
            port: 25, // Porta do servidor SMTP local (geralmente é 25 no Postfix)
            secure: false,
            tls: { rejectUnauthorized: false }, // Permite conexões TLS não verificadas
        });
        this.logParser = logParser;
        this.logParser.on('log', this.handleLogEntry.bind(this)); // Escuta os logs em tempo real
        this.logParser.startMonitoring(); // Inicia o monitoramento do log
    }
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc = [], subject, html } = params;
        const from = `"${fromName}" <no-reply@${emailDomain}>`;
        const toRecipients = Array.isArray(to) ? to.map((r) => r.toLowerCase()) : [to.toLowerCase()];
        const bccRecipients = bcc.map((r) => r.toLowerCase());
        const allRecipients = [...toRecipients, ...bccRecipients];
        try {
            const mailOptions = {
                from,
                to: Array.isArray(to) ? to.join(', ') : to,
                bcc,
                subject,
                html,
            };
            // Envia o email
            const info = await this.transporter.sendMail(mailOptions);
            // Extrai o queueId da resposta do servidor
            const queueId = info.response.match(/queued as\s([A-Z0-9]+)/);
            if (queueId && queueId[1]) {
                const extractedQueueId = queueId[1];
                logger_1.default.info(`queueId extraído com sucesso: ${extractedQueueId}`);
            }
            else {
                throw new Error('Não foi possível extrair o queueId da resposta');
            }
            // Log de depuração
            logger_1.default.info(`Email enviado!`);
            logger_1.default.info(`queueId (messageId do servidor): ${queueId}`);
            logger_1.default.info(`Info completo: `, info);
            const recipientsStatus = allRecipients.map((recipient) => ({
                recipient,
                success: true, // Assume sucesso inicialmente
            }));
            // Armazena o queueId para monitoramento
            this.pendingSends.set(queueId[1], {
                toRecipients,
                bccRecipients,
                results: recipientsStatus,
            });
            return {
                queueId: queueId[1],
                recipients: recipientsStatus,
            };
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email: ${error.message}`, error);
            const recipientsStatus = allRecipients.map((recipient) => ({
                recipient,
                success: false,
                error: error.message,
            }));
            return {
                queueId: '',
                recipients: recipientsStatus,
            };
        }
    }
    handleLogEntry(logEntry) {
        const sendData = this.pendingSends.get(logEntry.queueId);
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
        // Remove do pendingSends se todos os destinatários tiverem um resultado
        const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
        const processedRecipients = sendData.results.length;
        if (processedRecipients >= totalRecipients) {
            this.pendingSends.delete(logEntry.queueId);
        }
    }
    async sendInitialTestEmail() {
        const testEmailParams = {
            fromName: 'Mailer Test',
            emailDomain: 'outlook.com',
            to: 'no-reply@outlook.com',
            subject: 'Email de Teste Inicial',
            html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
        };
        return this.sendEmail(testEmailParams);
    }
    async awaitEmailResults(queueId) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout excedido para queueId ${queueId}`));
            }, 60000); // Timeout de 60 segundos
            this.logParser.once('log', (logEntry) => {
                logger_1.default.info(`Comparando queueId recebido: ${logEntry.queueId} com ${queueId}`);
                if (logEntry.queueId === queueId) {
                    logger_1.default.info('Correspondência encontrada, resolvendo...');
                    clearTimeout(timeout);
                    resolve();
                }
                else {
                    logger_1.default.info(`QueueId não corresponde: ${logEntry.queueId} != ${queueId}`);
                }
            });
        });
    }
}
const logParser = new log_parser_1.default('/var/log/mail.log');
exports.default = new EmailService(logParser);
