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
      host: '127.0.0.1', // Substitua pelo endereço do servidor SMTP
      port: 25,          // Porta do servidor SMTP
      secure: false,      // True para 465, False para outras portas
      tls: { rejectUnauthorized: false }, // Aceitar certificado autoassinado
    });

    this.logParser = new LogParser('/var/log/mail.log');
  }

  async sendEmail(params: SendEmailParams): Promise<string> {
    const { fromName, emailDomain, to, bcc, subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    try {
      // Monitorar logs antes de enviar o e-mail
      this.logParser.startMonitoring();

      const mailOptions = {
        from,
        to,
        bcc,
        subject,
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);

      logger.info(`Email enviado: ${JSON.stringify(mailOptions)}`);
      logger.debug(`Resposta do servidor SMTP: ${info.response}`);

      // Captura do Queue ID a partir da resposta SMTP
      const queueIdMatch = info.response.match(/queued as (\S+)/i);
      const queueId = queueIdMatch ? queueIdMatch[1] : null;

      if (queueId) {
        logger.info(`Queue ID capturado diretamente: ${queueId}`);
        await this.logParser.waitForQueueId(uuid); // Confirmação adicional via LogParser
      } else {
        logger.warn('Queue ID não capturado na resposta SMTP.');
      }

      const emailLog = new EmailLog({
        mailId: uuid,
        email: to,
        message: queueId ? 'E-mail enfileirado.' : 'Erro ao capturar Queue ID.',
        success: !!queueId,
        detail: {
          queueId,
          rawResponse: info.response,
          mailOptions,
        },
      });

      await emailLog.save();

      if (!queueId) {
        throw new Error('Queue ID não encontrado.');
      }

      return queueId;
    } catch (error) {
      // logger.error(`Erro ao enviar e-mail: ${error.message}`, { stack: error.stack });
      throw error;
    } finally {
      this.logParser.stopMonitoring();
    }
  }
}

export default new EmailService();
