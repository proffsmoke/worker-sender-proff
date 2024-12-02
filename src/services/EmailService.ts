// src/services/EmailService.ts
import nodemailer, { Transporter } from 'nodemailer';
import Log from '../models/Log';
import logger from '../utils/logger';
import config from '../config';
import BlockService from './BlockService';
import MailerService from './MailerService';
import { v4 as uuidv4 } from 'uuid';

class EmailService {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: '0.0.0.0', // Alterado para localhost
      port: 25, // Alterado para 25
      secure: false,
      auth: {
        user: config.auth.login,
        pass: config.auth.password,
      },
    });

    this.transporter.verify()
      .then(() => {
        logger.info('Transportador SMTP está pronto para enviar emails.');
      })
      .catch((error) => {
        logger.error('Erro ao verificar transportador SMTP:', { error });
      });
  }

  async sendEmail(
    to: string,
    bcc: string[],
    subject: string,
    html: string
  ): Promise<{ to: string; success: boolean; message: string }[]> {
    const results: { to: string; success: boolean; message: string }[] = [];
    const mailId = uuidv4();

    if (MailerService.isMailerBlocked()) {
      const message = 'Mailer está bloqueado. Não é possível enviar emails no momento.';
      logger.warn(`Tentativa de envio bloqueada para ${to}: ${message}`, { to, subject });

      await Log.create({
        to,
        bcc,
        success: false,
        message,
      });
      results.push({ to, success: false, message });

      for (const recipient of bcc) {
        await Log.create({
          to: recipient,
          bcc,
          success: false,
          message,
        });
        results.push({ to: recipient, success: false, message });
      }

      return results;
    }

    try {
      const mailOptions = {
        from: 'no-reply@yourdomain.com',
        to,
        bcc,
        subject,
        html,
        headers: { 'X-Mailer-ID': mailId },
      };

      const info = await this.transporter.sendMail(mailOptions);

      await Log.create({
        to,
        bcc,
        success: true,
        message: info.response,
      });
      results.push({ to, success: true, message: info.response });

      for (const recipient of bcc) {
        await Log.create({
          to: recipient,
          bcc,
          success: true,
          message: info.response,
        });
        results.push({ to: recipient, success: true, message: info.response });
      }

      logger.info(`Email enviado para ${to}`, { subject, html, response: info.response });
    } catch (error: any) {
      await Log.create({
        to,
        bcc,
        success: false,
        message: error.message,
      });
      results.push({ to, success: false, message: error.message });

      for (const recipient of bcc) {
        await Log.create({
          to: recipient,
          bcc,
          success: false,
          message: error.message,
        });
        results.push({ to: recipient, success: false, message: error.message });
      }

      logger.error(`Erro ao enviar email para ${to}: ${error.message}`, { subject, html, stack: error.stack });
      
      const isPermanent = BlockService.isPermanentError(error.message);
      const isTemporary = BlockService.isTemporaryError(error.message);

      if (isPermanent && !MailerService.isMailerPermanentlyBlocked()) {
        MailerService.blockMailer('blocked_permanently');
        logger.warn(`Mailer bloqueado permanentemente devido ao erro: ${error.message}`);
      } else if (isTemporary && !MailerService.isMailerBlocked()) {
        MailerService.blockMailer('blocked_temporary');
        logger.warn(`Mailer bloqueado temporariamente devido ao erro: ${error.message}`);
      }
    }

    return results;
  }

  async sendTestEmail(): Promise<boolean> {
    const testEmail = {
      from: 'no-reply@yourdomain.com',
      to: config.mailer.noreplyEmail,
      subject: 'Mailer Test',
      text: `Testing mailer.`,
    };

    try {
      await this.transporter.sendMail(testEmail);
      logger.info(`Email de teste enviado para ${config.mailer.noreplyEmail}`);
      return true;
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste: ${error.message}`, { stack: error.stack });
      return false;
    }
  }
}

export default new EmailService();
