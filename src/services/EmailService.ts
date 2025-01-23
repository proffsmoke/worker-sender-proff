import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface SendEmailParams {
  fromName?: string;
  emailDomain: string;
  to: string | string[];
  bcc?: string[];
  subject: string;
  html: string;
  clientName?: string;
}

interface EmailListItem {
  email: string;
  name?: string;
  subject: string;
  template: string;
  clientName?: string;
}

interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
}

interface SendEmailResult {
  queueId: string;
  recipients: RecipientStatus[];
}

class EmailService {
  private static instance: EmailService;
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private pendingSends: Map<
    string,
    {
      toRecipients: string[];
      bccRecipients: string[];
      results: RecipientStatus[];
    }
  > = new Map();

  private uuidQueueMap: Map<string, string[]> = new Map(); // Mapeia UUIDs para queueIds
  private uuidResultsMap: Map<string, RecipientStatus[]> = new Map(); // Mapeia UUIDs para resultados
  private lastTestEmailTime: number = 0; // Timestamp do último email de teste enviado

  private constructor(logParser: LogParser) {
    this.transporter = nodemailer.createTransport({
      host: 'localhost',
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = logParser;
    this.logParser.on('log', this.handleLogEntry.bind(this));

    // Envia um email de teste ao iniciar
    this.sendTestEmailIfBlocked();
  }

  public static getInstance(logParser?: LogParser): EmailService {
    if (!EmailService.instance && logParser) {
      EmailService.instance = new EmailService(logParser);
    } else if (!EmailService.instance) {
      throw new Error('EmailService não foi inicializado. Forneça um LogParser.');
    }
    return EmailService.instance;
  }

  public async sendEmailList(params: { emailDomain: string; emailList: EmailListItem[] }, uuid?: string): Promise<SendEmailResult[]> {
    const { emailDomain, emailList } = params;
  
    const results = await Promise.all(
      emailList.map(async (emailItem) => {
        return this.sendEmail(
          {
            fromName: emailItem.name || 'No-Reply',
            emailDomain,
            to: emailItem.email,
            bcc: [],
            subject: emailItem.subject,
            html: emailItem.template,
            clientName: emailItem.clientName,
          },
          uuid
        );
      })
    );
  
    return results;
  }
  
  private async sendTestEmailIfBlocked() {
    const now = Date.now();
    if (now - this.lastTestEmailTime >= 240000) { // 4 minutos em milissegundos
      try {
        const testEmail = process.env.MAILER_NOREPLY_EMAIL || 'no-reply@outlook.com';
        await this.sendEmail({
          emailDomain: 'test.com',
          to: testEmail,
          subject: 'Test Email',
          html: '<p>This is a test email.</p>',
        });

        logger.info('Email de teste enviado com sucesso.');
        this.lastTestEmailTime = now;
      } catch (error) {
        logger.error('Erro ao enviar email de teste:', error);
      }
    }
  }

  public async sendEmail(params: SendEmailParams, uuid?: string): Promise<SendEmailResult> {
    const { fromName = 'No-Reply', emailDomain, to, bcc = [], subject, html, clientName } = params;
    const from = `"${fromName}" <${process.env.MAILER_NOREPLY_EMAIL || 'no-reply@outlook.com'}>`;

    const toRecipients: string[] = Array.isArray(to) ? to.map((r) => r.toLowerCase()) : [to.toLowerCase()];
    const bccRecipients: string[] = bcc.map((r) => r.toLowerCase());
    const allRecipients: string[] = [...toRecipients, ...bccRecipients];

    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject: clientName ? `[${clientName}] ${subject}` : subject,
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);

      const queueIdMatch = info.response.match(/queued as\s([A-Z0-9]+)/);
      if (!queueIdMatch || !queueIdMatch[1]) {
        throw new Error('Não foi possível extrair o queueId da resposta');
      }

      const queueId = queueIdMatch[1];
      logger.info(`queueId extraído com sucesso: ${queueId}`);
      logger.info(`Email enviado!`);
      logger.info(`queueId (messageId do servidor): queued as ${queueId}`);
      logger.info(`Info completo: `, info);

      const recipientsStatus: RecipientStatus[] = allRecipients.map((recipient) => ({
        recipient,
        success: true,
      }));

      this.pendingSends.set(queueId, {
        toRecipients,
        bccRecipients,
        results: recipientsStatus,
      });

      if (uuid) {
        if (!this.uuidQueueMap.has(uuid)) {
          this.uuidQueueMap.set(uuid, []);
        }
        this.uuidQueueMap.get(uuid)?.push(queueId);
      }

      return {
        queueId,
        recipients: recipientsStatus,
      };
    } catch (error: any) {
      logger.error(`Erro ao enviar email: ${error.message}`, error);

      const recipientsStatus: RecipientStatus[] = allRecipients.map((recipient) => ({
        recipient,
        success: false,
        error: error.message,
      }));

      return {
        queueId: '',
        recipients: recipientsStatus,
      };
    }
  }

