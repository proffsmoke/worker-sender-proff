// src/services/EmailService.ts

import nodemailer from 'nodemailer';
import EmailLog, { IEmailLog } from '../models/EmailLog'; // Import da interface
import logger from '../utils/logger';
import LogParser from '../log-parser';
import { v4 as uuidv4 } from 'uuid';

interface SendEmailParams {
  fromName: string;
  emailDomain: string;
  to: string | string[];
  bcc?: string[];
  subject: string;
  html: string;
  uuid: string;
}

interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
}

interface SendEmailResult {
  mailId: string;
  queueId: string;
  recipients: RecipientStatus[];
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private pendingSends: Map<
    string,
    {
      uuid: string;
      recipients: string[];
      results: RecipientStatus[];
      resolve: (value: RecipientStatus[]) => void;
      reject: (reason?: any) => void;
    }
  > = new Map();

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: '127.0.0.1',
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = new LogParser('/var/log/mail.log');
    this.logParser.startMonitoring();

    // Listen to log events
    this.logParser.on('log', this.handleLogEntry.bind(this));
  }

  private async handleLogEntry(logEntry: {
    queueId: string;
    recipient: string;
    status: string;
    messageId: string;
    dsn: string;
  }) {
    const sendData = this.pendingSends.get(logEntry.messageId);
    if (!sendData) {
      // Não há envio pendente para este messageId
      return;
    }

    const success = logEntry.dsn.startsWith('2');

    sendData.results.push({
      recipient: logEntry.recipient,
      success,
    });

    logger.info(
      `Updated status for ${logEntry.recipient}: ${success ? 'Sent' : 'Failed'}`
    );

    try {
      const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec();

      if (emailLog) {
        // Atualizar o status com base no destinatário
        const recipientStatus = {
          recipient: logEntry.recipient,
          success,
          dsn: logEntry.dsn,
          status: logEntry.status,
        };
        emailLog.success = emailLog.success === null ? success : emailLog.success && success;
        emailLog.detail = {
          ...emailLog.detail,
          [logEntry.recipient]: recipientStatus,
        };
        await emailLog.save();
        logger.debug(`EmailLog atualizado para mailId=${sendData.uuid}`);
      } else {
        logger.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
      }
    } catch (err) {
      logger.error(
        `Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`
      );
    }

    if (sendData.results.length === sendData.recipients.length) {
      sendData.resolve(sendData.results);
      this.pendingSends.delete(logEntry.messageId);
    }
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    const recipients: string[] = Array.isArray(to) ? [...to, ...bcc] : [to, ...bcc];

    const messageId = `${uuid}@${emailDomain}`;

    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject,
        html,
        headers: {
          'Message-ID': `<${messageId}>`,
        },
      };

      const info = await this.transporter.sendMail(mailOptions);

      logger.info(`Email sent: ${JSON.stringify(mailOptions)}`);
      logger.debug(`SMTP server response: ${info.response}`);

      // Criar um registro inicial no EmailLog com sucesso = null
      const emailLog = new EmailLog({
        mailId: uuid,
        sendmailQueueId: '', // Pode ser ajustado se necessário
        email: Array.isArray(to) ? to.join(', ') : to,
        message: subject,
        success: null,
        sentAt: new Date(),
      });

      await emailLog.save();
      logger.debug(`EmailLog criado para mailId=${uuid}`);

      const sendPromise = new Promise<RecipientStatus[]>((resolve, reject) => {
        this.pendingSends.set(messageId, {
          uuid,
          recipients,
          results: [],
          resolve,
          reject,
        });

        setTimeout(() => {
          if (this.pendingSends.has(messageId)) {
            const sendData = this.pendingSends.get(messageId)!;
            sendData.reject(
              new Error('Timeout ao capturar status para todos os destinatários.')
            );
            this.pendingSends.delete(messageId);
          }
        }, 60000); // 60 segundos
      });

      const results = await sendPromise;

      const allSuccess = results.every((r) => r.success);

      logger.info(
        `Send results: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(
          results
        )}`
      );

      return {
        mailId: uuid,
        queueId: '', // Ajustar conforme necessário
        recipients: results,
      };
    } catch (error: any) {
      logger.error(`Error sending email: ${error.message}`, error);

      let recipientsStatus: RecipientStatus[] = [];

      // Verifica se o erro contém informações sobre destinatários rejeitados
      if (error.rejected && Array.isArray(error.rejected)) {
        const rejectedSet = new Set(error.rejected);
        const acceptedSet = new Set(error.accepted || []);

        recipientsStatus = recipients.map((recipient) => ({
          recipient,
          success: acceptedSet.has(recipient),
          error: rejectedSet.has(recipient)
            ? 'Rejeitado pelo servidor SMTP.'
            : undefined,
        }));
      } else {
        // Se não houver informações específicas, marca todos como falhados
        recipientsStatus = recipients.map((recipient) => ({
          recipient,
          success: false,
          error: 'Falha desconhecida ao enviar email.',
        }));
      }

      // Registrar o erro no EmailLog
      try {
        const emailLog = new EmailLog({
          mailId: uuid,
          sendmailQueueId: '', // Pode ser ajustado se necessário
          email: Array.isArray(to) ? to.join(', ') : to,
          message: subject,
          success: recipientsStatus.some((r) => r.success),
          detail: recipientsStatus.reduce((acc, curr) => {
            acc[curr.recipient] = { success: curr.success, error: curr.error };
            return acc;
          }, {} as Record<string, any>),
          sentAt: new Date(),
        });

        await emailLog.save();
        logger.debug(`EmailLog criado com erro para mailId=${uuid}`);
      } catch (saveErr) {
        logger.error(
          `Erro ao registrar EmailLog para mailId=${uuid}: ${(saveErr as Error).message}`
        );
      }

      return {
        mailId: uuid,
        queueId: '',
        recipients: recipientsStatus,
      };
    }
  }
}

export default new EmailService();
