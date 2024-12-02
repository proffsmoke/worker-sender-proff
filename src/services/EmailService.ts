import nodemailer from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import LogParser from '../log-parser';

interface SendEmailParams {
  fromName: string;
  emailDomain: string;
  to: string | string[];
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

    const recipients = Array.isArray(to) ? to : [to];
    const allRecipients = [...recipients, ...(bcc || [])];

    try {
      this.logParser.startMonitoring();

      const mailOptions = { from, to: recipients.join(', '), bcc, subject, html };
      const info = await this.transporter.sendMail(mailOptions);

      logger.info(`Email enviado: ${JSON.stringify(mailOptions)}`);
      logger.debug(`Resposta do servidor SMTP: ${info.response}`);

      const queueIdMatch = info.response.match(/queued as (\S+)/i);
      const queueId = queueIdMatch ? queueIdMatch[1] : null;

      if (!queueId) {
        throw new Error('Queue ID não encontrado na resposta SMTP.');
      }

      logger.info(`Queue ID capturado diretamente: ${queueId}`);

      const results = await Promise.all(
        allRecipients.map(async (recipient) => {
          const logStatus = await this.logParser.waitForQueueId(queueId);

          // Ensure logStatus is a string before comparing
          const success = typeof logStatus === 'string' && logStatus === 'sent';

          const emailLog = new EmailLog({
            mailId: uuid,
            sendmailQueueId: queueId,
            email: recipient,
            message: `Status: ${success ? 'Enviado' : 'Falha'}`,
            success,
            detail: {
              queueId,
              rawResponse: info.response,
              mailOptions,
            },
          });

          await emailLog.save();

          return { recipient, success };
        })
      );

      logger.info(`Resultado do envio: MailID: ${uuid}, QueueID: ${queueId}, Recipients: ${JSON.stringify(results)}`);

      return {
        mailId: uuid,
        queueId,
        recipients: results,
      };
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Erro ao enviar e-mail: ${error.message}`, { stack: error.stack });
      } else {
        logger.error(`Erro desconhecido ao enviar e-mail: ${JSON.stringify(error)}`);
      }
      throw error;
    } finally {
      this.logParser.stopMonitoring();
    }
  }
}

export default new EmailService();
