import nodemailer from 'nodemailer';
import EmailLog, { IEmailLog } from '../models/EmailLog';
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
      sendmail: true,
      path: '/usr/sbin/sendmail',
      args: ['-v'], // Ativa o modo verbose do Sendmail
      newline: 'unix',
    });

    this.logParser = new LogParser('/var/log/mail.log');
  }

  async sendEmail(params: SendEmailParams): Promise<string> {
    const { fromName, emailDomain, to, bcc, subject, html, uuid } = params;
    const fromEmail = `"${fromName}" <no-reply@${emailDomain}>`;

    try {
      const mailOptions = {
        from: fromEmail,
        to,
        bcc,
        subject,
        html,
      };

      // Start monitoring logs before sending the email
      this.logParser.startMonitoring();

      // Send email
      const info = await this.transporter.sendMail(mailOptions);

      logger.info(`Headers enviados: ${JSON.stringify(mailOptions)}`);
      logger.info(`Saída completa do Sendmail: ${info.response}`);

      // Await log parsing to capture Queue ID
      const queueId = await this.logParser.waitForQueueId(uuid);

      const emailLog = new EmailLog({
        mailId: uuid,
        email: to,
        message: queueId ? 'E-mail enfileirado.' : `Erro ao capturar Queue ID.`,
        success: queueId ? null : false,
        detail: {
          queueId,
          rawResponse: info.response,
          mailOptions,
        },
      });

      await emailLog.save();

      if (!queueId) {
        logger.warn(`Queue ID não capturado. Salvando log para análise posterior.`);
        throw new Error('Não foi possível capturar o Queue ID.');
      }

      logger.info(`Queue ID capturado: ${queueId}`);
      return queueId;
    } catch (error) {
      logger.error(`Erro ao enviar e-mail: ${error}`);
      throw error;
    }
  }
}

export default new EmailService();
