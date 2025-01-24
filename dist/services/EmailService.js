"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const logger_1 = __importDefault(require("../utils/logger"));
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
    createRecipientsStatus(recipients, success, error, queueId) {
        return recipients.map((recipient) => ({
            recipient,
            success,
            error,
            queueId,
        }));
    }
    async sendEmail(params, uuid) {
        const { fromName = 'No-Reply', emailDomain, to, bcc = [], subject, html, clientName } = params;
        // Construir o campo "from" usando o fromName e o emailDomain
        const fromEmail = `no-reply@${emailDomain}`; // Usar o domínio fornecido
        const from = `"${fromName}" <${fromEmail}>`;
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
            logger_1.default.info(`extraído com sucesso de response:${info.response}, queueId: ${queueId}`);
            logger_1.default.info(`Email enviado!`);
            if (this.stateManager.isQueueIdAssociated(queueId)) {
                logger_1.default.warn(`queueId ${queueId} já foi processado. Ignorando duplicação.`);
                return {
                    queueId,
                    recipients: this.createRecipientsStatus(allRecipients, true, undefined, queueId),
                };
            }
            if (uuid) {
                this.stateManager.addQueueIdToUuid(uuid, queueId);
                logger_1.default.info(`Associado queueId ${queueId} ao UUID ${uuid}`);
            }
            const recipientsStatus = this.createRecipientsStatus(allRecipients, true, undefined, queueId);
            this.stateManager.addPendingSend(queueId, {
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
            logger_1.default.error(`Erro ao enviar email: ${error.message}`, error);
            return {
                queueId: '',
                recipients: this.createRecipientsStatus(allRecipients, false, error.message),
            };
        }
    }
    async handleLogEntry(logEntry) {
        const sendData = this.stateManager.getPendingSend(logEntry.queueId);
        if (!sendData)
            return;
        const success = logEntry.success;
        const recipient = logEntry.email.toLowerCase();
        const recipientIndex = sendData.results.findIndex((r) => r.recipient === recipient);
        if (recipientIndex !== -1) {
            sendData.results[recipientIndex].success = success;
            if (!success) {
                sendData.results[recipientIndex].error = `Status: ${logEntry.result}`;
                logger_1.default.error(`Falha ao enviar para recipient=${recipient}. Erro: ${logEntry.result}. Log completo: ${JSON.stringify(logEntry)}`);
            }
            else {
                logger_1.default.info(`Resultado atualizado com sucesso para recipient=${recipient}. Status: ${success}. Log completo: ${JSON.stringify(logEntry)}`);
            }
        }
        else {
            logger_1.default.warn(`Recipient ${recipient} não encontrado nos resultados para queueId=${logEntry.queueId}. Log completo: ${JSON.stringify(logEntry)}`);
        }
        const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
        const processedRecipients = sendData.results.length;
        logger_1.default.debug(`Status de processamento para queueId=${logEntry.queueId}: Total de recipients=${totalRecipients}, Processados=${processedRecipients}. Log completo: ${JSON.stringify(logEntry)}`);
        if (processedRecipients >= totalRecipients) {
            logger_1.default.info(`Todos os recipients processados para queueId=${logEntry.queueId}. Removendo do pendingSends. Status atual: ${JSON.stringify(sendData)}`);
            this.stateManager.deletePendingSend(logEntry.queueId);
            const uuid = this.stateManager.getUuidByQueueId(logEntry.queueId);
            if (uuid) {
                logger_1.default.info(`Atualizando status para queueId=${logEntry.queueId} com UUID=${uuid}.`);
                await this.stateManager.updateQueueIdStatus(logEntry.queueId, success, uuid);
            }
            if (uuid && this.stateManager.isUuidProcessed(uuid)) {
                const results = await this.stateManager.consolidateResultsByUuid(uuid);
                if (results) {
                    logger_1.default.info(`Todos os queueIds para uuid=${uuid} foram processados. Resultados consolidados:`, results);
                    await this.consolidateAndSendResults(uuid, results);
                }
            }
            else {
                logger_1.default.warn(`UUID ${uuid} não encontrado ou não processado para queueId=${logEntry.queueId}.`);
            }
        }
    }
    async consolidateAndSendResults(uuid, results) {
        const allSuccess = results.every((result) => result.success);
        logger_1.default.info(`Resultados consolidados para uuid=${uuid}:`, results);
        logger_1.default.info(`Todos os emails foram enviados com sucesso? ${allSuccess}`);
    }
}
exports.default = EmailService;
