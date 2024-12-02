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
  private DEFAULT_TIMEOUT_MS = 20000; // Increased to 20 seconds

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
    // Check for pending sends with this Message-ID
    if (this.pendingSends.has(logEntry.messageId)) {
      const sendData = this.pendingSends.get(logEntry.messageId)!;
      const success = logEntry.status.toLowerCase() === 'sent';

      // Update the result for the recipient
      sendData.results.push({
        recipient: logEntry.recipient,
        success,
      });

      logger.info(`Updated status for ${logEntry.recipient}: ${success ? 'Sent' : 'Failed'}`);

      // Check if all recipients have been processed
      if (sendData.results.length === sendData.recipients.length) {
        // Resolve the promise with the results
        sendData.resolve(sendData.results);

        // Remove the pending send
        this.pendingSends.delete(logEntry.messageId);
      }
    }
  }

  async sendEmail(params: SendEmailParams, timeoutMs?: number): Promise<{ mailId: string; queueId: string; recipients: RecipientStatus[] }> {
    const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    // Combine 'to' and 'bcc' into a complete list of recipients
    const recipients: string[] = Array.isArray(to) ? [...to, ...bcc] : [to, ...bcc];

    // Generate a unique Message-ID using UUID
    const messageId = `${uuid}@${emailDomain}`;

    logger.info(`Starting email send: MailID=${uuid}, Message-ID=${messageId}, Recipients=${recipients.join(', ')}`);

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

      // Prepare the promise to wait for recipient statuses
      const sendPromise = new Promise<RecipientStatus[]>((resolve, reject) => {
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
            const sendData = this.pendingSends.get(messageId)!;
            sendData.reject(new Error('Timeout ao capturar status para todos os destinatários.'));
            this.pendingSends.delete(messageId);
            logger.warn(`Timeout reached for MailID=${uuid}, Message-ID=${messageId}.`);
          }
        }, timeoutMs || this.DEFAULT_TIMEOUT_MS);
      });

      const results = await sendPromise;

      // Check if all sends were successful
      const allSuccess = results.every((r) => r.success);

      logger.info(`Email send result: MailID=${uuid}, Message-ID=${messageId}, Recipients=${JSON.stringify(results)}`);

      return {
        mailId: uuid,
        queueId: '', // Adjust as necessary
        recipients: results,
      };
    } catch (error) {
      logger.error(`Error sending email: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
      throw error;
    }
  }
}

export default new EmailService();
