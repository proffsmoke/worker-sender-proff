"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
const log_parser_1 = __importDefault(require("../log-parser"));
const node_fetch_1 = __importDefault(require("node-fetch"));
class EmailService {
    constructor() {
        this.transporter = nodemailer_1.default.createTransport({
            sendmail: true,
            path: '/usr/sbin/sendmail',
        });
    }
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc, subject, html, uuid } = params;
        const fromEmail = `"${fromName}" <no-reply@${emailDomain}>`;
        try {
            const mailOptions = {
                from: fromEmail,
                to,
                bcc,
                subject,
                html,
                headers: { 'X-Mailer-ID': uuid },
            };
            await this.transporter.sendMail(mailOptions);
            logger_1.default.info(`Email enviado para ${to}`);
            this.processLog(uuid, to, bcc);
            return 'queued';
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar email para ${to}:`, error);
            return 'queued';
        }
    }
    async processLog(uuid, to, bcc) {
        try {
            const logs = await log_parser_1.default.getResultByUUID(uuid, 50);
            if (logs) {
                const payload = logs.map(log => ({
                    email: log.email,
                    success: log.success,
                    message: log.message,
                    detail: log.detail,
                }));
                const response = await (0, node_fetch_1.default)(`${config_1.default.server.logResultEndpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uuid, logs: payload }),
                });
                if (!response.ok) {
                    logger_1.default.error(`Erro ao enviar logs para o servidor principal para UUID: ${uuid}`);
                }
                else {
                    logger_1.default.info(`Logs enviados com sucesso para o servidor principal para UUID: ${uuid}`);
                }
            }
            else {
                logger_1.default.warn(`Nenhum log encontrado para UUID: ${uuid}`);
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao processar logs para UUID: ${uuid}:`, error);
        }
    }
}
exports.default = new EmailService();
