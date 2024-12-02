"use strict";
// src/controllers/EmailController.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const EmailService_1 = __importDefault(require("../services/EmailService"));
const logger_1 = __importDefault(require("../utils/logger"));
const antiSpam_1 = __importDefault(require("../utils/antiSpam"));
class EmailController {
    // Rota para envio normal
    async sendNormal(req, res, next) {
        const { fromName, emailDomain, to, subject, html } = req.body;
        // Validação dos parâmetros obrigatórios
        if (!fromName || !emailDomain || !to || !subject || !html) {
            res.status(400).json({ success: false, message: 'Dados inválidos. "fromName", "emailDomain", "to", "subject" e "html" são obrigatórios.' });
            return;
        }
        try {
            const processedHtml = (0, antiSpam_1.default)(html);
            const result = await EmailService_1.default.sendEmail({
                fromName,
                emailDomain,
                to,
                bcc: [],
                subject,
                html: processedHtml,
            });
            console.log('Resultado de envio normal:', result);
            res.json({ success: true, status: 'queued' }); // Retorna "queued" imediatamente
        }
        catch (error) {
            if (error instanceof Error) {
                logger_1.default.error(`Erro ao enviar email normal para ${to}: ${error.message}`, { subject, html, stack: error.stack });
            }
            res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
        }
    }
    // Rota para envio em massa
    async sendBulk(req, res, next) {
        const { fromName, emailDomain, to, bcc, subject, html } = req.body;
        // Validação dos parâmetros obrigatórios
        if (!fromName || !emailDomain || !to || !bcc || !Array.isArray(bcc) || bcc.length === 0 || !subject || !html) {
            res.status(400).json({ success: false, message: 'Dados inválidos. "fromName", "emailDomain", "to", "bcc", "subject" e "html" são obrigatórios.' });
            return;
        }
        try {
            const processedHtml = (0, antiSpam_1.default)(html);
            const result = await EmailService_1.default.sendEmail({
                fromName,
                emailDomain,
                to,
                bcc,
                subject,
                html: processedHtml,
            });
            console.log('Resultado de envio em massa:', result);
            res.json({ success: true, status: 'queued' }); // Retorna "queued" imediatamente
        }
        catch (error) {
            if (error instanceof Error) {
                logger_1.default.error(`Erro ao enviar email em massa para ${to} e BCC: ${error.message}`, { bcc, subject, html, stack: error.stack });
            }
            res.status(500).json({ success: false, message: 'Erro ao enviar emails em massa.' });
        }
    }
}
exports.default = new EmailController();
