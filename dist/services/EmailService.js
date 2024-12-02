"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// EmailService.js
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
        // Listen to log events
        this.logParser.on('log', this.handleLogEntry.bind(this));
    }
    handleLogEntry(logEntry) {
        for (const [messageId, sendData] of this.pendingSends.entries()) {
            if (logEntry.messageId === messageId) {
                const success = logEntry.dsn.startsWith('2');
                sendData.results.push({
                    recipient: logEntry.recipient,
                    success,
                });
                logger_1.default.info(`Updated status for ${logEntry.recipient}: ${success ? 'Sent' : 'Failed'}`);
                if (sendData.results.length === sendData.recipients.length) {
                    sendData.resolve(sendData.results);
                    this.pendingSends.delete(messageId);
                }
            }
        }
    }
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
        const from = `"${fromName}" <no-reply@${emailDomain}>`;
        const recipients = Array.isArray(to) ? [...to, ...bcc] : [to, ...bcc];
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
            logger_1.default.info(`Email sent: ${JSON.stringify(mailOptions)}`);
            logger_1.default.debug(`SMTP server response: ${info.response}`);
            const sendPromise = new Promise((resolve, reject) => {
                this.pendingSends.set(messageId, {
                    uuid,
                    recipients,
                    results: [],
                    resolve,
                    reject,
                });
                setTimeout(() => {
                    if (this.pendingSends.has(messageId)) {
                        const sendData = this.pendingSends.get(messageId);
                        sendData.reject(new Error('Timeout ao capturar status para todos os destinatários.'));
                        this.pendingSends.delete(messageId);
                    }
                }, 20000); // 20 seconds
            });
            const results = await sendPromise;
            const allSuccess = results.every((r) => r.success);
            logger_1.default.info(`Send results: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`);
            return {
                mailId: uuid,
                queueId: '', // Adjust as needed
                recipients: results,
            };
        }
        catch (error) {
            logger_1.default.error(`Error sending email: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
            throw error;
        }
    }
}
exports.default = new EmailService();