  private handleLogEntry(logEntry: LogEntry) {
    const sendData = this.pendingSends.get(logEntry.queueId);
    if (!sendData) {
      logger.warn(`Nenhum dado encontrado no pendingSends para queueId=${logEntry.queueId}`);
      return;
    }

    const success = logEntry.success;
    const recipient = logEntry.email.toLowerCase();

    const recipientIndex = sendData.results.findIndex((r) => r.recipient === recipient);
    if (recipientIndex !== -1) {
      sendData.results[recipientIndex].success = success;
      if (!success) {
        sendData.results[recipientIndex].error = `Status: ${logEntry.result}`;
      }
      logger.info(`Resultado atualizado para recipient=${recipient}:`, sendData.results[recipientIndex]);
    } else {
      logger.warn(`Recipient ${recipient} não encontrado nos resultados para queueId=${logEntry.queueId}`);
    }

    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length;

    if (processedRecipients >= totalRecipients) {
      logger.info(`Todos os recipients processados para queueId=${logEntry.queueId}. Removendo do pendingSends.`);
      this.pendingSends.delete(logEntry.queueId);

      for (const [uuid, queueIds] of this.uuidQueueMap.entries()) {
        if (queueIds.includes(logEntry.queueId)) {
          const allProcessed = queueIds.every((qId) => !this.pendingSends.has(qId));
          if (allProcessed) {
            logger.info(`Chamando checkAndSendResults para UUID=${uuid}`);
            this.checkAndSendResults(uuid);
          }
        }
      }
    }
  }

  private async checkAndSendResults(uuid: string, mockMode: boolean = true) {
    const queueIds = this.uuidQueueMap.get(uuid) || [];
    const allResults: RecipientStatus[] = [];

    for (const queueId of queueIds) {
      const sendData = this.pendingSends.get(queueId);
      if (sendData) {
        allResults.push(...sendData.results);
      }
    }

    if (allResults.length > 0) {
      logger.info(`Dados de resultado para o UUID ${uuid}:`, JSON.stringify(allResults, null, 2));

      if (mockMode) {
        logger.info('Modo mock ativado. Resultados não serão enviados para a API.');
        const mockResponse = {
          status: 200,
          data: {
            success: true,
            message: 'Resultados recebidos com sucesso (modo mock).',
            results: allResults,
          },
        };
        logger.info('Resposta simulada:', JSON.stringify(mockResponse.data, null, 2));
        return mockResponse;
      } else {
        try {
          const response = await axios.post(
            'https://result.com/api/results',
            {
              uuid,
              results: allResults,
            },
            {
              timeout: 10000,
            }
          );
          logger.info(`Resultados enviados para o UUID: ${uuid}`, response.data);
          return response;
        } catch (error: any) {
          logger.error(`Erro ao enviar resultados para o UUID: ${uuid}`, error.message);
          throw error;
        }
      }
    } else {
      logger.warn(`Nenhum resultado encontrado para o UUID: ${uuid}`);
      return null;
    }
  }
}

export default EmailService;