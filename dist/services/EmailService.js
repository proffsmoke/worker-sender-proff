"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/services/EmailService.ts
const nodemailer_1 = __importDefault(require("nodemailer"));
const Log_1 = __importDefault(require("../models/Log"));
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
const BlockService_1 = __importDefault(require("./BlockService"));
const MailerService_1 = __importDefault(require("./MailerService"));
const uuid_1 = require("uuid");
class EmailService {
    constructor() {
        this.transporter = nodemailer_1.default.createTransport({
            host: '0.0.0.0',
            port: 25,
            secure: false,
            auth: {
                user: config_1.default.auth.login,
                pass: config_1.default.auth.password,
            },
        });
        this.transporter.verify()
            .then(() => {
            logger_1.default.info('Transportador SMTP está pronto para enviar emails.');
        })
            .catch((error) => {
            logger_1.default.error('Erro ao verificar transportador SMTP:', { error });
        });
    }
    async sendEmail(to, bcc, subject, html) {
        const results = [];
        const mailId = (0, uuid_1.v4)(); // Gerar um mailId internamente para logs
        if (MailerService_1.default.isMailerBlocked()) {
            const message = 'Mailer está bloqueado. Não é possível enviar emails no momento.';
            logger_1.default.warn(`Tentativa de envio bloqueada para ${to}: ${message}`, { to, subject });
            // Log de falha para destinatário principal
            await Log_1.default.create({
                to,
                bcc,
                success: false,
                message,
            });
            results.push({ to, success: false, message });
            // Log de falha para cada BCC
            for (const recipient of bcc) {
                await Log_1.default.create({
                    to: recipient,
                    bcc,
                    success: false,
                    message,
                });
                results.push({ to: recipient, success: false, message });
            }
            return results;
        }
        try {
            const mailOptions = {
                from: 'no-reply@yourdomain.com',
                to,
                bcc,
                subject,
                html,
                headers: { 'X-Mailer-ID': mailId },
            };
            const info = await this.transporter.sendMail(mailOptions);
            // Log de sucesso para destinatário principal
            await Log_1.default.create({
                to,
                bcc,
                success: true,
                message: info.response,
            });
            results.push({ to, success: true, message: info.response });
            // Log de sucesso para cada BCC
            for (const recipient of bcc) {
                await Log_1.default.create({
                    to: recipient,
                    bcc,
                    success: true,
                    message: info.response,
                });
                results.push({ to: recipient, success: true, message: info.response });
            }
            logger_1.default.info(`Email enviado para ${to}`, { subject, html, response: info.response });
        }
        catch (error) {
            // Log de falha para destinatário principal
            await Log_1.default.create({
                to,
                bcc,
                success: false,
                message: error.message,
            });
            results.push({ to, success: false, message: error.message });
            // Log de falha para cada BCC
            for (const recipient of bcc) {
                await Log_1.default.create({
                    to: recipient,
                    bcc,
                    success: false,
                    message: error.message,
                });
                results.push({ to: recipient, success: false, message: error.message });
            }
            logger_1.default.error(`Erro ao enviar email para ${to}: ${error.message}`, { subject, html, stack: error.stack });
            // Gerenciamento de status do mailer baseado no erro
            const isPermanent = BlockService_1.default.isPermanentError(error.message);
            const isTemporary = BlockService_1.default.isTemporaryError(error.message);
            if (isPermanent && !MailerService_1.default.isMailerPermanentlyBlocked()) {
                MailerService_1.default.blockMailer('blocked_permanently');
                logger_1.default.warn(`Mailer bloqueado permanentemente devido ao erro: ${error.message}`);
            }
            else if (isTemporary && !MailerService_1.default.isMailerBlocked()) {
                MailerService_1.default.blockMailer('blocked_temporary');
                logger_1.default.warn(`Mailer bloqueado temporariamente devido ao erro: ${error.message}`);
            }
        }
        return results;
    }
    async sendTestEmail() {
        const testEmail = {
            from: 'no-reply@yourdomain.com',
            to: config_1.default.mailer.noreplyEmail,
            subject: 'Mailer Test',
            text: `Testing mailer.`,
        };
        try {
            await this.transporter.sendMail(testEmail);
            logger_1.default.info(`Email de teste enviado para ${config_1.default.mailer.noreplyEmail}`);
            return true;
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email de teste: ${error.message}`, { stack: error.stack });
            return false;
        }
    }
}
exports.default = new EmailService();
