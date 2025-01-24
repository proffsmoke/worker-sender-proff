"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const EmailService_1 = __importDefault(require("../services/EmailService"));
const logger_1 = __importDefault(require("../utils/logger"));
const StateManager_1 = __importDefault(require("../services/StateManager"));
class EmailController {
    async sendNormal(req, res, next) {
        const { mailerId, fromName, emailDomain, emailList, uuid } = req.body;
        try {
            // Validação básica dos parâmetros
            if (!mailerId || !fromName || !emailDomain || !uuid) {
                throw new Error('Parâmetros obrigatórios faltando: mailerId, fromName, emailDomain, uuid.');
            }
            if (!emailList || !Array.isArray(emailList) || emailList.length === 0) {
                throw new Error('A lista de e-mails (emailList) é obrigatória e deve conter pelo menos um e-mail.');
            }
            const emailService = EmailService_1.default.getInstance();
            const stateManager = new StateManager_1.default();
            // Enviar a lista de e-mails
            const results = await this.sendEmailList(emailService, stateManager, {
                mailerId,
                fromName,
                emailDomain,
                emailList,
                uuid,
            });
            // Verifica se todos os e-mails foram processados
            if (stateManager.isUuidProcessed(uuid)) {
                const consolidatedResults = await stateManager.consolidateResultsByUuid(uuid);
                if (consolidatedResults) {
                    logger_1.default.info(`Resultados consolidados para uuid=${uuid}:`, consolidatedResults);
                    this.sendSuccessResponse(res, uuid, mailerId, consolidatedResults);
                }
                else {
                    this.sendSuccessResponse(res, uuid, mailerId, results);
                }
            }
            else {
                this.sendSuccessResponse(res, uuid, mailerId, results);
            }
        }
        catch (error) {
            this.handleError(res, error);
        }
    }
    // Método para enviar a lista de e-mails
    async sendEmailList(emailService, stateManager, params) {
        const { mailerId, fromName, emailDomain, emailList, uuid } = params;
        return Promise.all(emailList.map(async (emailItem) => {
            try {
                const result = await emailService.sendEmail({
                    mailerId,
                    fromName,
                    emailDomain,
                    to: emailItem.email,
                    subject: emailItem.subject,
                    html: `<p>Template ID: ${emailItem.templateId}</p>`, // Substituir pelo conteúdo real do template
                    clientName: fromName, // Usar o fromName como clientName
                }, uuid);
                // Atualiza o status do queueId com o mailId (uuid)
                await stateManager.updateQueueIdStatus(result.queueId, true, uuid);
                return result;
            }
            catch (error) {
                logger_1.default.error(`Erro ao enviar e-mail para ${emailItem.email}:`, error);
                return {
                    recipient: emailItem.email,
                    success: false,
                    error: error instanceof Error ? error.message : 'Erro desconhecido',
                };
            }
        }));
    }
    // Método para enviar resposta de sucesso
    sendSuccessResponse(res, uuid, mailerId, results) {
        res.json({
            success: true,
            uuid,
            mailerId,
            results,
        });
    }
    // Método para tratar erros
    handleError(res, error) {
        if (error instanceof Error) {
            logger_1.default.error(`Erro ao enviar e-mails:`, error);
            res.status(500).json({
                success: false,
                message: 'Erro ao enviar e-mails.',
                error: error.message,
            });
        }
        else {
            logger_1.default.error(`Erro desconhecido ao enviar e-mails:`, error);
            res.status(500).json({
                success: false,
                message: 'Erro desconhecido ao enviar e-mails.',
            });
        }
    }
}
exports.default = new EmailController();
