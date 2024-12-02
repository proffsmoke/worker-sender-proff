"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const logger_1 = __importDefault(require("../utils/logger"));
const log_parser_1 = __importDefault(require("../log-parser"));
class EmailService {
    constructor() {
        this.pendingSends = new Map();
        this.transporter = nodemailer_1.default.createTransport({
            host: '127.0.0.1',
            port: 25,
            secure: false,
            tls: { rejectUnauthorized: false },
        });
        this.logParser = new log_parser_1.default('/var/log/mail.log');
        this.logParser.startMonitoring();
        // Escutar os eventos de log
        this.logParser.on('log', this.handleLogEntry.bind(this));
    }
    handleLogEntry(logEntry) {
        // Verificar se há algum envio pendente com este Message-ID
        for (const [messageId, sendData] of this.pendingSends.entries()) {
            if (logEntry.messageId === messageId) {
                const success = logEntry.status.toLowerCase() === 'sent';
                // Atualizar o resultado para o destinatário
                sendData.results.push({
                    recipient: logEntry.recipient,
                    success,
                });
                logger_1.default.info(`Atualizado status para ${logEntry.recipient}: ${success ? 'Enviado' : 'Falha'}`);
                // Verificar se todos os destinatários foram processados
                if (sendData.results.length === sendData.recipients.length) {
                    // Resolver a promessa com os resultados
                    sendData.resolve(sendData.results);
                    // Remover o envio pendente
                    this.pendingSends.delete(messageId);
                }
            }
        }
    }
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
        const from = `"${fromName}" <no-reply@${emailDomain}>`;
        // Combinar 'to' e 'bcc' em uma lista completa de destinatários
        const recipients = Array.isArray(to) ? [...to, ...bcc] : [to, ...bcc];
        // Gerar um Message-ID único usando o UUID
        const messageId = `${uuid}@${emailDomain}`;
        try {
            const mailOptions = {
                from,
                to: Array.isArray(to) ? to.join(', ') : to,
                bcc,
                subject,
                html,
                headers: {
                    'Message-ID': `<${messageId}>`,
                },
            };
            const info = await this.transporter.sendMail(mailOptions);
            logger_1.default.info(`Email enviado: ${JSON.stringify(mailOptions)}`);
            logger_1.default.debug(`Resposta do servidor SMTP: ${info.response}`);
            // Preparar a promessa para aguardar os resultados dos destinatários
            const sendPromise = new Promise((resolve, reject) => {
                // Adicionar ao mapa de envios pendentes
                this.pendingSends.set(messageId, {
                    uuid,
                    recipients,
                    results: [],
                    resolve,
                    reject,
                });
                // Definir um timeout para evitar espera indefinida
                setTimeout(() => {
                    if (this.pendingSends.has(messageId)) {
                        const sendData = this.pendingSends.get(messageId);
                        sendData.reject(new Error('Timeout ao capturar status para todos os destinatários.'));
                        this.pendingSends.delete(messageId);
                    }
                }, 10000); // 10 segundos
            });
            const results = await sendPromise;
            // Verificar se todos os envios foram bem-sucedidos
            const allSuccess = results.every((r) => r.success);
            logger_1.default.info(`Resultado do envio: MailID: ${uuid}, Message-ID: ${messageId}, Destinatários: ${JSON.stringify(results)}`);
            return {
                mailId: uuid,
                queueId: '', // Pode ser omitido ou ajustado conforme necessário
                recipients: results,
            };
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar e-mail: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
            throw error;
        }
    }
}
exports.default = new EmailService();
