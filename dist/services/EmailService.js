"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const EmailLog_1 = __importDefault(require("../models/EmailLog"));
const logger_1 = __importDefault(require("../utils/logger"));
const log_parser_1 = __importDefault(require("../log-parser"));
const config_1 = __importDefault(require("../config"));
class EmailService {
    constructor() {
        this.pendingSends = new Map();
        this.transporter = nodemailer_1.default.createTransport({
            host: config_1.default.smtp.host, // Utilize a configuração de SMTP
            port: config_1.default.smtp.port,
            secure: false,
            tls: { rejectUnauthorized: false },
        });
        this.logParser = new log_parser_1.default('/var/log/mail.log');
        this.logParser.startMonitoring();
        // Listen to log events
        this.logParser.on('log', this.handleLogEntry.bind(this));
    }
    async handleLogEntry(logEntry) {
        logger_1.default.debug(`Processing Log Entry: ${JSON.stringify(logEntry)}`);
        // Remover os < e > do messageId
        const cleanMessageId = logEntry.messageId.replace(/[<>]/g, '');
        const sendData = this.pendingSends.get(cleanMessageId);
        if (!sendData) {
            logger_1.default.warn(`No pending send found for Message-ID: ${cleanMessageId}`);
            return;
        }
        const success = logEntry.dsn.startsWith('2');
        // Normalizar o endereço de email para minúsculas
        const recipient = logEntry.recipient.toLowerCase();
        const isToRecipient = sendData.toRecipients.includes(recipient);
        logger_1.default.debug(`Is to recipient: ${isToRecipient} for recipient: ${recipient}`);
        if (isToRecipient) {
            // Atualizar o campo 'success' do EmailLog
            try {
                const emailLog = await EmailLog_1.default.findOne({ mailId: sendData.uuid }).exec();
                if (emailLog) {
                    emailLog.success = success; // Refletir o sucesso do 'to' recipient
                    await emailLog.save();
                    logger_1.default.debug(`EmailLog 'success' atualizado para mailId=${sendData.uuid}`);
                }
                else {
                    logger_1.default.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
                }
            }
            catch (err) {
                logger_1.default.error(`Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${err.message}`);
            }
            // Adicionar o destinatário 'to' ao array de resultados
            sendData.results.push({
                recipient: recipient,
                success: success
            });
        }
        else {
            // Atualizar o 'detail' do EmailLog
            sendData.results.push({
                recipient: recipient,
                success,
            });
            try {
                const emailLog = await EmailLog_1.default.findOne({ mailId: sendData.uuid }).exec();
                if (emailLog) {
                    // Atualizar o status com base no destinatário em 'bcc'
                    const recipientStatus = {
                        recipient: recipient,
                        success,
                        dsn: logEntry.dsn,
                        status: logEntry.status,
                    };
                    emailLog.detail = {
                        ...emailLog.detail,
                        [recipient]: recipientStatus,
                    };
                    await emailLog.save();
                    logger_1.default.debug(`EmailLog 'detail' atualizado para mailId=${sendData.uuid}`);
                }
                else {
                    logger_1.default.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
                }
            }
            catch (err) {
                logger_1.default.error(`Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${err.message}`);
            }
        }
        // Verificar se todos os destinatários foram processados
        const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
        const processedRecipients = sendData.results.length;
        logger_1.default.debug(`Total Recipients: ${totalRecipients}, Processed Recipients: ${processedRecipients}`);
        if (processedRecipients >= totalRecipients) {
            sendData.resolve(sendData.results);
            this.pendingSends.delete(cleanMessageId);
            logger_1.default.debug(`All recipients processed for mailId=${sendData.uuid}`);
        }
    }
    async sendEmail(params) {
        const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
        const from = `"${fromName}" <no-reply@${emailDomain}>`;
        // Normalizar os endereços de email para minúsculas
        const toRecipients = Array.isArray(to) ? to.map(r => r.toLowerCase()) : [to.toLowerCase()];
        const bccRecipients = bcc.map(r => r.toLowerCase());
        const allRecipients = [...toRecipients, ...bccRecipients];
        const messageId = `${uuid}@${emailDomain}`;
        logger_1.default.debug(`Setting Message-ID: <${messageId}> for mailId=${uuid}`);
        try {
            const mailOptions = {
                from,
                to: Array.isArray(to) ? to.join(', ') : to,
                bcc,
                subject,
                html,
                messageId: `<${messageId}>`, // Use a propriedade 'messageId' diretamente
            };
            const info = await this.transporter.sendMail(mailOptions);
            logger_1.default.info(`Email sent: ${JSON.stringify(mailOptions)}`);
            logger_1.default.debug(`SMTP server response: ${info.response}`);
            // Criar um registro inicial no EmailLog com sucesso = null
            const emailLog = new EmailLog_1.default({
                mailId: uuid,
                sendmailQueueId: '', // Pode ser ajustado se necessário
                email: Array.isArray(to) ? to.join(', ') : to,
                message: subject,
                success: null,
                sentAt: new Date(),
            });
            await emailLog.save();
            logger_1.default.debug(`EmailLog criado para mailId=${uuid}`);
            // Rastrear destinatários 'to' e 'bcc' separadamente
            const sendPromise = new Promise((resolve, reject) => {
                this.pendingSends.set(messageId, {
                    uuid,
                    toRecipients,
                    bccRecipients,
                    results: [],
                    resolve,
                    reject,
                });
                setTimeout(() => {
                    if (this.pendingSends.has(messageId)) {
                        const sendData = this.pendingSends.get(messageId);
                        sendData.reject(new Error('Timeout ao capturar status para todos os destinatários.'));
                        this.pendingSends.delete(messageId);
                        logger_1.default.warn(`Timeout: Failed to capture status for mailId=${uuid}`);
                    }
                }, 60000); // 60 segundos
            });
            const results = await sendPromise;
            // Atualizar o EmailLog com o sucesso geral
            const emailLogUpdate = await EmailLog_1.default.findOne({ mailId: uuid }).exec();
            if (emailLogUpdate) {
                // Verificar se todos os 'bcc' foram bem-sucedidos
                const allBccSuccess = results.every(r => r.success);
                emailLogUpdate.success = allBccSuccess;
                await emailLogUpdate.save();
                logger_1.default.debug(`EmailLog 'success' atualizado para mailId=${uuid} com valor ${allBccSuccess}`);
            }
            logger_1.default.info(`Send results: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`);
            return {
                mailId: uuid,
                queueId: '', // Ajustar conforme necessário
                recipients: results,
            };
        }
        catch (error) {
            logger_1.default.error(`Error sending email: ${error.message}`, error);
            let recipientsStatus = [];
            // Verifica se o erro contém informações sobre destinatários rejeitados
            if (error.rejected && Array.isArray(error.rejected)) {
                const rejectedSet = new Set(error.rejected.map((r) => r.toLowerCase()));
                const acceptedSet = new Set((error.accepted || []).map((r) => r.toLowerCase()));
                recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
                    recipient,
                    success: acceptedSet.has(recipient),
                    error: rejectedSet.has(recipient)
                        ? 'Rejeitado pelo servidor SMTP.'
                        : undefined,
                }));
            }
            else {
                // Se não houver informações específicas, marca todos como falhados
                recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
                    recipient,
                    success: false,
                    error: 'Falha desconhecida ao enviar email.',
                }));
            }
            // Registrar o erro no EmailLog
            try {
                const emailLog = await EmailLog_1.default.findOne({ mailId: uuid }).exec();
                if (emailLog) {
                    // Atualizar o status com base nos destinatários
                    const successAny = recipientsStatus.some((r) => r.success);
                    emailLog.success = successAny;
                    recipientsStatus.forEach((r) => {
                        emailLog.detail[r.recipient] = {
                            recipient: r.recipient,
                            success: r.success,
                            error: r.error,
                            dsn: '',
                            status: r.success ? 'sent' : 'failed',
                        };
                    });
                    await emailLog.save();
                    logger_1.default.debug(`EmailLog atualizado com erro para mailId=${uuid}`);
                }
                else {
                    logger_1.default.warn(`EmailLog não encontrado para mailId=${uuid}`);
                }
            }
            catch (saveErr) {
                logger_1.default.error(`Erro ao registrar EmailLog para mailId=${uuid}: ${saveErr.message}`);
            }
            return {
                mailId: uuid,
                queueId: '',
                recipients: recipientsStatus,
            };
        }
    }
}
exports.default = new EmailService();
