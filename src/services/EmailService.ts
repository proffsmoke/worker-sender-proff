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
            // headers: { 'X-Mailer-ID': uuid },
        };

        const info = await this.transporter.sendMail(mailOptions);

        // Ajustar regex para capturar o Queue ID correto
        const sendmailOutput = info.response as string;
        const queueIdMatch = sendmailOutput.match(/Message accepted for delivery.*\b([A-Za-z0-9]+)\b/);
        const queueId = queueIdMatch ? queueIdMatch[1] : '';

        if (!queueId) {
            logger.error(`Erro ao capturar Queue ID. Saída do Sendmail: ${sendmailOutput}`);
            throw new Error('Não foi possível capturar o Queue ID.');
        }

        logger.info(`E-mail enviado. Queue ID: ${queueId}`);

        // Salvar o UUID e Queue ID no MongoDB
        const emailLog = new EmailLog({
            mailId: uuid,
            email: to,
            message: 'E-mail enfileirado.',
            success: null,
            detail: { queueId },
        });

        await emailLog.save();
        return queueId;
    } catch (error) {
        logger.error('Erro ao enviar o e-mail:', error);
        throw error;
    }
}

}

export default new EmailService();
