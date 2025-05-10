"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
const EmailQueueModel_1 = __importDefault(require("../models/EmailQueueModel"));
const EmailService_1 = __importDefault(require("../services/EmailService"));
const EmailRetryStatus_1 = __importDefault(require("../models/EmailRetryStatus"));
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
        const taskId = req.body.taskId;
        logger_1.default.info(`Recebido pedido de envio de e-mails para UUID=${uuid}${taskId ? ` (taskId: ${taskId})` : ''}`);
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
        const { emailDomain, emailList, fromName, uuid, subject, htmlContent, sender, taskId, } = body;
        const isDetailedTest = taskId === "FAKE_TASK_ID_FOR_DETAILED_TEST";
        logger_1.default.info(`Iniciando processamento dos e-mails para UUID=${uuid}${isDetailedTest ? " (DETAILED TEST)" : ""}`);
        // Validação básica
        const requiredParams = ['emailDomain', 'emailList', 'fromName', 'uuid', 'subject', 'htmlContent', 'sender'];
        const missingParams = requiredParams.filter(param => !(param in body));
        if (missingParams.length > 0) {
            logger_1.default.error(`Parâmetros obrigatórios ausentes para UUID=${uuid}: ${missingParams.join(', ')}. Requisição ignorada.`);
            return;
        }
        if (!isDetailedTest) {
            let emailQueue = await EmailQueueModel_1.default.findOne({ uuid });
            if (!emailQueue) {
                emailQueue = await EmailQueueModel_1.default.create({
                    uuid,
                    queueIds: [],
                    resultSent: false,
                });
                logger_1.default.info(`Criado novo documento EmailQueue para UUID=${uuid}`);
            }
        }
        else {
            logger_1.default.info(`[DETAILED TEST] Pulando criação/interação com EmailQueueModel para UUID=${uuid}`);
        }
        // 2) Remove duplicados da lista da requisição atual
        const uniqueEmailList = [];
        const emailMap = new Map();
        for (const emailData of emailList) {
            const normalizedEmail = emailData.email.toLowerCase();
            if (!emailMap.has(normalizedEmail)) {
                emailMap.set(normalizedEmail, { ...emailData, email: normalizedEmail });
                uniqueEmailList.push({ ...emailData, email: normalizedEmail });
            }
            else {
                logger_1.default.info(`E-mail duplicado ignorado na requisição UUID=${uuid}: ${emailData.email}`);
            }
        }
        // 3) Envia cada e-mail e faz push incremental
        const emailService = EmailService_1.default.getInstance();
        for (const emailData of uniqueEmailList) {
            const { email, name } = emailData;
            const emailAddress = email;
            // Verificar status de falha permanente ANTES de tentar enviar
            try {
                const retryStatus = await EmailRetryStatus_1.default.findOne({ email: emailAddress });
                if (retryStatus && retryStatus.isPermanentlyFailed) {
                    logger_1.default.warn(`Envio para ${emailAddress} (UUID=${uuid}) PULADO. E-mail marcado como FALHA PERMANENTE.`);
                    continue;
                }
            }
            catch (statusError) {
                logger_1.default.error(`Erro ao verificar EmailRetryStatus para ${emailAddress} (UUID=${uuid}):`, statusError);
            }
            const emailPayload = {
                emailDomain,
                fromName,
                to: emailAddress,
                subject,
                html: htmlContent,
                sender,
                ...(name && name !== "null" && { name }),
            };
            try {
                const result = await emailService.sendEmail(emailPayload, uuid);
                if (isDetailedTest) {
                    logger_1.default.info(`[DETAILED TEST] E-mail para ${emailAddress} (UUID=${uuid}) processado pelo EmailService. Resultado: ${JSON.stringify(result)}`);
                }
                else if (result.queueId) {
                    await EmailQueueModel_1.default.updateOne({ uuid }, {
                        $push: {
                            queueIds: {
                                queueId: result.queueId.toUpperCase(),
                                email: emailAddress,
                                success: null,
                            },
                        },
                        $set: {
                            resultSent: false,
                        },
                    });
                    const updatedQueue = await EmailQueueModel_1.default.findOne({ uuid }, { queueIds: 1 });
                    if (updatedQueue) {
                        const total = updatedQueue.queueIds.length;
                        const nullCount = updatedQueue.queueIds.filter(q => q.success === null).length;
                        logger_1.default.info(`QueueId inserido p/ UUID=${uuid}: queueId=${result.queueId}, email=${emailAddress}. ` +
                            `Pendentes=${nullCount}, total=${total}.`);
                    }
                }
                else if (!isDetailedTest) {
                    logger_1.default.warn(`Nenhum queueId retornado para o e-mail ${emailAddress} (UUID=${uuid})`);
                }
            }
            catch (err) {
                logger_1.default.error(`Erro ao enfileirar/processar e-mail para ${emailAddress} (UUID=${uuid}):`, err);
            }
        }
        logger_1.default.info(`Processamento de e-mails concluído para UUID=${uuid}${isDetailedTest ? " (DETAILED TEST)" : ""}`);
    }
}
exports.default = new EmailController();
