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
        };

        const info = await this.transporter.sendMail(mailOptions);

        // Logar saída completa do Sendmail para análise
        const sendmailOutput = info.response as string;
        logger.info(`Saída completa do Sendmail: ${sendmailOutput}`);

        // Regex atualizada para capturar possíveis variações do Queue ID
        const queueIdMatch = sendmailOutput.match(/(?:Message accepted for delivery|Queued mail for delivery).*?([A-Za-z0-9]+)/);
        const queueId = queueIdMatch ? queueIdMatch[1] : null;

        if (!queueId) {
            // Logar erro detalhado com a saída completa
            logger.error(`Erro ao capturar Queue ID. Saída do Sendmail: ${sendmailOutput}`);

            // Armazenar log para diagnóstico
            const emailLog = new EmailLog({
                mailId: uuid,
                email: to,
                message: `Erro ao capturar Queue ID: ${sendmailOutput}`,
                success: false,
                detail: { rawResponse: sendmailOutput },
            });

            await emailLog.save();
            throw new Error('Não foi possível capturar o Queue ID.');
        }

        logger.info(`Queue ID capturado: ${queueId}`);

        // Salvar o UUID e Queue ID no MongoDB
        const emailLog = new EmailLog({
            mailId: uuid,
            email: to,
            message: 'E-mail enfileirado.',
            success: null,
            detail: { queueId, rawResponse: sendmailOutput },
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
