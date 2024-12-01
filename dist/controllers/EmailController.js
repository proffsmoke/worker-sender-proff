"use strict";
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
        const { to, subject, html } = req.body;
        if (!to || !subject || !html) {
            res.status(400).json({ success: false, message: 'Dados inválidos.' });
            return;
        }
        try {
            const processedHtml = (0, antiSpam_1.default)(html);
            const results = await EmailService_1.default.sendEmail(to, [], subject, processedHtml);
            res.json({ success: true, results });
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email normal para ${to}: ${error.message}`, { subject, html, stack: error.stack });
            res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
        }
    }
    // Rota para envio em massa
    async sendBulk(req, res, next) {
        const { to, bcc, subject, html } = req.body;
        if (!to || !bcc || !Array.isArray(bcc) || bcc.length === 0 || !subject || !html) {
            res.status(400).json({ success: false, message: 'Dados inválidos.' });
            return;
        }
        try {
            const processedHtml = (0, antiSpam_1.default)(html);
            const results = await EmailService_1.default.sendEmail(to, bcc, subject, processedHtml);
            res.json({ success: true, results });
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email em massa para ${to} e BCC: ${error.message}`, { bcc, subject, html, stack: error.stack });
            res.status(500).json({ success: false, message: 'Erro ao enviar emails em massa.' });
        }
    }
}
exports.default = new EmailController();
