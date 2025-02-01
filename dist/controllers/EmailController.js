"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const EmailService_1 = __importDefault(require("../services/EmailService"));
const logger_1 = __importDefault(require("../utils/logger"));
const EmailQueueModel_1 = __importDefault(require("../models/EmailQueueModel"));
class EmailController {
    constructor() {
        this.sendNormal = this.sendNormal.bind(this);
    }
    async sendNormal(req, res, next) {
        const { emailDomain, emailList, fromName, uuid, subject, htmlContent, sender } = req.body;
        try {
            logger_1.default.info(`Iniciando envio de e-mails para UUID=${uuid}`);
            // Validação básica dos parâmetros
            const requiredParams = ['emailDomain', 'emailList', 'fromName', 'uuid', 'subject', 'htmlContent', 'sender'];
            const missingParams = requiredParams.filter(param => !(param in req.body));
            if (missingParams.length > 0) {
                throw new Error(`Parâmetros obrigatórios ausentes: ${missingParams.join(', ')}.`);
            }
            const emailService = EmailService_1.default.getInstance();
            // Cria ou atualiza o documento no banco de dados
            let emailQueue = await EmailQueueModel_1.default.findOne({ uuid });
            if (!emailQueue) {
                emailQueue = new EmailQueueModel_1.default({ uuid, queueIds: [] });
                logger_1.default.info(`Novo documento criado para UUID=${uuid}`);
            }
            else {
                logger_1.default.info(`Documento existente encontrado para UUID=${uuid}`);
            }
            // **1. Remover Duplicatas da `emailList` e garantir que todos os e-mails sejam processados:**
            const uniqueEmailList = [];
            const emailMap = new Map(); // Usar um Map para rastrear os e-mails únicos
            for (const emailData of emailList) {
                if (!emailMap.has(emailData.email)) {
                    emailMap.set(emailData.email, emailData); // Adiciona o emailData completo ao Map
                    uniqueEmailList.push(emailData);
                }
            }
            // **2. Usar um Map para Acompanhar os `queueIds`:**
            const queueIdMap = new Map(emailQueue.queueIds.map(item => [item.queueId, item]));
            for (const emailData of uniqueEmailList) {
                const { email, clientName } = emailData;
                const emailPayload = {
                    emailDomain,
                    fromName,
                    to: email,
                    subject,
                    html: htmlContent,
                    sender,
                };
                if (clientName) {
                    emailPayload.clientName = clientName;
                }
                const result = await emailService.sendEmail(emailPayload, uuid, emailQueue.queueIds);
                if (!queueIdMap.has(result.queueId)) {
                    const queueIdData = {
                        queueId: result.queueId,
                        email,
                        success: null,
                    };
                    emailQueue.queueIds.push(queueIdData);
                    queueIdMap.set(result.queueId, queueIdData);
                    logger_1.default.info(`E-mail enviado com sucesso:`, {
                        uuid,
                        queueId: result.queueId,
                        email,
                        subject,
                        clientName,
                    });
                }
                else {
                    logger_1.default.info(`O queueId ${result.queueId} já está presente para o UUID=${uuid}, não será duplicado.`);
                }
            }
            await this.saveEmailQueue(emailQueue, uuid);
            this.sendSuccessResponse(res, emailQueue);
        }
        catch (error) {
            this.handleError(res, error);
        }
    }
    // Método para salvar o EmailQueue no banco de dados
    async saveEmailQueue(emailQueue, uuid) {
        try {
            await emailQueue.save();
            console.log('Dados salvos com sucesso:', emailQueue); // Confirmação no console
            logger_1.default.info(`Dados salvos com sucesso para UUID=${uuid}`, { emailQueue });
        }
        catch (saveError) {
            console.error('Erro ao salvar os dados:', saveError); // Log de erro no console
            logger_1.default.error(`Erro ao salvar os dados para UUID=${uuid}:`, saveError);
            throw new Error('Erro ao salvar os dados no banco de dados.');
        }
    }
    // Método para enviar resposta de sucesso
    sendSuccessResponse(res, emailQueue) {
        res.json({
            success: true,
            uuid: emailQueue.uuid,
            queueIds: emailQueue.queueIds.map(q => ({
                queueId: q.queueId,
                email: q.email,
                success: q.success, // Pode ser null
            })),
        });
    }
    // Método para tratar erros
    handleError(res, error) {
        if (error instanceof Error) {
            logger_1.default.error(`Erro ao enviar e-mail:`, error);
            res.status(500).json({
                success: false,
                message: 'Erro ao enviar e-mail.',
                error: error.message,
            });
        }
        else {
            logger_1.default.error(`Erro desconhecido ao enviar e-mail:`, error);
            res.status(500).json({
                success: false,
                message: 'Erro desconhecido ao enviar e-mail.',
            });
        }
    }
}
exports.default = new EmailController();
