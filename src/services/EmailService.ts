import nodemailer from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import LogParser from '../log-parser';

interface SendEmailParams {
  fromName: string;
  emailDomain: string;
  to: string | string[]; // Pode ser um ou mais destinatários
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

  async sendEmail(params: SendEmailParams): Promise<any> {
    const { fromName, emailDomain, to, bcc, subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    try {
      // Start monitoring logs
      this.logParser.startMonitoring();

      const mailOptions = { from, to, bcc, subject, html };
      const recipients = Array.isArray(to) ? to : [to];

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

      // Wait for log monitoring to complete for the captured queue ID
      await Promise.all(
        recipients.map(async (recipient) => {
          const status = await this.logParser.waitForQueueId(queueId);

          // Save the log for each recipient
          const emailLog = new EmailLog({
            mailId: uuid,
            sendmailQueueId: queueId,
            email: recipient,
            message: `Status atualizado: ${status ? 'sent' : 'failed'}`,
            success: status,
            detail: {
              queueId,
              rawResponse: info.response,
              mailOptions,
            },
          });

          await emailLog.save();
          return {
            recipient,
            success: status,
          };
        })
      );

      logger.info(
        `Resultado do envio: MailID: ${uuid}, QueueID: ${queueId}, Recipients: ${JSON.stringify(
          recipients
        )}`
      );

      return {
        mailId: uuid,
        queueId,
        recipients: recipients.map((recipient) => ({ recipient, success: true })),
      };
    } catch (error) {
      // logger.error(`Erro ao enviar e-mail: ${error.message}`, { stack: error.stack });
      throw error;
    } finally {
      this.logParser.stopMonitoring();
    }
  }
}

export default new EmailService();
