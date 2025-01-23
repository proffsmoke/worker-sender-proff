import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';

interface SendEmailParams {
  fromName?: string;
  emailDomain: string;
  to: string | string[];
  bcc?: string[];
  subject: string;
  html: string;
  clientName?: string;
}

interface EmailListItem {
  email: string;
  name?: string;
  subject: string;
  template: string;
  clientName?: string;
}

interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
}

interface SendEmailResult {
  queueId: string;
  recipients: RecipientStatus[];
}

class EmailService {
  private static instance: EmailService;
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private pendingSends: Map<
    string,
    {
      toRecipients: string[];
      bccRecipients: string[];
      results: RecipientStatus[];
    }
  > = new Map();

  private constructor(logParser: LogParser) {
    this.transporter = nodemailer.createTransport({
      host: 'localhost',
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = logParser;
    this.logParser.on('log', this.handleLogEntry.bind(this));
  }

  public static getInstance(logParser?: LogParser): EmailService {
    if (!EmailService.instance && logParser) {
      EmailService.instance = new EmailService(logParser);
    } else if (!EmailService.instance) {
      throw new Error('EmailService não foi inicializado. Forneça um LogParser.');
    }
    return EmailService.instance;
  }

  public async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { fromName = 'No-Reply', emailDomain, to, bcc = [], subject, html, clientName } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    const toRecipients: string[] = Array.isArray(to) ? to.map((r) => r.toLowerCase()) : [to.toLowerCase()];
    const bccRecipients: string[] = bcc.map((r) => r.toLowerCase());
    const allRecipients: string[] = [...toRecipients, ...bccRecipients];

    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject: clientName ? `[${clientName}] ${subject}` : subject,
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);

      const queueId = info.response.match(/queued as\s([A-Z0-9]+)/);
      if (queueId && queueId[1]) {
        logger.info(`queueId extraído com sucesso: ${queueId[1]}`);
      } else {
        throw new Error('Não foi possível extrair o queueId da resposta');
      }

      logger.info(`Email enviado!`);
      logger.info(`queueId (messageId do servidor): ${queueId}`);
      logger.info(`Info completo: `, info);

      const recipientsStatus: RecipientStatus[] = allRecipients.map((recipient) => ({
        recipient,
        success: true,
      }));

      this.pendingSends.set(queueId[1], {
        toRecipients,
        bccRecipients,
        results: recipientsStatus,
      });

      return {
        queueId: queueId[1],
        recipients: recipientsStatus,
      };
    } catch (error: any) {
      logger.error(`Erro ao enviar email: ${error.message}`, error);

      const recipientsStatus: RecipientStatus[] = allRecipients.map((recipient) => ({
        recipient,
        success: false,
        error: error.message,
      }));

      return {
        queueId: '',
        recipients: recipientsStatus,
      };
    }
  }

  public async sendEmailList(params: { emailDomain: string; emailList: EmailListItem[] }): Promise<SendEmailResult[]> {
    const { emailDomain, emailList } = params;

    const results = await Promise.all(
      emailList.map(async (emailItem) => {
        return this.sendEmail({
          fromName: emailItem.name || 'No-Reply',
          emailDomain,
          to: emailItem.email,
          bcc: [],
          subject: emailItem.subject,
          html: emailItem.template,
          clientName: emailItem.clientName,
        });
      })
    );

    return results;
  }

  private handleLogEntry(logEntry: LogEntry) {
    const sendData = this.pendingSends.get(logEntry.queueId);
    if (!sendData) {
      return;
    }

    const success = logEntry.success;
    const recipient = logEntry.email.toLowerCase();

    const recipientIndex = sendData.results.findIndex((r) => r.recipient === recipient);
    if (recipientIndex !== -1) {
      sendData.results[recipientIndex].success = success;
      if (!success) {
        sendData.results[recipientIndex].error = `Status: ${logEntry.result}`;
      }
    }

    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length;

    if (processedRecipients >= totalRecipients) {
      this.pendingSends.delete(logEntry.queueId);
    }
  }
}

export default EmailService;