"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const EmailService_1 = __importDefault(require("../services/EmailService"));
const logger_1 = __importDefault(require("../utils/logger"));
const uuid_1 = require("uuid");
class EmailController {
    async sendNormal(req, res, next) {
        const { emailDomain, emailList, to, subject, html, fromName, clientName, uuid } = req.body;
        try {
            const emailService = EmailService_1.default.getInstance();
            const requestUuid = uuid || (0, uuid_1.v4)();
            if (emailList) {
                const results = await emailService.sendEmailList({
                    emailDomain,
                    emailList,
                }, requestUuid);
                res.json({
                    success: true,
                    uuid: requestUuid,
                    results,
                });
            }
            else {
                if (!to || !subject || !html) {
                    throw new Error('Parâmetros "to", "subject" e "html" são obrigatórios para envio de email único.');
                }
                const result = await emailService.sendEmail({
                    fromName,
                    emailDomain,
                    to,
                    bcc: [],
                    subject,
                    html,
                    clientName,
                }, requestUuid);
                res.json({
                    success: true,
                    uuid: requestUuid,
                    queueId: result.queueId,
                    mailId: result.mailId,
                    recipients: result.recipients,
                });
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
