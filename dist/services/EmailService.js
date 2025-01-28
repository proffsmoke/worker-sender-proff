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
        this.testEmailMailId = null; // Armazena o mailId do teste atual
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
            logger_1.default.info(`Email enviado com sucesso! Detalhes:
        - De: ${from}
        - Para: ${recipient}
        - Bcc: ${bcc.join(', ')}
        - QueueId: ${queueId}
        - MailId: ${mailId}
      `);
            const recipientStatus = this.createRecipientStatus(recipient, true, undefined, queueId);
            this.pendingSends.set(queueId, recipientStatus);
            if (uuid) {
                // Se for um teste, armazena o mailId
                this.testEmailMailId = mailId;
                if (!this.uuidResults.has(uuid)) {
                    this.uuidResults.set(uuid, []);
                }
                this.uuidResults.get(uuid)?.push(recipientStatus);
                logger_1.default.info(`Associado queueId ${queueId} e mailId ${mailId} ao UUID ${uuid}`);
                // Salvar a associação no EmailLog, usando o mailId como UUID, e incluindo o queueId
                await this.saveQueueIdAndMailIdToEmailLog(queueId, mailId, recipient);
            }
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
            const existingLog = await EmailLog_1.default.findOne({ mailId });
            if (!existingLog) {
                const emailLog = new EmailLog_1.default({
                    mailId, // Usar mailId como identificador único
                    queueId,
                    email: recipient, // Email do destinatário
                    success: null, // Inicialmente null
                    updated: false,
                    sentAt: new Date(),
                    expireAt: new Date(Date.now() + 30 * 60 * 1000), // Expira em 30 minutos
                });
                await emailLog.save();
                logger_1.default.info(`Log salvo no EmailLog: queueId=${queueId}, mailId=${mailId}, recipient=${recipient}`);
            }
            else {
                logger_1.default.info(`Log já existe no EmailLog para mailId=${mailId}. Atualizando queueId=${queueId} e recipient=${recipient}`);
                existingLog.queueId = queueId;
                existingLog.email = recipient;
                await existingLog.save();
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
    // Novo método para lidar especificamente com logs do email de teste
    async handleTestEmailLog(logEntry) {
        if (logEntry.mailId === this.testEmailMailId) {
            logger_1.default.info(`Log de teste recebido para mailId=${logEntry.mailId}. Resultado: ${logEntry.success}`);
            this.emit('testEmailProcessed', logEntry);
        }
    }
    // **Modificado para usar 'testEmailProcessed'**
    async waitForTestEmailResult(uuid) {
        return new Promise((resolve) => {
            const onTestEmailProcessed = (result) => {
                if (result.mailId === this.testEmailMailId) {
                    this.removeListener('testEmailProcessed', onTestEmailProcessed);
                    resolve({ success: result.success, mailId: result.mailId });
                }
            };
            this.on('testEmailProcessed', onTestEmailProcessed);
            // Timeout para o caso de o log não ser encontrado
            setTimeout(() => {
                this.removeListener('testEmailProcessed', onTestEmailProcessed);
                resolve({ success: false, mailId: this.testEmailMailId || undefined });
            }, 60000);
        });
    }
    // Mantido como antes, mas agora não é mais usado diretamente pelo MailerService
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
                        logger_1.default.info(`   Success: ${recipient.success}`);
                        logger_1.default.info(`   QueueId: ${recipient.queueId}`);
                        if (recipient.error) {
                            logger_1.default.info(`   Error: ${recipient.error}`);
                        }
                        if (recipient.logEntry) {
                            logger_1.default.info(`   Log Completo: ${JSON.stringify(recipient.logEntry)}`);
                        }
                    });
                    logger_1.default.info('Summary:');
                    logger_1.default.info(`   Total: ${summary.total}`);
                    logger_1.default.info(`   Success: ${summary.success}`);
                    logger_1.default.info(`   Failed: ${summary.failed}`);
                }
            };
            this.on('queueProcessed', onQueueProcessed);
        });
    }
}
exports.default = EmailService;
