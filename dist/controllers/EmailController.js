"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const EmailService_1 = __importDefault(require("../services/EmailService"));
const logger_1 = __importDefault(require("../utils/logger"));
class EmailController {
    // Envio normal permanece inalterado
    async sendNormal(req, res, next) {
        const { fromName, emailDomain, to, subject, html, uuid } = req.body;
        if (!fromName || !emailDomain || !to || !subject || !html || !uuid) {
            res.status(400).json({
                success: false,
                message: 'Dados inválidos. "fromName", "emailDomain", "to", "subject", "html" e "uuid" são obrigatórios.',
            });
            return;
        }
        try {
            const processedHtml = html; // antiSpam(html);
            const result = await EmailService_1.default.sendEmail({
                fromName,
                emailDomain,
                to,
                bcc: [],
                subject,
                html: processedHtml,
                uuid,
            });
            // Aguarda os logs de envio e retorna quando todos os destinatários tiverem sido processados
            await EmailService_1.default.awaitEmailResults(result.queueId);
            // Determina o sucesso geral baseado nos destinatários
            const overallSuccess = result.recipients.every((r) => r.success);
            res.json({
                success: overallSuccess,
                status: result,
            });
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email normal:`, error);
            res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
        }
    }
}
exports.default = new EmailController();
