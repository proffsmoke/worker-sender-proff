import nodemailer from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';

interface SendEmailParams {
  fromName: string;
  emailDomain: string;
  to: string | string[];
  bcc?: string[];
  subject: string;
  html: string;
  uuid: string;
}

interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
}

interface SendEmailResult {
  mailId: string;
  queueId: string;
  recipients: RecipientStatus[];
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private pendingSends: Map<
    string,
    {
      uuid: string;
      toRecipients: string[];
      bccRecipients: string[];
      results: RecipientStatus[];
      resolve: (value: RecipientStatus[]) => void;
      reject: (reason?: any) => void;
    }
  > = new Map();

  private version: string = '1.0.0'; // Versão do serviço
  private createdAt: Date = new Date(); // Data de criação do serviço
  private status: string = 'health'; // Status do serviço
  private blockReason: string | null = null; // Razão do bloqueio, se houver

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = new LogParser('/var/log/mail.log');
    this.logParser.startMonitoring();

    // Listen to log events
    this.logParser.on('log', this.handleLogEntry.bind(this));
  }

  public getVersion(): string {
    return this.version;
  }

  public getCreatedAt(): Date {
    return this.createdAt;
  }

  public getStatus(): string {
    return this.status;
  }

  public getBlockReason(): string | null {
    return this.blockReason;
  }

  public blockMailer(blockType: 'blocked_temporary' | 'blocked_permanently', reason: string): void {
    this.status = blockType;
    this.blockReason = reason;
    logger.warn(`Mailer bloqueado com status: ${blockType}. Razão: ${reason}`);
  }

  public unblockMailer(): void {
    this.status = 'health';
    this.blockReason = null;
    logger.info('Mailer desbloqueado.');
  }

  public async sendInitialTestEmail(): Promise<SendEmailResult> {
    const testEmailParams: SendEmailParams = {
      fromName: 'Mailer Test',
      emailDomain: 'outlook.com',
      to: 'no-reply@outlook.com',
      subject: 'Email de Teste Inicial',
      html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
      uuid: uuidv4(),
    };

    return this.sendEmail(testEmailParams);
  }

  private async handleLogEntry(logEntry: LogEntry) {
    logger.debug(`Processing Log Entry: ${JSON.stringify(logEntry)}`);

    const cleanMessageId = logEntry.messageId.replace(/[<>]/g, '');

    const sendData = this.pendingSends.get(cleanMessageId);
    if (!sendData) {
      logger.warn(`No pending send found for Message-ID: ${cleanMessageId}`);
      return;
    }

    const success = logEntry.dsn.startsWith('2');

    const recipient = logEntry.recipient.toLowerCase();
    const isToRecipient = sendData.toRecipients.includes(recipient);

    logger.debug(`Is to recipient: ${isToRecipient} for recipient: ${recipient}`);

    if (isToRecipient) {
      try {
        const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec();

        if (emailLog) {
          emailLog.success = success;
          await emailLog.save();
          logger.debug(`EmailLog 'success' atualizado para mailId=${sendData.uuid}`);
        } else {
          logger.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
        }
      } catch (err) {
        logger.error(
          `Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`
        );
      }

      sendData.results.push({
        recipient: recipient,
        success: success
      });
    } else {
      sendData.results.push({
        recipient: recipient,
        success,
      });

      try {
        const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec();

        if (emailLog) {
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
          logger.debug(`EmailLog 'detail' atualizado para mailId=${sendData.uuid}`);
        } else {
          logger.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
        }
      } catch (err) {
        logger.error(
          `Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`
        );
      }
    }

    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length;

    logger.debug(`Total Recipients: ${totalRecipients}, Processed Recipients: ${processedRecipients}`);

    if (processedRecipients >= totalRecipients) {
      sendData.resolve(sendData.results);
      this.pendingSends.delete(cleanMessageId);
      logger.debug(`All recipients processed for mailId=${sendData.uuid}`);
    }
  }

  public async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    const toRecipients: string[] = Array.isArray(to) ? to.map(r => r.toLowerCase()) : [to.toLowerCase()];
    const bccRecipients: string[] = bcc.map(r => r.toLowerCase());
    const allRecipients: string[] = [...toRecipients, ...bccRecipients];

    const messageId = `${uuid}@${emailDomain}`;
    logger.debug(`Setting Message-ID: <${messageId}> for mailId=${uuid}`);

    const isTestEmail = fromName === 'Mailer Test' && subject === 'Email de Teste Inicial';

    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject,
        html,
        messageId: `<${messageId}>`,
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent: ${JSON.stringify(mailOptions)}`);
      logger.debug(`SMTP server response: ${info.response}`);

      const sendPromise = new Promise<RecipientStatus[]>((resolve, reject) => {
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
            const sendData = this.pendingSends.get(messageId)!;
            sendData.reject(
              new Error('Timeout ao capturar status para todos os destinatários.')
            );
            this.pendingSends.delete(messageId);
            logger.warn(`Timeout: Failed to capture status for mailId=${uuid}`);
          }
        }, 10000); // 10 segundos
      });

      const results = await sendPromise;

      if (isTestEmail) {
        logger.info(`Send results for test email: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`);
      } else {
        const emailLog = new EmailLog({
          mailId: uuid,
          sendmailQueueId: '',
          email: Array.isArray(to) ? to.join(', ') : to,
          message: subject,
          success: null,
          sentAt: new Date(),
        });

        await emailLog.save();
        logger.debug(`EmailLog criado para mailId=${uuid}`);

        if (results.length > 0) {
          const emailLogUpdate = await EmailLog.findOne({ mailId: uuid }).exec();
          if (emailLogUpdate) {
            const allBccSuccess = results.every(r => r.success);
            emailLogUpdate.success = allBccSuccess;
            await emailLogUpdate.save();
            logger.debug(`EmailLog 'success' atualizado para mailId=${uuid} com valor ${allBccSuccess}`);
          }
        }

        logger.info(
          `Send results: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`
        );
      }

      return {
        mailId: uuid,
        queueId: '',
        recipients: results,
      };
    } catch (error: any) {
      logger.error(`Error sending email: ${error.message}`, error);

      let recipientsStatus: RecipientStatus[] = [];

      if (error.rejected && Array.isArray(error.rejected)) {
        const rejectedSet = new Set(error.rejected.map((r: string) => r.toLowerCase()));
        const acceptedSet = new Set((error.accepted || []).map((r: string) => r.toLowerCase()));

        recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
          recipient,
          success: acceptedSet.has(recipient),
          error: rejectedSet.has(recipient)
            ? 'Rejeitado pelo servidor SMTP.'
            : undefined,
        }));
      } else {
        recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
          recipient,
          success: false,
          error: 'Falha desconhecida ao enviar email.',
        }));
      }

      if (!isTestEmail) {
        try {
          const emailLog = await EmailLog.findOne({ mailId: uuid }).exec();

          if (emailLog) {
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
            logger.debug(`EmailLog atualizado com erro para mailId=${uuid}`);
          } else {
            logger.warn(`EmailLog não encontrado para mailId=${uuid}`);
          }
        } catch (saveErr) {
          logger.error(
            `Erro ao registrar EmailLog para mailId=${uuid}: ${(saveErr as Error).message}`
          );
        }
      }

      return {
        mailId: uuid,
        queueId: '',
        recipients: recipientsStatus,
      };
    }
  }
}

export default new EmailService();