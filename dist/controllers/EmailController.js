"use strict";
// src/controllers/EmailController.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const EmailService_1 = __importDefault(require("../services/EmailService"));
const logger_1 = __importDefault(require("../utils/logger"));
const uuid_1 = require("uuid"); // Import necessário para gerar UUIDs únicos
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
            const processedHtml = html; //antiSpam(html);
            const result = await EmailService_1.default.sendEmail({
                fromName,
                emailDomain,
                to,
                bcc: [],
                subject,
                html: processedHtml,
                uuid,
            });
            // Determina o sucesso geral baseado nos destinatários
            const overallSuccess = result.recipients.some((r) => r.success);
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
    // Envio em massa modificado para enviar um email por BCC
    async sendBulk(req, res, next) {
        const { fromName, emailDomain, to, bcc, subject, html } = req.body;
        // Validação dos dados de entrada
        if (!fromName ||
            !emailDomain ||
            !to ||
            !bcc ||
            !Array.isArray(bcc) ||
            bcc.length === 0 ||
            !subject ||
            !html) {
            res.status(400).json({
                success: false,
                message: 'Dados inválidos. "fromName", "emailDomain", "to", "bcc", "subject" e "html" são obrigatórios.',
            });
            return;
        }
        try {
            const processedHtml = html; //antiSpam(html);
            // Preparar um array de promessas para cada envio individual
            const sendPromises = bcc.map(async (bccEmail) => {
                const uuid = (0, uuid_1.v4)(); // Gerar um UUID único para cada email
                const result = await EmailService_1.default.sendEmail({
                    fromName,
                    emailDomain,
                    to,
                    bcc: [bccEmail], // Enviar um email por BCC
                    subject,
                    html: processedHtml,
                    uuid,
                });
                return result;
            });
            // Executar todas as promessas de envio em paralelo
            const results = await Promise.all(sendPromises);
            // Determinar o sucesso geral baseado nos resultados individuais
            const overallSuccess = results.some((result) => result.recipients.some((r) => r.success));
            res.json({
                success: overallSuccess,
                status: results,
            });
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar emails em massa:`, error);
            res.status(500).json({ success: false, message: 'Erro ao enviar emails em massa.' });
        }
    }
}
exports.default = new EmailController();
