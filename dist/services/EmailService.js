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
        this.transporter = nodemailer_1.default.createTransport({
            host: 'localhost',
            port: 25,
            secure: false,
            tls: { rejectUnauthorized: false },
        });
        this.logParser = logParser;
        this.pendingSends = new Map();
        this.uuidResults = new Map();
        this.logParser.on('log', this.handleLogEntry.bind(this));
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
    // EmailService.ts
    async sendEmail(params, uuid) {
        const { fromName, emailDomain, to, bcc = [], subject, html, clientName, mailerId } = params;
        const fromEmail = `${fromName.toLowerCase().replace(/\s+/g, '.')}@${emailDomain}`;
        const from = `"${fromName}" <${fromEmail}>`;
        const recipient = to.toLowerCase();
        try {
            const mailOptions = {
                from,
                to: recipient,
                bcc,
                subject: clientName ? `[${clientName}] ${subject}` : subject,
                html,
            };
            logger_1.default.info(`Preparando para enviar email: ${JSON.stringify(mailOptions)}`);
            const info = await this.transporter.sendMail(mailOptions);
            const queueIdMatch = info.response.match(/queued as\s([A-Z0-9]+)/);
            if (!queueIdMatch || !queueIdMatch[1]) {
                throw new Error('Não foi possível extrair o queueId da resposta');
            }
            const queueId = queueIdMatch[1];
            logger_1.default.info(`Email enviado com sucesso! Detalhes: 
      - De: ${from}
      - Para: ${recipient}
      - Bcc: ${bcc.join(', ')}
      - QueueId: ${queueId}
    `);
            const recipientStatus = this.createRecipientStatus(recipient, true, undefined, queueId);
            this.pendingSends.set(queueId, recipientStatus);
            if (uuid) {
                if (!this.uuidResults.has(uuid)) {
                    this.uuidResults.set(uuid, []);
                }
                this.uuidResults.get(uuid)?.push(recipientStatus);
                logger_1.default.info(`Associado queueId ${queueId} ao UUID ${uuid}`);
                // Salvar a associação no EmailLog
                await this.saveQueueIdToEmailLog(queueId, uuid);
            }
            logger_1.default.info(`Dados de envio associados com sucesso para queueId=${queueId}.`);
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
    async saveQueueIdToEmailLog(queueId, mailId) {
        try {
            logger_1.default.info(`Tentando salvar queueId=${queueId} e mailId=${mailId} no EmailLog.`);
            const existingLog = await EmailLog_1.default.findOne({ queueId });
            if (!existingLog) {
                const emailLog = new EmailLog_1.default({
                    mailId, // UUID
                    queueId,
                    email: 'no-reply@unknown.com', // E-mail padrão
                    success: null, // Inicialmente null
                    updated: false,
                    sentAt: new Date(),
                    expireAt: new Date(Date.now() + 30 * 60 * 1000), // Expira em 30 minutos
                });
                await emailLog.save();
                logger_1.default.info(`Log salvo no EmailLog: queueId=${queueId}, mailId=${mailId}`);
            }
            else {
                logger_1.default.info(`Log já existe no EmailLog: queueId=${queueId}`);
            }
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
        recipientStatus.logEntry = logEntry; // Adiciona o logEntry ao recipientStatus
        if (!logEntry.success) {
            recipientStatus.error = `Status: ${logEntry.result}`;
            logger_1.default.error(`Falha ao enviar para recipient=${recipientStatus.recipient}. Erro: ${logEntry.result}. Log completo: ${JSON.stringify(logEntry)}`);
        }
        else {
            logger_1.default.info(`Resultado atualizado com sucesso para recipient=${recipientStatus.recipient}. Status: ${logEntry.success}. Log completo: ${JSON.stringify(logEntry)}`);
        }
        this.emit('queueProcessed', logEntry.queueId, recipientStatus);
    }
    async waitForUUIDCompletion(uuid) {
        return new Promise((resolve) => {
            const results = this.uuidResults.get(uuid) || [];
            const onQueueProcessed = (queueId, recipientStatus) => {
                // Atualiza o resultado no array de resultados do UUID
                const existingResultIndex = results.findIndex((r) => r.queueId === queueId);
                if (existingResultIndex !== -1) {
                    results[existingResultIndex] = recipientStatus; // Atualiza o resultado existente
                }
                else {
                    results.push(recipientStatus); // Adiciona um novo resultado
                }
                // Verifica se todos os queueIds foram processados
                const allQueueIdsProcessed = Array.from(this.pendingSends.keys()).every((qId) => !this.uuidResults.get(uuid)?.some((r) => r.queueId === qId));
                if (allQueueIdsProcessed) {
                    this.removeListener('queueProcessed', onQueueProcessed);
                    // Cria o resumo consolidado
                    const summary = {
                        total: results.length,
                        success: results.filter((r) => r.success).length,
                        failed: results.filter((r) => !r.success).length,
                    };
                    // Retorna o resumo completo
                    resolve({
                        uuid,
                        recipients: results,
                        summary,
                    });
                    // Exibe o resumo no log
                    logger_1.default.info('Resumo Completo:');
                    logger_1.default.info(`UUID: ${uuid}`);
                    logger_1.default.info('Recipients:');
                    results.forEach((recipient) => {
                        logger_1.default.info(`- Recipient: ${recipient.recipient}`);
                        logger_1.default.info(`  Success: ${recipient.success}`);
                        logger_1.default.info(`  QueueId: ${recipient.queueId}`);
                        if (recipient.error) {
                            logger_1.default.info(`  Error: ${recipient.error}`);
                        }
                        if (recipient.logEntry) {
                            logger_1.default.info(`  Log Completo: ${JSON.stringify(recipient.logEntry)}`);
                        }
                    });
                    logger_1.default.info('Summary:');
                    logger_1.default.info(`  Total: ${summary.total}`);
                    logger_1.default.info(`  Success: ${summary.success}`);
                    logger_1.default.info(`  Failed: ${summary.failed}`);
                }
            };
            this.on('queueProcessed', onQueueProcessed);
        });
    }
}
exports.default = EmailService;
