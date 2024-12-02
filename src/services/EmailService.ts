// EmailService.js
import nodemailer from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import LogParser from '../log-parser';
import { v4 as uuidv4 } from 'uuid';

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
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private pendingSends: Map<string, { uuid: string; recipients: string[]; results: RecipientStatus[]; resolve: Function; reject: Function }> = new Map();

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: '127.0.0.1',
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = new LogParser('/var/log/mail.log');
    this.logParser.startMonitoring();

    // Listen to log events
    this.logParser.on('log', this.handleLogEntry.bind(this));
  }

  private handleLogEntry(logEntry: { queueId: string; recipient: string; status: string; messageId: string }) {
    for (const [messageId, sendData] of this.pendingSends.entries()) {
      if (logEntry.messageId === messageId) {
        const success = logEntry.status.toLowerCase() === 'sent';

        sendData.results.push({
          recipient: logEntry.recipient,
          success,
        });

        logger.info(`Updated status for ${logEntry.recipient}: ${success ? 'Sent' : 'Failed'}`);

        if (sendData.results.length === sendData.recipients.length) {
          sendData.resolve(sendData.results);
          this.pendingSends.delete(messageId);
        }
      }
    }
  }

  async sendEmail(params: SendEmailParams): Promise<{ mailId: string; queueId: string; recipients: RecipientStatus[] }> {
    const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    const recipients: string[] = Array.isArray(to) ? [...to, ...bcc] : [to, ...bcc];

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

      logger.info(`Email sent: ${JSON.stringify(mailOptions)}`);
      logger.debug(`SMTP server response: ${info.response}`);

      const sendPromise = new Promise<RecipientStatus[]>((resolve, reject) => {
        this.pendingSends.set(messageId, {
          uuid,
          recipients,
          results: [],
          resolve,
          reject,
        });

        setTimeout(() => {
          if (this.pendingSends.has(messageId)) {
            const sendData = this.pendingSends.get(messageId)!;
            sendData.reject(new Error('Timeout ao capturar status para todos os destinatários.'));
            this.pendingSends.delete(messageId);
          }
        }, 20000); // 20 seconds
      });

      const results = await sendPromise;

      const allSuccess = results.every((r) => r.success);

      logger.info(`Send results: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`);

      return {
        mailId: uuid,
        queueId: '', // Adjust as needed
        recipients: results,
      };
    } catch (error) {
      logger.error(`Error sending email: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
      throw error;
    }
  }
}

export default new EmailService();
