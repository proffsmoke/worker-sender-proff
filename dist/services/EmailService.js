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
const EmailQueueModel_1 = __importDefault(require("../models/EmailQueueModel"));
const antiSpam_1 = __importDefault(require("../utils/antiSpam"));
// Importa RpaService (ajuste o caminho conforme seu projeto)
// Certifique-se de que generateRandomDomain() está declarado como "public" no RpaService
const RpaService_1 = __importDefault(require("../services/RpaService"));
dotenv_1.default.config();
class EmailService extends events_1.EventEmitter {
    constructor(logParser) {
        super();
        this.testEmailMailId = null;
        // Fila interna de envios, com controle de lotes
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
        // Eventos do logParser
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
        return { recipient, success, error, queueId };
    }
    /**
     * Enfileira o envio de e-mail e retorna uma Promise com o resultado (queueId, success, etc.).
     */
    async sendEmail(params, uuid) {
        return new Promise((resolve, reject) => {
            this.emailQueue.push({ params, resolve, reject });
            this.processEmailQueue();
        });
    }
    /**
     * Processa a fila interna em lotes (até 3 por vez).
     * Para ficar mais rápido/fluido, reduzimos o delay entre lotes para 200ms.
     */
    async processEmailQueue() {
        if (this.isProcessingQueue || this.emailQueue.length === 0) {
            return;
        }
        this.isProcessingQueue = true;
        try {
            const batch = this.emailQueue.splice(0, 3);
            await Promise.all(batch.map(async ({ params, resolve, reject }) => {
                try {
                    const result = await this.sendEmailInternal(params);
                    resolve(result);
                }
                catch (err) {
                    reject(err);
                }
            }));
            // Pausa de 200ms antes do próximo lote
            setTimeout(() => {
                this.isProcessingQueue = false;
                this.processEmailQueue();
            }, 200);
        }
        catch (error) {
            logger_1.default.error(`Erro no processamento do lote: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
            this.isProcessingQueue = false;
            this.processEmailQueue();
        }
    }
    /**
     * Substitui tags {$name(algumTexto)} no conteúdo do e-mail.
     */
    substituteNameTags(text, name) {
        return text.replace(/\{\$name\(([^)]+)\)\}/g, (_, defaultText) => {
            // Trata explicitamente null, "null" e string vazia
            const isValidName = name && name !== "null" && name.trim() !== "";
            return isValidName ? name : defaultText;
        });
    }
    /**
     * Método interno que efetivamente envia o e-mail via nodemailer.
     * Aqui ajustamos apenas o "name" (HELO) usando o RpaService.
     */
    async sendEmailInternal(params) {
        const { fromName, emailDomain, to, subject, html, sender, name } = params;
        // Agora "generateRandomDomain()" é público no RpaService
        const randomHeloDomain = RpaService_1.default.getInstance().generateRandomDomain();
        // Forçar o "name" no transporter (HELO)
        this.transporter.options.name = randomHeloDomain;
        const fromEmail = `${fromName.toLowerCase().replace(/\s+/g, '.')}@${emailDomain}`;
        const from = sender
            ? `"${fromName}" <${sender}>`
            : `"${fromName}" <${fromEmail}>`;
        const recipient = to.toLowerCase();
        try {
            // ============= LOGS DE DEPURAÇÃO DAS ETAPAS DE HTML =============
            logger_1.default.info(`HTML original:\n${html}`);
            // 1) Substituição de {$name()}
            const processedHtml = this.substituteNameTags(html, name);
            logger_1.default.info(`HTML após substituição de placeholders:\n${processedHtml}`);
            // 2) Substituição de placeholders também no assunto
            const processedSubject = this.substituteNameTags(subject, name);
            // 3) Passar pelo antiSpam
            const antiSpamHtml = (0, antiSpam_1.default)(processedHtml);
            logger_1.default.info(`HTML após antiSpam:\n${antiSpamHtml}`);
            // ================================================================
            const mailOptions = {
                from,
                to: recipient,
                subject: processedSubject,
                html: antiSpamHtml, // caso não queira usar antiSpam, trocar para processedHtml
            };
            const info = await this.transporter.sendMail(mailOptions);
            // Extrair queueId da resposta
            const queueIdMatch = info.response.match(/queued as\s([A-Z0-9]+)/);
            if (!queueIdMatch || !queueIdMatch[1]) {
                throw new Error('Não foi possível extrair o queueId da resposta do servidor');
            }
            const rawQueueId = queueIdMatch[1];
            const queueId = rawQueueId.toUpperCase();
            logger_1.default.info(`EmailService.sendEmailInternal - Extraído queueId=${queueId}; HELO usado: ${randomHeloDomain}`);
            // Extrair mailId
            const mailId = info.messageId;
            if (!mailId) {
                throw new Error('Não foi possível extrair o mailId da resposta');
            }
            logger_1.default.info(`Email enviado com sucesso: de=${from}, para=${recipient}, queueId=${queueId}, mailId=${mailId}`);
            // Cria um status local e salva no pendingSends
            const recipientStatus = this.createRecipientStatus(recipient, true, undefined, queueId);
            this.pendingSends.set(queueId, recipientStatus);
            // Salva também no EmailLog
            await this.saveQueueIdAndMailIdToEmailLog(queueId, mailId, recipient);
            return {
                queueId,
                recipient: recipientStatus,
            };
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar e-mail para ${recipient}: ${error.message}`, error);
            const recipientStatus = this.createRecipientStatus(recipient, false, error.message);
            return { queueId: '', recipient: recipientStatus };
        }
    }
    /**
     * Salva (ou atualiza) as informações no EmailLog, relacionando queueId e mailId.
     */
    async saveQueueIdAndMailIdToEmailLog(queueId, mailId, recipient) {
        try {
            const doc = await EmailLog_1.default.findOneAndUpdate({ queueId }, {
                $set: {
                    mailId,
                    email: recipient,
                    updated: true,
                    sentAt: new Date(),
                },
                $setOnInsert: {
                    expireAt: new Date(Date.now() + 30 * 60 * 1000),
                },
            }, { upsert: true, new: true });
            logger_1.default.info(`Log salvo/atualizado no EmailLog: queueId=${queueId}, mailId=${mailId}, recipient=${recipient}`);
            logger_1.default.info(`EmailLog atual: ${JSON.stringify(doc, null, 2)}`);
        }
        catch (error) {
            logger_1.default.error(`Erro ao salvar log no EmailLog:`, error);
        }
    }
    /**
     * Atualiza o campo success no array de queueIds no EmailQueueModel.
     */
    async updateEmailQueueModel(queueId, success) {
        try {
            const filter = { 'queueIds.queueId': queueId };
            logger_1.default.info(`updateEmailQueueModel - Buscando documento com filtro: ${JSON.stringify(filter)}`);
            const existingDoc = await EmailQueueModel_1.default.findOne(filter, { queueIds: 1, uuid: 1 });
            if (!existingDoc) {
                logger_1.default.warn(`findOne não encontrou nenhum doc para queueIds.queueId=${queueId}`);
            }
            else {
                const total = existingDoc.queueIds.length;
                const nullCount = existingDoc.queueIds.filter(q => q.success === null).length;
                const nonNullCount = total - nullCount;
                logger_1.default.info(`Documento encontrado: uuid=${existingDoc.uuid}, totalQueueIds=${total}, ` +
                    `successNull=${nullCount}, successNotNull=${nonNullCount}`);
            }
            const result = await EmailQueueModel_1.default.updateOne({ 'queueIds.queueId': queueId }, { $set: { 'queueIds.$.success': success } });
            logger_1.default.info(`Queue atualizada no EmailQueueModel: queueId=${queueId} => success=${success}`);
            logger_1.default.info(`Queue update result for queueId=${queueId}: ${JSON.stringify(result)}`);
            if (result.matchedCount === 0) {
                logger_1.default.warn(`Nenhum documento foi encontrado para queueIds.queueId=${queueId} durante o update.`);
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao atualizar EmailQueueModel para queueId=${queueId}`, error);
        }
    }
    /**
     * Intercepta logs do Postfix e atualiza o EmailQueueModel.
     */
    async handleLogEntry(logEntry) {
        logger_1.default.info(`handleLogEntry - Log recebido: ${JSON.stringify(logEntry)}`);
        const normalizedQueueId = logEntry.queueId.toUpperCase();
        const recipientStatus = this.pendingSends.get(normalizedQueueId);
        if (!recipientStatus) {
            logger_1.default.warn(`Nenhum status pendente para queueId=${normalizedQueueId}`);
            // Mesmo assim, tenta atualizar o EmailQueueModel
            await this.updateEmailQueueModel(normalizedQueueId, logEntry.success);
            return;
        }
        recipientStatus.success = logEntry.success;
        recipientStatus.logEntry = logEntry;
        if (!logEntry.success) {
            recipientStatus.error = `Falha ao enviar: ${logEntry.result}`;
            logger_1.default.error(`Falha para ${recipientStatus.recipient}: ${logEntry.result}`);
        }
        else {
            logger_1.default.info(`Sucesso para ${recipientStatus.recipient}: ${logEntry.result}`);
        }
        // Atualiza no MongoDB
        await this.updateEmailQueueModel(normalizedQueueId, logEntry.success);
        // Emite evento se necessário
        this.emit('queueProcessed', normalizedQueueId, recipientStatus);
    }
    /**
     * Trata logs de teste, se existir essa funcionalidade específica.
     */
    async handleTestEmailLog(logEntry) {
        if (logEntry.mailId === this.testEmailMailId) {
            logger_1.default.info(`Log de teste para mailId=${logEntry.mailId}, success=${logEntry.success}`);
            this.emit('testEmailProcessed', logEntry);
        }
    }
    /**
     * Aguarda resultado de um e-mail de teste por até 60s (opcional).
     */
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
