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
        this.DEFAULT_TIMEOUT_MS = 20000; // Increased to 20 seconds
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
        // Check for pending sends with this Message-ID
        if (this.pendingSends.has(logEntry.messageId)) {
            const sendData = this.pendingSends.get(logEntry.messageId);
            const success = logEntry.status.toLowerCase() === 'sent';
            // Update the result for the recipient
            sendData.results.push({
                recipient: logEntry.recipient,
                success,
            });
            logger_1.default.info(`Updated status for ${logEntry.recipient}: ${success ? 'Sent' : 'Failed'}`);
            // Check if all recipients have been processed
            if (sendData.results.length === sendData.recipients.length) {
                // Resolve the promise with the results
                sendData.resolve(sendData.results);
                // Remove the pending send
                this.pendingSends.delete(logEntry.messageId);
            }
        }
    }
    async sendEmail(params, timeoutMs) {
        const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
        const from = `"${fromName}" <no-reply@${emailDomain}>`;
        // Combine 'to' and 'bcc' into a complete list of recipients
        const recipients = Array.isArray(to) ? [...to, ...bcc] : [to, ...bcc];
        // Generate a unique Message-ID using UUID
        const messageId = `${uuid}@${emailDomain}`;
        logger_1.default.info(`Starting email send: MailID=${uuid}, Message-ID=${messageId}, Recipients=${recipients.join(', ')}`);
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
            // Prepare the promise to wait for recipient statuses
            const sendPromise = new Promise((resolve, reject) => {
                // Add to the pending sends map
                this.pendingSends.set(messageId, {
                    uuid,
                    recipients,
                    results: [],
                    resolve,
                    reject,
                });
                // Set a timeout to avoid indefinite waiting
                setTimeout(() => {
                    if (this.pendingSends.has(messageId)) {
                        const sendData = this.pendingSends.get(messageId);
                        sendData.reject(new Error('Timeout ao capturar status para todos os destinatários.'));
                        this.pendingSends.delete(messageId);
                        logger_1.default.warn(`Timeout reached for MailID=${uuid}, Message-ID=${messageId}.`);
                    }
                }, timeoutMs || this.DEFAULT_TIMEOUT_MS);
            });
            const results = await sendPromise;
            // Check if all sends were successful
            const allSuccess = results.every((r) => r.success);
            logger_1.default.info(`Email send result: MailID=${uuid}, Message-ID=${messageId}, Recipients=${JSON.stringify(results)}`);
            return {
                mailId: uuid,
                queueId: '', // Adjust as necessary
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
