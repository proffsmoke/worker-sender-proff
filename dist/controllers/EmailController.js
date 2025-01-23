"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const EmailService_1 = __importDefault(require("../services/EmailService"));
const logger_1 = __importDefault(require("../utils/logger"));
const uuid_1 = require("uuid");
const StateManager_1 = __importDefault(require("../services/StateManager"));
class EmailController {
    async sendNormal(req, res, next) {
        const { emailDomain, emailList, to, subject, html, fromName, clientName, uuid } = req.body;
        try {
            const emailService = EmailService_1.default.getInstance();
            const stateManager = new StateManager_1.default();
            const requestUuid = uuid || (0, uuid_1.v4)();
            if (emailList) {
                // Enviar a lista de e-mails usando sendEmail
                const results = await Promise.all(emailList.map(async (emailItem) => {
                    return emailService.sendEmail({
                        fromName: emailItem.name || fromName || 'No-Reply',
                        emailDomain,
                        to: emailItem.email,
                        bcc: [],
                        subject: emailItem.subject,
                        html: emailItem.template,
                        clientName: emailItem.clientName || clientName,
                    }, requestUuid);
                }));
                // Verifica se todos os emails da lista foram processados
                if (stateManager.isUuidProcessed(requestUuid)) {
                    const consolidatedResults = stateManager.consolidateResultsByUuid(requestUuid);
                    if (consolidatedResults) {
                        logger_1.default.info(`Resultados consolidados para uuid=${requestUuid}:`, consolidatedResults);
                        res.json({
                            success: true,
                            uuid: requestUuid,
                            results: consolidatedResults,
                        });
                    }
                    else {
                        res.json({
                            success: true,
                            uuid: requestUuid,
                            results,
                        });
                    }
                }
                else {
                    res.json({
                        success: true,
                        uuid: requestUuid,
                        results,
                    });
                }
            }
            else {
                if (!to || !subject || !html) {
                    throw new Error('Parâmetros "to", "subject" e "html" são obrigatórios para envio de email único.');
                }
                // Enviar um único e-mail
                const result = await emailService.sendEmail({
                    fromName,
                    emailDomain,
                    to,
                    bcc: [],
                    subject,
                    html,
                    clientName,
                }, requestUuid);
                // Verifica se o email foi processado
                if (stateManager.isUuidProcessed(requestUuid)) {
                    const consolidatedResults = stateManager.consolidateResultsByUuid(requestUuid);
                    if (consolidatedResults) {
                        logger_1.default.info(`Resultados consolidados para uuid=${requestUuid}:`, consolidatedResults);
                        res.json({
                            success: true,
                            uuid: requestUuid,
                            queueId: result.queueId,
                            mailId: result.mailId,
                            recipients: consolidatedResults,
                        });
                    }
                    else {
                        res.json({
                            success: true,
                            uuid: requestUuid,
                            queueId: result.queueId,
                            mailId: result.mailId,
                            recipients: result.recipients,
                        });
                    }
                }
                else {
                    res.json({
                        success: true,
                        uuid: requestUuid,
                        queueId: result.queueId,
                        mailId: result.mailId,
                        recipients: result.recipients,
                    });
                }
            }
        }
        catch (error) {
            if (error instanceof Error) {
                logger_1.default.error(`Erro ao enviar email normal:`, error);
                res.status(500).json({ success: false, message: 'Erro ao enviar email.', error: error.message });
            }
            else {
                logger_1.default.error(`Erro desconhecido ao enviar email normal:`, error);
                res.status(500).json({ success: false, message: 'Erro desconhecido ao enviar email.' });
            }
        }
    }
}
exports.default = new EmailController();
