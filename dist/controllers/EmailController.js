"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const EmailService_1 = __importDefault(require("../services/EmailService")); // Importe o EmailService
const logger_1 = __importDefault(require("../utils/logger"));
class EmailController {
    async sendNormal(req, res, next) {
        const { fromName, emailDomain, to, subject, html } = req.body;
        if (!fromName || !emailDomain || !to || !subject || !html) {
            res.status(400).json({
                success: false,
                message: 'Dados inválidos. "fromName", "emailDomain", "to", "subject" e "html" são obrigatórios.',
            });
            return;
        }
        try {
            // Usa o Singleton do EmailService
            const emailService = EmailService_1.default.getInstance(); // Corrigido aqui
            const result = await emailService.sendEmail({
                fromName,
                emailDomain,
                to,
                bcc: [],
                subject,
                html,
            });
            res.json({
                success: true,
                queueId: result.queueId,
            });
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email normal:`, error);
            res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
        }
    }
}
exports.default = new EmailController();
