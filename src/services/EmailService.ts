// src/services/EmailService.ts

import nodemailer from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import LogParser from '../log-parser';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';

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
      toRecipients: string[];
      bccRecipients: string[];
      results: RecipientStatus[];
      resolve: (value: RecipientStatus[]) => void;
      reject: (reason?: any) => void;
    }
  > = new Map();

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host, // Utilize a configuração de SMTP
      port: config.smtp.port,
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
    logger.debug(`Processing Log Entry: ${JSON.stringify(logEntry)}`);

    // Remover os < e > do messageId
    const cleanMessageId = logEntry.messageId.replace(/[<>]/g, '');

    const sendData = this.pendingSends.get(cleanMessageId);
    if (!sendData) {
      logger.warn(`No pending send found for Message-ID: ${cleanMessageId}`);
      return;
    }

    const success = logEntry.dsn.startsWith('2');

    // Normalizar o endereço de email para minúsculas
    const recipient = logEntry.recipient.toLowerCase();
    let isToRecipient = sendData.toRecipients.includes(recipient);

    logger.debug(`Is to recipient: ${isToRecipient} for recipient: ${recipient}`);

    if (isToRecipient) {
      // Atualizar o campo 'success' do EmailLog
      try {
        const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec();

        if (emailLog) {
          emailLog.success = success;
          await emailLog.save();
          logger.debug(`EmailLog 'success' atualizado para mailId=${sendData.uuid}`);
        } else {
          logger.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
        }
      } catch (err) {
        logger.error(
          `Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`
        );
      }

      // Adicionar o destinatário 'to' ao array de resultados
      sendData.results.push({
        recipient: recipient,
        success: success
      });
    } else {
      // Atualizar o 'detail' do EmailLog
      sendData.results.push({
        recipient: recipient,
        success,
      });

      try {
        const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec();

        if (emailLog) {
          // Atualizar o status com base no destinatário em 'bcc'
          const recipientStatus = {
            recipient: recipient,
            success,
            dsn: logEntry.dsn,
            status: logEntry.status,
          };
          emailLog.detail = {
            ...emailLog.detail,
            [recipient]: recipientStatus,
          };
          await emailLog.save();
          logger.debug(`EmailLog 'detail' atualizado para mailId=${sendData.uuid}`);
        } else {
          logger.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
        }
      } catch (err) {
        logger.error(
          `Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`
        );
      }
    }

    // Verificar se todos os destinatários foram processados
    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length + (success && isToRecipient ? 1 : 0);

    logger.debug(`Total Recipients: ${totalRecipients}, Processed Recipients: ${processedRecipients}`);

    if (processedRecipients >= totalRecipients) {
      sendData.resolve(sendData.results);
      this.pendingSends.delete(cleanMessageId);
      logger.debug(`All recipients processed for mailId=${sendData.uuid}`);
    }
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    // Normalizar os endereços de email para minúsculas
    const toRecipients: string[] = Array.isArray(to) ? to.map(r => r.toLowerCase()) : [to.toLowerCase()];
    const bccRecipients: string[] = bcc.map(r => r.toLowerCase());
    const allRecipients: string[] = [...toRecipients, ...bccRecipients];

    const messageId = `${uuid}@${emailDomain}`;
    logger.debug(`Setting Message-ID: <${messageId}> for mailId=${uuid}`);

    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject,
        html,
        messageId: `<${messageId}>`, // Use a propriedade 'messageId' diretamente
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

      // Rastrear destinatários 'to' e 'bcc' separadamente
      const sendPromise = new Promise<RecipientStatus[]>((resolve, reject) => {
        this.pendingSends.set(messageId, {
          uuid,
          toRecipients,
          bccRecipients,
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
            logger.warn(`Timeout: Failed to capture status for mailId=${uuid}`);
          }
        }, 60000); // 60 segundos
      });

      const results = await sendPromise;

      const allSuccess = results.every((r) => r.success) && emailLog.success;

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
        const rejectedSet = new Set(error.rejected.map((r: string) => r.toLowerCase()));
        const acceptedSet = new Set((error.accepted || []).map((r: string) => r.toLowerCase()));

        recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
          recipient,
          success: acceptedSet.has(recipient),
          error: rejectedSet.has(recipient)
            ? 'Rejeitado pelo servidor SMTP.'
            : undefined,
        }));
      } else {
        // Se não houver informações específicas, marca todos como falhados
        recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
          recipient,
          success: false,
          error: 'Falha desconhecida ao enviar email.',
        }));
      }

      // Registrar o erro no EmailLog
      try {
        const emailLog = await EmailLog.findOne({ mailId: uuid }).exec();

        if (emailLog) {
          // Atualizar o status com base nos destinatários
          const successAny = recipientsStatus.some((r) => r.success);
          emailLog.success = successAny;

          recipientsStatus.forEach((r) => {
            emailLog.detail[r.recipient] = {
              recipient: r.recipient,
              success: r.success,
              error: r.error,
              dsn: '',
              status: r.success ? 'sent' : 'failed',
            };
          });

          await emailLog.save();
          logger.debug(`EmailLog atualizado com erro para mailId=${uuid}`);
        } else {
          logger.warn(`EmailLog não encontrado para mailId=${uuid}`);
        }
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
