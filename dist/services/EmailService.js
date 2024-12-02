"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
const log_parser_1 = __importDefault(require("../log-parser"));
let fetch;
(async () => {
    const nodeFetch = await Promise.resolve().then(() => __importStar(require('node-fetch')));
    fetch = nodeFetch.default;
})();
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
                const response = await fetch(`${config_1.default.server.logResultEndpoint}`, {
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
