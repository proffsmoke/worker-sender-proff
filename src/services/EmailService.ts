// src/services/EmailService.ts

import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import EmailLog from '../models/EmailLog';
import antiSpam from '../utils/antiSpam';
dotenv.config();

interface SendEmailParams {
  fromName: string;
  emailDomain: string;
  to: string;
  subject: string;
  html: string;
  name?: string; // Usa "name" em vez de "clientName"
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
  private emailQueue: Array<{
    params: SendEmailParams;
    resolve: (value: SendEmailResult) => void;
    reject: (reason?: any) => void;
  }> = [];
  private isProcessingQueue = false;

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
    logger.info(`EmailService.sendEmail chamado com params: ${JSON.stringify(params)} e uuid: ${uuid}`);
    return new Promise((resolve, reject) => {
      this.emailQueue.push({ params, resolve, reject });
      this.processEmailQueue();
    });
  }

  private async processEmailQueue(): Promise<void> {
    if (this.isProcessingQueue || this.emailQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Processa até 3 emails por vez
      const batch = this.emailQueue.splice(0, 3);
      await Promise.all(batch.map(async ({ params, resolve, reject }) => {
        try {
          const result = await this.sendEmailInternal(params);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }));

      // Aguarda 1 segundo antes de processar o próximo lote
      setTimeout(() => {
        this.isProcessingQueue = false;
        this.processEmailQueue();
      }, 1000);
    } catch (error) {
      logger.error(`Erro no processamento do lote: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      this.isProcessingQueue = false;
      this.processEmailQueue();
    }
  }

  /**
   * Realiza a substituição de tags do tipo {$name(algumTexto)}.
   */
  private substituteNameTags(text: string, name?: string): string {
    return text.replace(/\{\$name\(([^)]+)\)\}/g, (_, defaultText) => {
      return name ? name : defaultText;
    });
  }

  private async sendEmailInternal(params: SendEmailParams, existingQueueIds: any[] = []): Promise<SendEmailResult> {
    logger.info(`EmailService.sendEmailInternal - Params recebidos: ${JSON.stringify(params)}`);
    const { fromName, emailDomain, to, subject, html, sender } = params;

    const fromEmail = `${fromName.toLowerCase().replace(/\s+/g, '.')}@${emailDomain}`;
    const from = sender ? `"${fromName}" <${sender}>` : `"${fromName}" <${fromEmail}>`;

    const recipient = to.toLowerCase();

    try {
      // Aplica a substituição de tags
      const processedHtml = this.substituteNameTags(html, params.name);
      const processedSubject = this.substituteNameTags(subject, params.name);

      const antiSpamHtml = antiSpam(processedHtml);

      // Criação do objeto de envio do e-mail
      const mailOptions = {
        from,
        to: recipient,
        subject: processedSubject,
        html: antiSpamHtml,
      };

      logger.info(`Preparando para enviar email com mailOptions: ${JSON.stringify(mailOptions)}`);

      const info = await this.transporter.sendMail(mailOptions);

      // Extrair queueId
      const queueIdMatch = info.response.match(/queued as\s([A-Z0-9]+)/);
      if (!queueIdMatch || !queueIdMatch[1]) {
        throw new Error('Não foi possível extrair o queueId da resposta');
      }
      const queueId = queueIdMatch[1];

      // Extrair mailId
      const mailId = info.messageId;
      if (!mailId) {
        throw new Error('Não foi possível extrair o mailId da resposta');
      }

      if (existingQueueIds.some(item => item.queueId === queueId)) {
        logger.info(`O queueId ${queueId} já está presente, não será duplicado.`);
        return {
          queueId,
          recipient: this.createRecipientStatus(recipient, false, "Duplicate queueId"),
        };
      }

      logger.info(`Email enviado com sucesso! Detalhes:
                - De: ${from}
                - Para: ${recipient}
                - QueueId: ${queueId}
                - MailId: ${mailId}
            `);

      const recipientStatus = this.createRecipientStatus(recipient, true, undefined, queueId);
      this.pendingSends.set(queueId, recipientStatus);

      // Salvar a associação no EmailLog
      await this.saveQueueIdAndMailIdToEmailLog(queueId, mailId, recipient);

      logger.info(`Dados de envio associados com sucesso para queueId=${queueId} e mailId=${mailId}.`);

      return {
        queueId,
        recipient: recipientStatus,
      };
    } catch (error: any) {
      logger.error(`Erro ao enviar email: ${error.message}`, error);

      const recipientStatus = this.createRecipientStatus(recipient, false, error.message);
      return {
        queueId: '',
        recipient: recipientStatus,
      };
    }
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
    logger.info(`handleLogEntry - Log recebido: ${JSON.stringify(logEntry)}`);
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
