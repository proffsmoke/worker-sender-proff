// src/services/EmailService.ts

import nodemailer from 'nodemailer';
import EmailLog, { IEmailLog } from '../models/EmailLog';
import logger from '../utils/logger';

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

  constructor() {
    this.transporter = nodemailer.createTransport({
      sendmail: true,
      path: '/usr/sbin/sendmail',
      args: ['-v'], // Ativa o modo verbose do Sendmail
      newline: 'unix',
    });
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

      // Enviar o e-mail e capturar a resposta completa
      const info = await this.transporter.sendMail(mailOptions);

      logger.info(`Headers enviados: ${JSON.stringify(mailOptions)}`);
      logger.info(`Saída completa do Sendmail: ${info.response}`);

      // Regex para capturar possíveis Queue IDs
      const queueIdMatch = info.response.match(/(?:Message accepted for delivery|Queued mail for delivery).*?([A-Za-z0-9]+)/);
      const queueId = queueIdMatch ? queueIdMatch[1] : null;

      const emailLog = new EmailLog({
        mailId: uuid,
        email: to,
        message: queueId ? 'E-mail enfileirado.' : `Erro ao capturar Queue ID: ${info.response}`,
        success: queueId ? null : false, // Definir false se não conseguiu capturar o Queue ID
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
