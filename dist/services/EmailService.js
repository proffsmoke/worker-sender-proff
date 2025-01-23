"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const logger_1 = __importDefault(require("../utils/logger"));
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const StateManager_1 = __importDefault(require("./StateManager"));
dotenv_1.default.config();
class EmailService {
    constructor(logParser) {
        this.transporter = nodemailer_1.default.createTransport({
            host: 'localhost',
            port: 25,
            secure: false,
            tls: { rejectUnauthorized: false },
        });
        this.logParser = logParser;
        this.stateManager = new StateManager_1.default();
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
        const from = `"${fromName}" <${process.env.MAILER_NOREPLY_EMAIL || 'no-reply@outlook.com'}>`;
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
            const queueIdMatch = info.response.match(/queued as\s([A-Z0-9]+)/);
            if (!queueIdMatch || !queueIdMatch[1]) {
                throw new Error('Não foi possível extrair o queueId da resposta');
            }
            const queueId = queueIdMatch[1];
            const mailId = info.messageId;
            logger_1.default.info(`queueId extraído com sucesso: ${queueId}`);
            logger_1.default.info(`Email enviado!`);
            logger_1.default.info(`queueId (messageId do servidor): queued as ${queueId}`);
            logger_1.default.info(`Info completo: `, info);
            const recipientsStatus = allRecipients.map((recipient) => ({
                recipient,
                success: true,
                queueId,
                mailId,
            }));
            this.stateManager.addPendingSend(queueId, {
                toRecipients,
                bccRecipients,
                results: recipientsStatus,
            });
            if (uuid) {
                this.stateManager.addQueueIdToUuid(uuid, queueId);
            }
            return {
                queueId,
                mailId,
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
                mailId: '',
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
    handleLogEntry(logEntry) {
        const sendData = this.stateManager.getPendingSend(logEntry.queueId);
        if (!sendData) {
            logger_1.default.warn(`Nenhum dado encontrado no pendingSends para queueId=${logEntry.queueId}`);
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
            logger_1.default.info(`Resultado atualizado para recipient=${recipient}:`, sendData.results[recipientIndex]);
        }
        else {
            logger_1.default.warn(`Recipient ${recipient} não encontrado nos resultados para queueId=${logEntry.queueId}`);
        }
        const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
        const processedRecipients = sendData.results.length;
        if (processedRecipients >= totalRecipients) {
            logger_1.default.info(`Todos os recipients processados para queueId=${logEntry.queueId}. Removendo do pendingSends.`);
            this.stateManager.deletePendingSend(logEntry.queueId);
            // Itera sobre todos os UUIDs no uuidQueueMap
            for (const [currentUuid, queueIds] of this.stateManager.getUuidQueueMap().entries()) {
                if (queueIds.includes(logEntry.queueId)) {
                    const allProcessed = queueIds.every((qId) => !this.stateManager.getPendingSend(qId));
                    if (allProcessed) {
                        logger_1.default.info(`Chamando checkAndSendResults para UUID=${currentUuid}`);
                        this.checkAndSendResults(currentUuid);
                    }
                }
            }
        }
    }
    async checkAndSendResults(uuid, mockMode = true) {
        const queueIds = this.stateManager.getQueueIdsByUuid(uuid) || [];
        const allResults = [];
        for (const queueId of queueIds) {
            const sendData = this.stateManager.getPendingSend(queueId);
            if (sendData) {
                allResults.push(...sendData.results);
            }
        }
        if (allResults.length > 0) {
            logger_1.default.info(`Dados de resultado para o UUID ${uuid}:`, JSON.stringify(allResults, null, 2));
            if (mockMode) {
                logger_1.default.info('Modo mock ativado. Resultados não serão enviados para a API.');
                const mockResponse = {
                    status: 200,
                    data: {
                        success: true,
                        message: 'Resultados recebidos com sucesso (modo mock).',
                        results: allResults,
                    },
                };
                logger_1.default.info('Resposta simulada:', JSON.stringify(mockResponse.data, null, 2));
                return mockResponse;
            }
            else {
                try {
                    const response = await axios_1.default.post('https://result.com/api/results', {
                        uuid,
                        results: allResults,
                    }, {
                        timeout: 10000,
                    });
                    logger_1.default.info(`Resultados enviados para o UUID: ${uuid}`, response.data);
                    return response;
                }
                catch (error) {
                    logger_1.default.error(`Erro ao enviar resultados para o UUID: ${uuid}`, error.message);
                    throw error;
                }
            }
        }
        else {
            logger_1.default.warn(`Nenhum resultado encontrado para o UUID: ${uuid}`);
            return null;
        }
    }
}
exports.default = EmailService;
