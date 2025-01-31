import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import EmailLog from '../models/EmailLog';
import EmailQueueModel from '../models/EmailQueueModel';

dotenv.config();

interface SendEmailParams {
    fromName: string;
    emailDomain: string;
    to: string;
    subject: string;
    html: string;
    clientName?: string;
    mailerId?: string;
    sender?: string;
}

interface RecipientStatus {
    recipient: string;
    success: boolean;
    error?: string;
    queueId?: string;
    logEntry?: LogEntry;
}

interface SendEmailResult {
    queueId: string;
    recipient: RecipientStatus;
}

export interface TestEmailResult {
    success: boolean;
    mailId?: string;
}

class EmailService extends EventEmitter {
    private static instance: EmailService;
    private transporter: nodemailer.Transporter;
    private logParser: LogParser;
    private pendingSends: Map<string, RecipientStatus>;
    private testEmailMailId: string | null = null;
    private isProcessing: boolean = false;
    private tokens: number = 3;
    private lastRefill: number = Date.now();

    private constructor(logParser: LogParser) {
        super();
        this.transporter = nodemailer.createTransport({
            host: 'localhost',
            port: 25,
            secure: false,
            tls: { rejectUnauthorized: false },
        });

        this.logParser = logParser;
        this.pendingSends = new Map();
        this.logParser.on('log', this.handleLogEntry.bind(this));
        this.logParser.on('testEmailLog', this.handleTestEmailLog.bind(this));
        this.startBackgroundProcessor();
    }

    public static getInstance(logParser?: LogParser): EmailService {
        if (!EmailService.instance && logParser) {
            EmailService.instance = new EmailService(logParser);
        } else if (!EmailService.instance) {
            throw new Error('EmailService não foi inicializado. Forneça um LogParser.');
        }
        return EmailService.instance;
    }

    private createRecipientStatus(recipient: string, success: boolean, error?: string, queueId?: string): RecipientStatus {
        return {
            recipient,
            success,
            error,
            queueId,
        };
    }

    public async sendEmail(params: SendEmailParams, uuid?: string, existingQueueIds: any[] = []): Promise<SendEmailResult> {
        const appQueueId = this.generateUUID(); // Gere um ID único para a fila
        const emailQueueEntry = new EmailQueueModel({
            uuid,
            appQueueId,
            params,
            status: 'queued',
            createdAt: new Date(),
        });
        await emailQueueEntry.save();

        return {
            queueId: appQueueId,
            recipient: this.createRecipientStatus(params.to, true, undefined, appQueueId),
        };
    }

    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    private startBackgroundProcessor() {
        setInterval(() => this.refillTokens(), 1000); // Recarrega tokens a cada segundo
        this.processQueue(); // Inicia o processamento contínuo
    }

