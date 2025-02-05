// EmailService.ts
import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import EmailLog from '../models/EmailLog';
import EmailQueueModel from '../models/EmailQueueModel';
import antiSpam from '../utils/antiSpam';

dotenv.config();

interface SendEmailParams {
  fromName: string;
  emailDomain: string;
  to: string;
  subject: string;
  html: string;
  name?: string;
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

  // Fila interna de envios, com controle de lotes
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

    // Eventos do logParser
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

  /**
   * Cria um objeto de status para cada destinatário.
   */
  private createRecipientStatus(
    recipient: string,
    success: boolean,
    error?: string,
    queueId?: string
  ): RecipientStatus {
    return { recipient, success, error, queueId };
  }

  /**
   * Enfileira o envio de e-mail e retorna uma Promise com o resultado (queueId, success, etc.).
   */
  public async sendEmail(
    params: SendEmailParams,
    uuid?: string
  ): Promise<SendEmailResult> {
    return new Promise((resolve, reject) => {
      this.emailQueue.push({ params, resolve, reject });
      this.processEmailQueue();
    });
  }

  /**
   * Processa a fila interna em lotes (até 3 por vez).
   */
  private async processEmailQueue(): Promise<void> {
    if (this.isProcessingQueue || this.emailQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      const batch = this.emailQueue.splice(0, 3);
      await Promise.all(
        batch.map(async ({ params, resolve, reject }) => {
          try {
            const result = await this.sendEmailInternal(params);
            resolve(result);
          } catch (err) {
            reject(err);
          }
        })
      );
      // Pausa de 1s antes do próximo lote
      setTimeout(() => {
        this.isProcessingQueue = false;
        this.processEmailQueue();
      }, 1000);
    } catch (error) {
      logger.error(
        `Erro no processamento do lote: ${
          error instanceof Error ? error.message : 'Erro desconhecido'
        }`
      );
      this.isProcessingQueue = false;
      this.processEmailQueue();
    }
  }

