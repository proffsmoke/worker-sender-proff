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

  // Métodos adicionais para suportar as chamadas em outros arquivos
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
    const cleanMessageId = logEntry.messageId.replace(/[<>]/g, '');

    const sendData = this.pendingSends.get(cleanMessageId);
    if (!sendData) {
      return;
    }

    const success = logEntry.dsn.startsWith('2');
    const recipient = logEntry.recipient.toLowerCase();
    const isToRecipient = sendData.toRecipients.includes(recipient);

    if (isToRecipient) {
      try {
        const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec();

        if (emailLog) {
          emailLog.success = success;
          await emailLog.save();
        }
      } catch (err) {
        logger.error(`Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`);
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
        }
      } catch (err) {
        logger.error(`Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`);
      }
    }

    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length;

    // Só resolve a promise quando todos os destinatários tiverem um resultado (success: true ou false)
    if (processedRecipients >= totalRecipients) {
      sendData.resolve(sendData.results);
      this.pendingSends.delete(cleanMessageId);
    }
  }

  public async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;
  
    const toRecipients: string[] = Array.isArray(to) ? to.map(r => r.toLowerCase()) : [to.toLowerCase()];
    const bccRecipients: string[] = bcc.map(r => r.toLowerCase());
    const allRecipients: string[] = [...toRecipients, ...bccRecipients];
  
    const messageId = `${uuid}@${emailDomain}`;
    const isTestEmail = fromName === 'Mailer Test' && subject === 'Email de Teste Inicial';
  
    if (isTestEmail) {
      logger.debug(`Setting Message-ID: <${messageId}> for mailId=${uuid}`);
    }
  
    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject,
        html,
        messageId: `<${messageId}>`,
      };
  
      // Envia o email
      const info = await this.transporter.sendMail(mailOptions);
      if (isTestEmail) {
        logger.info(`Email sent: ${JSON.stringify(mailOptions)}`);
        logger.debug(`SMTP server response: ${info.response}`);
      }
  
      // Cria o resultado imediatamente após o envio
      const recipientsStatus: RecipientStatus[] = allRecipients.map((recipient) => ({
        recipient,
        success: true, // Assume sucesso, pois o email foi enviado pelo SMTP
      }));
  
      // Retorna o resultado imediatamente
      const result = {
        mailId: uuid,
        queueId: '',
        recipients: recipientsStatus,
      };
  
      // Processa o resultado em segundo plano e registra no log
      this.processResultInBackground(uuid, messageId, recipientsStatus, isTestEmail);
  
      return result;
    } catch (error: any) {
      logger.error(`Error sending email: ${error.message}`, error);
  
      let recipientsStatus: RecipientStatus[] = [];
  
      if (error.rejected && Array.isArray(error.rejected)) {
        const rejectedSet = new Set(error.rejected.map((r: string) => r.toLowerCase()));
        const acceptedSet = new Set((error.accepted || []).map((r: string) => r.toLowerCase()));
  
        recipientsStatus = allRecipients.map((recipient) => ({
          recipient,
          success: acceptedSet.has(recipient),
          error: rejectedSet.has(recipient)
            ? 'Rejeitado pelo servidor SMTP.'
            : undefined,
        }));
      } else {
        recipientsStatus = allRecipients.map((recipient) => ({
          recipient,
          success: false,
          error: 'Falha desconhecida ao enviar email.',
        }));
      }
  
      // Processa o resultado em segundo plano e registra no log
      this.processResultInBackground(uuid, messageId, recipientsStatus, isTestEmail);
  
      return {
        mailId: uuid,
        queueId: '',
        recipients: recipientsStatus,
      };
    }
  }
  
  private async processResultInBackground(
    uuid: string,
    messageId: string,
    recipientsStatus: RecipientStatus[],
    isTestEmail: boolean
  ): Promise<void> {
    try {
      // Simula um processamento em segundo plano (opcional)
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Simula um pequeno atraso
  
      // Registra o resultado no log
      if (!isTestEmail) {
        const successAny = recipientsStatus.some((r) => r.success);
        logger.info(`Send results for email: MailID: ${uuid}, Message-ID: ${messageId}, Success: ${successAny}, Recipients: ${JSON.stringify(recipientsStatus)}`);
      }
  
      // Atualiza o EmailLog (se necessário)
      const emailLog = await EmailLog.findOne({ mailId: uuid }).exec();
      if (emailLog) {
        emailLog.success = recipientsStatus.some((r) => r.success);
        await emailLog.save();
      }
    } catch (err) {
      logger.error(`Erro ao processar resultado em segundo plano para mailId=${uuid}: ${(err as Error).message}`);
    }
  }
}

export default new EmailService();