    private refillTokens() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        if (elapsed >= 1000) {
            this.tokens = 3; // Recarrega para 3 tokens a cada segundo
            this.lastRefill = now;
        }
    }

    private async processQueue() {
        while (true) {
            if (this.tokens > 0 && !this.isProcessing) {
                this.isProcessing = true;
                const email = await EmailQueueModel.findOneAndUpdate(
                    { status: 'queued' },
                    { status: 'processing' },
                    { sort: { createdAt: 1 }, new: true }
                );

                if (email) {
                    this.tokens--;
                    this.sendQueuedEmail(email)
                        .finally(() => this.isProcessing = false);
                } else {
                    this.isProcessing = false;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 100)); // Evita bloqueio
        }
    }

    private async sendQueuedEmail(email: any) {
        try {
            const { params } = email;
            const smtpQueueId = await this.sendViaTransporter(params);
    
            email.status = 'sent';
            email.smtpQueueId = smtpQueueId;
            await email.save();
    
            // Atualiza o EmailLog com o queueId real do SMTP
            await this.saveQueueIdAndMailIdToEmailLog(smtpQueueId, email.mailId, params.to);
        } catch (error) {
            // Verifica se o erro é uma instância de Error antes de acessar a propriedade 'message'
            if (error instanceof Error) {
                email.status = 'failed';
                email.error = error.message;
            } else {
                // Caso o erro não seja uma instância de Error, converte para string
                email.status = 'failed';
                email.error = String(error);
            }
            await email.save();
        }
    }

    private async sendViaTransporter(params: SendEmailParams): Promise<string> {
        const { fromName, emailDomain, to, subject, html, sender } = params;

        const fromEmail = `${fromName.toLowerCase().replace(/\s+/g, '.')}@${emailDomain}`;
        const from = sender ? `"${fromName}" <${sender}>` : `"${fromName}" <${fromEmail}>`;

        const recipient = to.toLowerCase();

        const mailOptions = {
            from,
            to: recipient,
            subject,
            html,
        };

        logger.info(`Preparando para enviar email: ${JSON.stringify(mailOptions)}`);

        const info = await this.transporter.sendMail(mailOptions);

        const queueIdMatch = info.response.match(/queued as\s([A-Z0-9]+)/);
        if (!queueIdMatch || !queueIdMatch[1]) {
            throw new Error('Não foi possível extrair o queueId da resposta');
        }
        return queueIdMatch[1];
    }

    private async saveQueueIdAndMailIdToEmailLog(queueId: string, mailId: string, recipient: string): Promise<void> {
        try {
            logger.info(`Tentando salvar queueId=${queueId}, mailId=${mailId} e recipient=${recipient} no EmailLog.`);

            let emailLog = await EmailLog.findOne({ mailId });

            if (!emailLog) {
                emailLog = new EmailLog({
                    mailId,
                    queueId,
                    email: recipient,
                    success: null,
                    updated: false,
                    sentAt: new Date(),
                    expireAt: new Date(Date.now() + 30 * 60 * 1000),
                });
            }

            emailLog.queueId = queueId;
            emailLog.email = recipient;
            await emailLog.save();
            logger.info(`Log salvo/atualizado no EmailLog: queueId=${queueId}, mailId=${mailId}, recipient=${recipient}`);

        } catch (error) {
            logger.error(`Erro ao salvar log no EmailLog:`, error);
        }
    }

    private async handleLogEntry(logEntry: LogEntry): Promise<void> {
        const recipientStatus = this.pendingSends.get(logEntry.queueId);
        if (!recipientStatus) {
            logger.warn(`Nenhum dado pendente encontrado para queueId=${logEntry.queueId}`);
            return;
        }

        recipientStatus.success = logEntry.success;
        recipientStatus.logEntry = logEntry;

        if (!logEntry.success) {
            recipientStatus.error = `Status: ${logEntry.result}`;
            logger.error(`Falha ao enviar para recipient=${recipientStatus.recipient}. Erro: ${logEntry.result}. Log completo: ${JSON.stringify(logEntry)}`);
        } else {
            logger.info(`Resultado atualizado com sucesso para recipient=${recipientStatus.recipient}. Status: ${logEntry.success}. Log completo: ${JSON.stringify(logEntry)}`);
        }

        this.emit('queueProcessed', logEntry.queueId, recipientStatus);
    }

    private async handleTestEmailLog(logEntry: { mailId: string; success: boolean }): Promise<void> {
        if (logEntry.mailId === this.testEmailMailId) {
            logger.info(`Log de teste recebido para mailId=${logEntry.mailId}. Resultado: ${logEntry.success}`);
            this.emit('testEmailProcessed', logEntry);
        }
    }

    public async waitForTestEmailResult(uuid: string): Promise<TestEmailResult> {
        return new Promise((resolve) => {
            const onTestEmailProcessed = (result: { mailId: string; success: boolean }) => {
                if (result.mailId === this.testEmailMailId) {
                    this.removeListener('testEmailProcessed', onTestEmailProcessed);
                    resolve({ success: result.success, mailId: result.mailId });
                }
            };

            this.on('testEmailProcessed', onTestEmailProcessed);

            setTimeout(() => {
                this.removeListener('testEmailProcessed', onTestEmailProcessed);
                resolve({ success: false, mailId: this.testEmailMailId || undefined });
            }, 60000);
        });
    }
}

export default EmailService;