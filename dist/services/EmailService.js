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
        this.version = '1.0.0'; // Versão do serviço
        this.createdAt = new Date(); // Data de criação do serviço
        this.status = 'health'; // Status do serviço
        this.blockReason = null; // Razão do bloqueio, se houver
        this.transporter = nodemailer_1.default.createTransport({
            host: 'localhost', // Configura para usar o Postfix local
            port: 25, // Porta do servidor SMTP local (geralmente é 25 no Postfix)
            secure: false,
            tls: { rejectUnauthorized: false }, // Permite conexões TLS não verificadas
        });
        this.logParser = logParser;
        this.logParser.on('log', this.handleLogEntry.bind(this));
    }
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
        };
        return this.sendEmail(testEmailParams);
    }
    async handleLogEntry(logEntry) {
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
            const queueId = info.response.match(/queued as\s([A-Z0-9]+)/)[1];
            // Log de depuração
            console.log(`Email enviado!`);
            console.log(`queueId (messageId do servidor): ${queueId}`);
            console.log(`info completo: `, info);
            const recipientsStatus = allRecipients.map((recipient) => ({
                recipient,
                success: true, // Assume sucesso inicialmente
            }));
            // Armazena o queueId para monitoramento
            this.pendingSends.set(queueId, {
                toRecipients,
                bccRecipients,
                results: recipientsStatus,
            });
            return {
                queueId,
                recipients: recipientsStatus,
            };
        }
        catch (error) {
            logger_1.default.error(`Error sending email: ${error.message}`, error);
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
    async awaitEmailResults(queueId) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout exceeded for queueId ${queueId}`));
            }, 30000); // Timeout de 30 segundos
            this.logParser.once('log', (logEntry) => {
                console.log(`Comparando queueId recebido: ${logEntry.queueId} com ${queueId}`);
                if (logEntry.queueId === queueId) {
                    console.log('Correspondência encontrada, resolvendo...');
                    clearTimeout(timeout);
                    resolve();
                }
                else {
                    console.log(`QueueId não corresponde: ${logEntry.queueId} != ${queueId}`);
                }
            });
        });
    }
}
const logParser = new log_parser_1.default('/var/log/mail.log');
exports.default = new EmailService(logParser);