  /**
   * Substitui tags {$name(algumTexto)} no conteúdo do e-mail.
   */
  private substituteNameTags(text: string, name?: string): string {
    return text.replace(/\{\$name\(([^)]+)\)\}/g, (_, defaultText) => {
      return name ? name : defaultText;
    });
  }

  /**
   * Método interno que efetivamente envia o e-mail via nodemailer.
   */
  private async sendEmailInternal(params: SendEmailParams): Promise<SendEmailResult> {
    const { fromName, emailDomain, to, subject, html, sender, name } = params;

    const fromEmail = `${fromName.toLowerCase().replace(/\s+/g, '.')}@${emailDomain}`;
    const from = sender
      ? `"${fromName}" <${sender}>`
      : `"${fromName}" <${fromEmail}>`;

    const recipient = to.toLowerCase();

    try {
      // Substituições de placeholder
      const processedHtml = this.substituteNameTags(html, name);
      const processedSubject = this.substituteNameTags(subject, name);
      const antiSpamHtml = antiSpam(processedHtml);

      const mailOptions = {
        from,
        to: recipient,
        subject: processedSubject,
        html: antiSpamHtml,
      };

      logger.info(`Enviando e-mail: ${JSON.stringify(mailOptions)}`);
      const info = await this.transporter.sendMail(mailOptions);

      // Extrair queueId da resposta e normalizá-lo para uppercase
      const queueIdMatch = info.response.match(/queued as\s([A-Z0-9]+)/);
      if (!queueIdMatch || !queueIdMatch[1]) {
        throw new Error('Não foi possível extrair o queueId da resposta do servidor');
      }
      const rawQueueId = queueIdMatch[1];
      const queueId = rawQueueId.toUpperCase();
      logger.info(`EmailService.sendEmailInternal - Extraído queueId=${queueId}`);

      // Extrair mailId
      const mailId = info.messageId;
      if (!mailId) {
        throw new Error('Não foi possível extrair o mailId da resposta');
      }

      logger.info(
        `Email enviado com sucesso: de=${from}, para=${recipient}, queueId=${queueId}, mailId=${mailId}`
      );

      // Cria um status local e salva no pendingSends
      const recipientStatus = this.createRecipientStatus(recipient, true, undefined, queueId);
      this.pendingSends.set(queueId, recipientStatus);

      // Salva também no EmailLog (onde o registro de envio é guardado)
      await this.saveQueueIdAndMailIdToEmailLog(queueId, mailId, recipient);

      return {
        queueId,
        recipient: recipientStatus,
      };
    } catch (error: any) {
      logger.error(`Erro ao enviar e-mail para ${recipient}: ${error.message}`, error);
      const recipientStatus = this.createRecipientStatus(recipient, false, error.message);
      return { queueId: '', recipient: recipientStatus };
    }
  }

  /**
   * Salva (ou atualiza) as informações no EmailLog, relacionando queueId e mailId.
   */
  private async saveQueueIdAndMailIdToEmailLog(
    queueId: string,
    mailId: string,
    recipient: string
  ): Promise<void> {
    try {
      const doc = await EmailLog.findOneAndUpdate(
        { queueId },
        {
          $set: {
            mailId,
            email: recipient,
            updated: true,
            sentAt: new Date(),
          },
          $setOnInsert: {
            expireAt: new Date(Date.now() + 30 * 60 * 1000), // expira em 30 min (exemplo)
          },
        },
        { upsert: true, new: true }
      );
      logger.info(
        `Log salvo/atualizado no EmailLog: queueId=${queueId}, mailId=${mailId}, recipient=${recipient}`
      );
      logger.info(`EmailLog atual: ${JSON.stringify(doc, null, 2)}`);
    } catch (error) {
      logger.error(`Erro ao salvar log no EmailLog:`, error);
    }
  }

  /**
   * Atualiza o status (e opcionalmente o mailId) correspondente no EmailQueueModel.
   * Aqui usamos o queueId já normalizado (uppercase).
   */
  private async updateEmailQueueModel(queueId: string, success: boolean): Promise<void> {
    try {
      const filter = { 'queueIds.queueId': queueId };
      logger.info(`updateEmailQueueModel - Buscando documento com filtro: ${JSON.stringify(filter)}`);
      
      // Tenta encontrar o documento para debugar
      const existingDoc = await EmailQueueModel.findOne(filter, { queueIds: 1, uuid: 1 });
      if (!existingDoc) {
        logger.warn(`findOne não encontrou nenhum documento para queueIds.queueId=${queueId}`);
      } else {
        logger.info(`Documento encontrado: uuid=${existingDoc.uuid}, queueIds=${JSON.stringify(existingDoc.queueIds)}`);
      }

      // Atualiza o campo success no array de queueIds (poderia ser estendido para atualizar mailId se necessário)
      const result = await EmailQueueModel.updateOne(
        { 'queueIds.queueId': queueId },
        { $set: { 'queueIds.$.success': success } }
      );
      logger.info(`Queue atualizada no EmailQueueModel: queueId=${queueId} => success=${success}`);
      logger.info(`Queue update result for queueId=${queueId}: ${JSON.stringify(result)}`);

      if (result.matchedCount === 0) {
        logger.warn(`Nenhum documento foi encontrado para queueIds.queueId=${queueId} durante o update.`);
      }
    } catch (error) {
      logger.error(`Erro ao atualizar EmailQueueModel para queueId=${queueId}`, error);
    }
  }

  /**
   * Intercepta os logs do Postfix (ou outro MTA) e atualiza o EmailQueueModel.
   */
  private async handleLogEntry(logEntry: LogEntry): Promise<void> {
    logger.info(`handleLogEntry - Log recebido: ${JSON.stringify(logEntry)}`);

    // Garantimos que o queueId do log esteja em uppercase para comparar com o que foi salvo
    const normalizedQueueId = logEntry.queueId.toUpperCase();
    const recipientStatus = this.pendingSends.get(normalizedQueueId);
    if (!recipientStatus) {
      logger.warn(`Nenhum status pendente para queueId=${normalizedQueueId}`);
      // Mesmo assim, tenta atualizar o EmailQueueModel
      await this.updateEmailQueueModel(normalizedQueueId, logEntry.success);
      return;
    }

    // Atualiza o status local
    recipientStatus.success = logEntry.success;
    recipientStatus.logEntry = logEntry;

    if (!logEntry.success) {
      recipientStatus.error = `Falha ao enviar: ${logEntry.result}`;
      logger.error(`Falha para ${recipientStatus.recipient}: ${logEntry.result}`);
    } else {
      logger.info(`Sucesso para ${recipientStatus.recipient}: ${logEntry.result}`);
    }

    // Atualiza no MongoDB
    await this.updateEmailQueueModel(normalizedQueueId, logEntry.success);

    // Emite evento se necessário
    this.emit('queueProcessed', normalizedQueueId, recipientStatus);
  }

  /**
   * Trata logs de teste (se você usa um teste específico).
   */
  private async handleTestEmailLog(logEntry: { mailId: string; success: boolean }): Promise<void> {
    if (logEntry.mailId === this.testEmailMailId) {
      logger.info(`Log de teste para mailId=${logEntry.mailId}, success=${logEntry.success}`);
      this.emit('testEmailProcessed', logEntry);
    }
  }

  /**
   * Aguarda resultado de um e-mail de teste por até 60s.
   */
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
