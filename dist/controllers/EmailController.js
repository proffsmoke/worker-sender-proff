"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const EmailService_1 = __importDefault(require("../services/EmailService"));
const logger_1 = __importDefault(require("../utils/logger"));
const antiSpam_1 = __importDefault(require("../utils/antiSpam"));
class EmailController {
    // Envio normal
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
            const processedHtml = (0, antiSpam_1.default)(html);
            const result = await EmailService_1.default.sendEmail({
                fromName,
                emailDomain,
                to,
                bcc: [],
                subject,
                html: processedHtml,
                uuid,
            });
            res.json({ success: true, status: result });
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email normal:`, error);
            res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
        }
    }
    // Envio em massa
    async sendBulk(req, res, next) {
        const { fromName, emailDomain, to, bcc, subject, html, uuid } = req.body;
        if (!fromName ||
            !emailDomain ||
            !to ||
            !bcc ||
            !Array.isArray(bcc) ||
            bcc.length === 0 ||
            !subject ||
            !html ||
            !uuid) {
            res.status(400).json({
                success: false,
                message: 'Dados inválidos. "fromName", "emailDomain", "to", "bcc", "subject", "html" e "uuid" são obrigatórios.',
            });
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
                uuid,
            });
            res.json({ success: true, status: result });
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar emails em massa:`, error);
            res.status(500).json({ success: false, message: 'Erro ao enviar emails em massa.' });
        }
    }
}
exports.default = new EmailController();
