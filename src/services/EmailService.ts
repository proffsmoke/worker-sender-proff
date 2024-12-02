import nodemailer from 'nodemailer';
import { exec } from 'child_process';
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
      args: ['-v'], // Ativa o modo verbose para captura de informações básicas
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

      // Passo 1: Enviar o e-mail com Nodemailer
      const info = await this.transporter.sendMail(mailOptions);

      logger.info(`Headers enviados: ${JSON.stringify(mailOptions)}`);
      logger.info(`Saída básica do Sendmail: ${info.response}`);

      // Passo 2: Executar Sendmail diretamente com '-v -q' para capturar detalhes
      const queueId = await this.captureQueueId();

      if (!queueId) {
        logger.warn(`Queue ID não capturado. Salvando log para análise posterior.`);
        await this.logEmail({
          mailId: uuid,
          email: to,
          message: `Erro ao capturar Queue ID após envio com -v -q.`,
          success: false,
          detail: {
            rawResponse: info.response,
            mailOptions,
          },
        });
        throw new Error('Não foi possível capturar o Queue ID.');
      }

      logger.info(`Queue ID capturado: ${queueId}`);

      // Passo 3: Salvar log de sucesso no MongoDB
      await this.logEmail({
        mailId: uuid,
        email: to,
        message: 'E-mail enfileirado com sucesso.',
        success: true,
        detail: {
          queueId,
          rawResponse: info.response,
          mailOptions,
        },
      });

      return queueId;
    } catch (error) {
      logger.error(`Erro ao enviar e-mail: ${error}`);
      throw error;
    }
  }

  /**
   * Captura o Queue ID executando Sendmail com os argumentos -v -q.
   */
  private async captureQueueId(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      exec('/usr/sbin/sendmail -v -q', (error, stdout, stderr) => {
        if (error) {
          logger.error(`Erro ao executar Sendmail: ${error.message}`);
          reject(null);
        }

        logger.info(`Saída completa do Sendmail (-v -q): ${stdout || stderr}`);

        // Regex para capturar Queue ID na saída do Sendmail
        const queueIdMatch = (stdout || stderr).match(/(?:Message accepted for delivery|Queued mail for delivery).*?([A-Za-z0-9]+)/);
        resolve(queueIdMatch ? queueIdMatch[1] : null);
      });
    });
  }

  /**
   * Salva um log de e-mail no MongoDB.
   */
  private async logEmail(log: Partial<IEmailLog>) {
    const emailLog = new EmailLog({
      mailId: log.mailId,
      email: log.email,
      message: log.message,
      success: log.success,
      detail: log.detail,
      sentAt: new Date(),
    });

    await emailLog.save();
  }
}

export default new EmailService();
