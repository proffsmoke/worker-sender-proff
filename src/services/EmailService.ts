import nodemailer from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import LogParser from '../log-parser';

interface SendEmailParams {
  fromName: string;
  emailDomain: string;
  to: string;
  bcc?: string[];
  subject: string;
  html: string;
  uuid: string;
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: '127.0.0.1',
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = new LogParser('/var/log/mail.log');
  }

  async sendEmail(params: SendEmailParams): Promise<string> {
    const { fromName, emailDomain, to, bcc, subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    try {
      this.logParser.startMonitoring(); // Start monitoring logs before sending

      const mailOptions = { from, to, bcc, subject, html };
      const info = await this.transporter.sendMail(mailOptions);

      logger.info(`Email enviado: ${JSON.stringify(mailOptions)}`);
      logger.debug(`Resposta do servidor SMTP: ${info.response}`);

      // Extract Queue ID from SMTP response
      const queueIdMatch = info.response.match(/queued as (\S+)/i);
      const queueId = queueIdMatch ? queueIdMatch[1] : null;

      if (!queueId) {
        throw new Error('Queue ID não encontrado na resposta SMTP.');
      }

      logger.info(`Queue ID capturado diretamente: ${queueId}`);

      // Relate Queue ID with UUID
      const emailLog = new EmailLog({
        mailId: uuid,
        sendmailQueueId: queueId,
        email: to,
        message: 'E-mail enfileirado.',
        success: true,
        detail: {
          queueId,
          rawResponse: info.response,
          mailOptions,
        },
      });

      await emailLog.save();

      return queueId;
    } catch (error) {
      // logger.error(`Erro ao enviar e-mail: ${error.message}`, { stack: error.stack });
      throw error;
    } finally {
      this.logParser.stopMonitoring(); // Ensure monitoring stops even on errors
    }
  }
}

export default new EmailService();
