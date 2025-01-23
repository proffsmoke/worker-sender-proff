"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const EmailService_1 = __importDefault(require("../services/EmailService")); // Certifique-se de importar corretamente o EmailService
const logger_1 = __importDefault(require("../utils/logger"));
const log_parser_1 = __importDefault(require("../log-parser"));
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
            // Instanciando EmailService com o logParser (caso necessário)
            const logParser = new log_parser_1.default('/var/log/mail.log'); // Crie ou reutilize o LogParser que você já tem
            const emailService = new EmailService_1.default(logParser); // Instanciando a classe com o logParser
            // Agora chamamos o método sendEmail na instância de EmailService
            const result = await emailService.sendEmail({
                fromName,
                emailDomain,
                to,
                bcc: [],
                subject,
                html,
            });
            // Retorna o queueId imediatamente
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
