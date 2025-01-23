"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const logger_1 = __importDefault(require("../utils/logger"));
const axios_1 = __importDefault(require("axios"));
class EmailService {
    constructor(logParser) {
        this.pendingSends = new Map();
        this.uuidQueueMap = new Map(); // Mapeia UUIDs para queueIds
        this.uuidResultsMap = new Map(); // Mapeia UUIDs para resultados
        this.transporter = nodemailer_1.default.createTransport({
            host: 'localhost',
            port: 25,
            secure: false,
            tls: { rejectUnauthorized: false },
        });
        this.logParser = logParser;
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
    async sendEmail(params, uuid) {
        const { fromName = 'No-Reply', emailDomain, to, bcc = [], subject, html, clientName } = params;
        const from = `"${fromName}" <no-reply@${emailDomain}>`;
        const toRecipients = Array.isArray(to) ? to.map((r) => r.toLowerCase()) : [to.toLowerCase()];
        const bccRecipients = bcc.map((r) => r.toLowerCase());
        const allRecipients = [...toRecipients, ...bccRecipients];
        try {
            const mailOptions = {
                from,
                to: Array.isArray(to) ? to.join(', ') : to,
                bcc,
                subject: clientName ? `[${clientName}] ${subject}` : subject,
                html,
            };
            const info = await this.transporter.sendMail(mailOptions);
            const queueId = info.response.match(/queued as\s([A-Z0-9]+)/);
            if (queueId && queueId[1]) {
                logger_1.default.info(`queueId extraído com sucesso: ${queueId[1]}`);
            }
            else {
                throw new Error('Não foi possível extrair o queueId da resposta');
            }
            logger_1.default.info(`Email enviado!`);
            logger_1.default.info(`queueId (messageId do servidor): ${queueId}`);
            logger_1.default.info(`Info completo: `, info);
            const recipientsStatus = allRecipients.map((recipient) => ({
                recipient,
                success: true,
            }));
            this.pendingSends.set(queueId[1], {
                toRecipients,
                bccRecipients,
                results: recipientsStatus,
            });
            if (uuid) {
                if (!this.uuidQueueMap.has(uuid)) {
                    this.uuidQueueMap.set(uuid, []);
                }
                this.uuidQueueMap.get(uuid)?.push(queueId[1]);
            }
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
    async sendEmailList(params, uuid) {
        const { emailDomain, emailList } = params;
        const results = await Promise.all(emailList.map(async (emailItem) => {
            return this.sendEmail({
                fromName: emailItem.name || 'No-Reply',
                emailDomain,
                to: emailItem.email,
                bcc: [],
                subject: emailItem.subject,
                html: emailItem.template,
                clientName: emailItem.clientName,
            }, uuid);
        }));
        return results;
    }
    async checkAndSendResults(uuid) {
        const queueIds = this.uuidQueueMap.get(uuid) || [];
        const allResults = [];
        for (const queueId of queueIds) {
            const sendData = this.pendingSends.get(queueId);
            if (sendData) {
                allResults.push(...sendData.results);
            }
        }
        if (allResults.length > 0) {
            logger_1.default.info(`Dados de resultado para o UUID ${uuid}:`, JSON.stringify(allResults, null, 2));
            try {
                const response = await axios_1.default.post('https://result.com/api/results', {
                    uuid,
                    results: allResults,
                }, {
                    timeout: 10000, // Timeout de 10 segundos
                });
                logger_1.default.info(`Resultados enviados para o UUID: ${uuid}`, response.data);
            }
            catch (error) {
                logger_1.default.error(`Erro ao enviar resultados para o UUID: ${uuid}`, error.message);
                if (error.response) {
                    logger_1.default.error(`Resposta da API: ${JSON.stringify(error.response.data)}`);
                }
            }
        }
    }
    handleLogEntry(logEntry) {
        const sendData = this.pendingSends.get(logEntry.queueId);
        if (!sendData) {
            return;
        }
        const success = logEntry.success;
        const recipient = logEntry.email.toLowerCase();
        const recipientIndex = sendData.results.findIndex((r) => r.recipient === recipient);
        if (recipientIndex !== -1) {
            sendData.results[recipientIndex].success = success;
            if (!success) {
                sendData.results[recipientIndex].error = `Status: ${logEntry.result}`;
            }
        }
        const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
        const processedRecipients = sendData.results.length;
        if (processedRecipients >= totalRecipients) {
            this.pendingSends.delete(logEntry.queueId);
            // Verifica se todos os emails de um UUID foram processados
            for (const [uuid, queueIds] of this.uuidQueueMap.entries()) {
                if (queueIds.includes(logEntry.queueId)) {
                    this.checkAndSendResults(uuid);
                }
            }
        }
    }
}
exports.default = EmailService;
