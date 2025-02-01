"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const logger_1 = __importDefault(require("../utils/logger"));
const dotenv_1 = __importDefault(require("dotenv"));
const events_1 = require("events");
const EmailLog_1 = __importDefault(require("../models/EmailLog"));
dotenv_1.default.config();
class EmailService extends events_1.EventEmitter {
    constructor(logParser) {
        super();
        this.testEmailMailId = null;
        this.emailQueue = [];
        this.isProcessingQueue = false;
        this.transporter = nodemailer_1.default.createTransport({
            host: 'localhost',
            port: 25,
            secure: false,
            tls: { rejectUnauthorized: false },
        });
        this.logParser = logParser;
        this.pendingSends = new Map();
        this.logParser.on('log', this.handleLogEntry.bind(this));
        this.logParser.on('testEmailLog', this.handleTestEmailLog.bind(this));
    }
    static getInstance(logParser) {
        if (!EmailService.instance && logParser) {
            EmailService.instance = new EmailService(logParser);
        }
        else if (!EmailService.instance) {
            throw new Error('EmailService não foi inicializado. Forneça um LogParser.');
        }
        return EmailService.instance;
    }
    createRecipientStatus(recipient, success, error, queueId) {
        return {
            recipient,
            success,
            error,
            queueId,
        };
    }
    async sendEmail(params, uuid, existingQueueIds = []) {
        return new Promise((resolve, reject) => {
            this.emailQueue.push({ params, resolve, reject });
            this.processEmailQueue();
        });
    }
    async processEmailQueue() {
        if (this.isProcessingQueue || this.emailQueue.length === 0) {
            return;
        }
        this.isProcessingQueue = true;
        try {
            // Processa até 3 emails por vez
            const batch = this.emailQueue.splice(0, 3);
            await Promise.all(batch.map(async ({ params, resolve, reject }) => {
                try {
                    const result = await this.sendEmailInternal(params);
                    resolve(result);
                }
                catch (error) {
                    reject(error);
                }
            }));
            // Aguarda 1 segundo antes de processar o próximo lote
            setTimeout(() => {
                this.isProcessingQueue = false;
                this.processEmailQueue();
            }, 1000);
        }
        catch (error) {
            logger_1.default.error(`Erro no processamento do lote: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
            this.isProcessingQueue = false;
            this.processEmailQueue();
        }
    }
    async sendEmailInternal(params, existingQueueIds = []) {
        const { fromName, emailDomain, to, subject, html, sender } = params;
        const fromEmail = `${fromName.toLowerCase().replace(/\s+/g, '.')}@${emailDomain}`;
        const from = sender ? `"${fromName}" <${sender}>` : `"${fromName}" <${fromEmail}>`;
        const recipient = to.toLowerCase();
        try {
            // Criação do objeto de envio do e-mail
            const mailOptions = {
                from,
                to: recipient,
                subject,
                html,
            };
            logger_1.default.info(`Preparando para enviar email: ${JSON.stringify(mailOptions)}`);
            const info = await this.transporter.sendMail(mailOptions);
            // Extrair queueId
            const queueIdMatch = info.response.match(/queued as\s([A-Z0-9]+)/);
            if (!queueIdMatch || !queueIdMatch[1]) {
                throw new Error('Não foi possível extrair o queueId da resposta');
            }
            const queueId = queueIdMatch[1];
            // Extrair mailId
            const mailId = info.messageId;
            if (!mailId) {
                throw new Error('Não foi possível extrair o mailId da resposta');
            }
            // **Verificar se o queueId já existe (antes de salvar no EmailLog):**
            if (existingQueueIds.some(item => item.queueId === queueId)) {
                logger_1.default.info(`O queueId ${queueId} já está presente, não será duplicado.`);
                return {
                    queueId,
                    recipient: this.createRecipientStatus(recipient, false, "Duplicate queueId"),
                };
            }
            logger_1.default.info(`Email enviado com sucesso! Detalhes:
                - De: ${from}
                - Para: ${recipient}
                - QueueId: ${queueId}
                - MailId: ${mailId}
            `);
            const recipientStatus = this.createRecipientStatus(recipient, true, undefined, queueId);
            this.pendingSends.set(queueId, recipientStatus);
            // Salvar a associação no EmailLog, usando o mailId como UUID, e incluindo o queueId
            await this.saveQueueIdAndMailIdToEmailLog(queueId, mailId, recipient);
            logger_1.default.info(`Dados de envio associados com sucesso para queueId=${queueId} e mailId=${mailId}.`);
            return {
                queueId,
                recipient: recipientStatus,
            };
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email: ${error.message}`, error);
            const recipientStatus = this.createRecipientStatus(recipient, false, error.message);
            return {
                queueId: '',
                recipient: recipientStatus,
            };
        }
    }
    async saveQueueIdAndMailIdToEmailLog(queueId, mailId, recipient) {
        try {
            logger_1.default.info(`Tentando salvar queueId=${queueId}, mailId=${mailId} e recipient=${recipient} no EmailLog.`);
            let emailLog = await EmailLog_1.default.findOne({ mailId });
            if (!emailLog) {
                emailLog = new EmailLog_1.default({
                    mailId,
                    queueId,
                    email: recipient,
                    success: null,
                    updated: false,
                    sentAt: new Date(),
                    expireAt: new Date(Date.now() + 30 * 60 * 1000),
                });
            }
            emailLog.queueId = queueId;
            emailLog.email = recipient;
            await emailLog.save();
            logger_1.default.info(`Log salvo/atualizado no EmailLog: queueId=${queueId}, mailId=${mailId}, recipient=${recipient}`);
        }
        catch (error) {
            logger_1.default.error(`Erro ao salvar log no EmailLog:`, error);
        }
    }
    async handleLogEntry(logEntry) {
        const recipientStatus = this.pendingSends.get(logEntry.queueId);
        if (!recipientStatus) {
            logger_1.default.warn(`Nenhum dado pendente encontrado para queueId=${logEntry.queueId}`);
            return;
        }
        recipientStatus.success = logEntry.success;
        recipientStatus.logEntry = logEntry;
        if (!logEntry.success) {
            recipientStatus.error = `Status: ${logEntry.result}`;
            logger_1.default.error(`Falha ao enviar para recipient=${recipientStatus.recipient}. Erro: ${logEntry.result}. Log completo: ${JSON.stringify(logEntry)}`);
        }
        else {
            logger_1.default.info(`Resultado atualizado com sucesso para recipient=${recipientStatus.recipient}. Status: ${logEntry.success}. Log completo: ${JSON.stringify(logEntry)}`);
        }
        this.emit('queueProcessed', logEntry.queueId, recipientStatus);
    }
    async handleTestEmailLog(logEntry) {
        if (logEntry.mailId === this.testEmailMailId) {
            logger_1.default.info(`Log de teste recebido para mailId=${logEntry.mailId}. Resultado: ${logEntry.success}`);
            this.emit('testEmailProcessed', logEntry);
        }
    }
    async waitForTestEmailResult(uuid) {
        return new Promise((resolve) => {
            const onTestEmailProcessed = (result) => {
                if (result.mailId === this.testEmailMailId) {
                    this.removeListener('testEmailProcessed', onTestEmailProcessed);
                    resolve({ success: result.success, mailId: result.mailId });
                }
            };
            this.on('testEmailProcessed', onTestEmailProcessed);
            setTimeout(() => {
                this.removeListener('testEmailProcessed', onTestEmailProcessed);
                resolve({ success: false, mailId: this.testEmailMailId || undefined });
            }, 60000);
        });
    }
}
exports.default = EmailService;
