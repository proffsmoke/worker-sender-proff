"use strict";
// src/services/EmailService.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const EmailLog_1 = __importDefault(require("../models/EmailLog"));
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
const BlockService_1 = __importDefault(require("./BlockService"));
const MailerService_1 = __importDefault(require("./MailerService"));
const uuid_1 = require("uuid");
const log_parser_1 = __importDefault(require("../log-parser"));
// Função auxiliar para selecionar um elemento aleatório de um array
function randomOne(array) {
    return array[Math.floor(Math.random() * array.length)];
}
class EmailService {
    constructor() {
        this.transporter = nodemailer_1.default.createTransport({
            sendmail: true,
            path: '/usr/sbin/sendmail', // Caminho padrão do sendmail no Ubuntu
        });
        // Removido transporter.verify() conforme solicitado
    }
    /**
     * Envia emails individuais ou em massa.
     * @param params Objeto contendo os parâmetros do email.
     * @returns String indicando que o email está na fila.
     */
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc, subject, html } = params;
        const mailId = (0, uuid_1.v4)();
        // Lista de prefixos para o email de remetente
        const prefixes = ['contato', 'naoresponder', 'noreply', 'notifica', 'notificacoes'];
        // Construir o email de remetente dinamicamente
        const fromEmail = `"${fromName}" <${randomOne(prefixes)}@${emailDomain}>`;
        if (MailerService_1.default.isMailerBlocked()) {
            const message = 'Mailer está bloqueado. Não é possível enviar emails no momento.';
            logger_1.default.warn(`Tentativa de envio bloqueada para ${to}: ${message}`, { to, subject });
            console.log(`Email bloqueado para ${to}`, { subject, html, message });
            // Log para envio individual bloqueado
            await EmailLog_1.default.create({
                mailId,
                email: to,
                message,
                success: false,
                detail: {},
                sentAt: new Date(),
            });
            // Log para cada recipient no BCC bloqueado
            for (const recipient of bcc) {
                await EmailLog_1.default.create({
                    mailId,
                    email: recipient,
                    message,
                    success: false,
                    detail: {},
                    sentAt: new Date(),
                });
                console.log(`Email bloqueado para ${recipient}`, { subject, html, message });
            }
            return 'queued'; // Retorna imediatamente "queued"
        }
        try {
            const mailOptions = {
                from: fromEmail,
                to,
                bcc,
                subject,
                html, // Já processado pelo antiSpam antes de chamar sendEmail
                headers: { 'X-Mailer-ID': mailId },
            };
            await this.transporter.sendMail(mailOptions);
            console.log(`Email enviado para ${to}`, { subject, html, response: 'Messages queued for delivery' });
            // Log para envio individual
            await EmailLog_1.default.create({
                mailId,
                email: to,
                message: 'Messages queued for delivery',
                success: true,
                detail: {},
                sentAt: new Date(),
            });
            // Log para cada recipient no BCC
            for (const recipient of bcc) {
                await EmailLog_1.default.create({
                    mailId,
                    email: recipient,
                    message: 'Messages queued for delivery',
                    success: true,
                    detail: {},
                    sentAt: new Date(),
                });
                console.log(`Email enviado para ${recipient}`, { subject, html, response: 'Messages queued for delivery' });
            }
            logger_1.default.info(`Email enviado para ${to}`, { subject, html, response: 'Messages queued for delivery' });
            // **Processamento Assíncrono dos Logs**
            this.processLog(mailId, to, bcc);
            return 'queued'; // Retorna imediatamente "queued"
        }
        catch (error) {
            if (error instanceof Error) {
                // Log para envio individual falho
                await EmailLog_1.default.create({
                    mailId,
                    email: to,
                    message: error.message,
                    success: false,
                    detail: {},
                    sentAt: new Date(),
                });
                console.log(`Erro ao enviar email para ${to}`, { subject, html, message: error.message });
                // Log para cada recipient no BCC falho
                for (const recipient of bcc) {
                    await EmailLog_1.default.create({
                        mailId,
                        email: recipient,
                        message: error.message,
                        success: false,
                        detail: {},
                        sentAt: new Date(),
                    });
                    console.log(`Erro ao enviar email para ${recipient}`, { subject, html, message: error.message });
                }
                logger_1.default.error(`Erro ao enviar email para ${to}: ${error.message}`, { subject, html, stack: error.stack });
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
            else {
                // Caso o erro não seja uma instância de Error
                logger_1.default.error(`Erro desconhecido ao enviar email para ${to}`, { subject, html, error });
                console.log(`Erro desconhecido ao enviar email para ${to}`, { subject, html, error });
            }
            return 'queued'; // Mesmo em caso de erro, retorna "queued"
        }
    }
    /**
     * Processa os logs após o envio do email.
     * @param mailId O ID único do email enviado.
     * @param to O destinatário principal.
     * @param bcc Lista de destinatários em BCC.
     */
    async processLog(mailId, to, bcc) {
        try {
            // Aguarda até que os logs sejam processados
            const logs = await log_parser_1.default.getResult(mailId, 50); // Timeout de 50 segundos
            if (logs) {
                logs.forEach(log => {
                    const { email, success, message, detail } = log;
                    // Atualiza o status no console
                    console.log(`Resultado final para ${email}: Sucesso = ${success}, Mensagem = "${message}"`, detail ? { detail } : {});
                });
            }
            else {
                logger_1.default.warn(`Nenhum log encontrado para mailId: ${mailId} dentro do timeout.`);
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao processar logs para mailId: ${mailId}:`, error);
        }
    }
    async sendTestEmail() {
        const testEmail = {
            from: 'no-reply@yourdomain.com', // Atualize para seu domínio
            to: config_1.default.mailer.noreplyEmail,
            subject: 'Mailer Test',
            text: `Testing mailer.`,
        };
        try {
            const info = await this.transporter.sendMail(testEmail);
            console.log(`Email de teste enviado para ${config_1.default.mailer.noreplyEmail}`, { subject: testEmail.subject, html: testEmail.text, response: "Messages queued for delivery" });
            logger_1.default.info(`Email de teste enviado para ${config_1.default.mailer.noreplyEmail}`);
            return true;
        }
        catch (error) {
            if (error instanceof Error) {
                console.log(`Erro ao enviar email de teste`, { message: error.message });
                logger_1.default.error(`Erro ao enviar email de teste: ${error.message}`, { stack: error.stack });
            }
            else {
                console.log(`Erro ao enviar email de teste`, { message: 'Erro desconhecido' });
                logger_1.default.error(`Erro ao enviar email de teste: Erro desconhecido`, { error });
            }
            return false;
        }
    }
}
exports.default = new EmailService();
