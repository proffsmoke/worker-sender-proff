"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
const EmailQueueModel_1 = __importDefault(require("../models/EmailQueueModel"));
const EmailService_1 = __importDefault(require("../services/EmailService"));
class EmailController {
    constructor() {
        this.sendNormal = this.sendNormal.bind(this);
    }
    /**
     * Recebe a requisição para envio de e-mails, responde imediatamente
     * e processa o envio em background.
     */
    async sendNormal(req, res, _next) {
        const { uuid } = req.body;
        logger_1.default.info(`Recebido pedido de envio de e-mails para UUID=${uuid}`);
        // Resposta imediata
        res.status(200).json({ message: 'Emails enfileirados para envio.', uuid });
        // Processa em background (sem travar a requisição principal)
        this.processEmails(req.body).catch(error => {
            logger_1.default.error(`Erro no processamento dos emails para UUID=${uuid}:`, error);
        });
    }
    /**
     * Processa as listas de e-mails:
     * - Garante que o documento EmailQueue existe (senão cria).
     * - Remove duplicadas.
     * - Para cada e-mail, envia e faz $push incremental no array queueIds.
     */
    async processEmails(body) {
        const { emailDomain, emailList, fromName, uuid, subject, htmlContent, sender } = body;
        logger_1.default.info(`Iniciando processamento dos e-mails para UUID=${uuid}`);
        // Validação básica
        const requiredParams = ['emailDomain', 'emailList', 'fromName', 'uuid', 'subject', 'htmlContent', 'sender'];
        const missingParams = requiredParams.filter(param => !(param in body));
        if (missingParams.length > 0) {
            throw new Error(`Parâmetros obrigatórios ausentes: ${missingParams.join(', ')}.`);
        }
        // 1) Garante que o documento no Mongo exista
        let emailQueue = await EmailQueueModel_1.default.findOne({ uuid });
        if (!emailQueue) {
            emailQueue = await EmailQueueModel_1.default.create({
                uuid,
                queueIds: [],
                resultSent: false,
            });
            logger_1.default.info(`Criado novo documento EmailQueue para UUID=${uuid}`);
        }
        // 2) Remove duplicados
        const uniqueEmailList = [];
        const emailMap = new Map();
        for (const emailData of emailList) {
            if (!emailMap.has(emailData.email)) {
                emailMap.set(emailData.email, emailData);
                uniqueEmailList.push(emailData);
            }
            else {
                logger_1.default.info(`E-mail duplicado ignorado: ${emailData.email}`);
            }
        }
        // 3) Envia cada e-mail e faz push incremental
        const emailService = EmailService_1.default.getInstance();
        for (const emailData of uniqueEmailList) {
            const { email, name } = emailData;
            const emailPayload = {
                emailDomain,
                fromName,
                to: email,
                subject,
                html: htmlContent,
                sender,
                ...(name && { name }), // adiciona `name` somente se existir
            };
            try {
                // Envio (await) - não bloqueia completamente pois o service já lida em lotes
                const result = await emailService.sendEmail(emailPayload, uuid);
                if (result.queueId) {
                    // Incrementa no Mongo o array com este queueId
                    await EmailQueueModel_1.default.updateOne({ uuid }, {
                        $push: {
                            queueIds: {
                                queueId: result.queueId.toUpperCase(),
                                email: email.toLowerCase(),
                                success: null,
                            },
                        },
                        $set: {
                            resultSent: false,
                        },
                    });
                    // (Opcional) Loga quantos ainda estão null e quantos total
                    const updatedQueue = await EmailQueueModel_1.default.findOne({ uuid }, { queueIds: 1 });
                    if (updatedQueue) {
                        const total = updatedQueue.queueIds.length;
                        const nullCount = updatedQueue.queueIds.filter(q => q.success === null).length;
                        logger_1.default.info(`QueueId inserido p/ UUID=${uuid}: queueId=${result.queueId}, email=${email}. ` +
                            `Pendentes=${nullCount}, total=${total}.`);
                    }
                }
                else {
                    logger_1.default.warn(`Nenhum queueId retornado para o e-mail ${email}`);
                }
            }
            catch (err) {
                logger_1.default.error(`Erro ao enfileirar e-mail para ${email}:`, err);
            }
        }
        logger_1.default.info(`Processamento concluído para UUID=${uuid}`);
    }
}
exports.default = new EmailController();
