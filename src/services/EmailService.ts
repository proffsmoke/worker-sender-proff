import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import StateManager from './StateManager';

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
  name?: string;
  success: boolean;
  error?: string;
  queueId?: string;
  mailId?: string;
}

interface SendEmailResult {
  queueId: string;
  mailId: string;
  recipients: RecipientStatus[];
}

class EmailService {
  private static instance: EmailService;
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private stateManager: StateManager;

  private constructor(logParser: LogParser) {
    this.transporter = nodemailer.createTransport({
      host: 'localhost',
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = logParser;
    this.stateManager = new StateManager();
    this.logParser.on('log', this.handleLogEntry.bind(this));
  }

  public static getInstance(logParser?: LogParser): EmailService {
    if (!EmailService.instance && logParser) {
      EmailService.instance = new EmailService(logParser);
    } else if (!EmailService.instance) {
      throw new Error('EmailService não foi inicializado. Forneça um LogParser.');
    }
    return EmailService.instance;
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
      const mailId = info.messageId;

      logger.info(`queueId extraído com sucesso: ${queueId}`);
      logger.info(`Email enviado!`);
      logger.info(`queueId (messageId do servidor): queued as ${queueId}`);
      logger.info(`Info completo: `, info);

      const recipientsStatus: RecipientStatus[] = allRecipients.map((recipient) => ({
        recipient,
        success: true,
        queueId,
        mailId,
      }));

      this.stateManager.addPendingSend(queueId, {
        toRecipients,
        bccRecipients,
        results: recipientsStatus,
      });

      if (uuid) {
        this.stateManager.addQueueIdToUuid(uuid, queueId);
      }

      return {
        queueId,
        mailId,
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
        mailId: '',
        recipients: recipientsStatus,
      };
    }
  }

  public async sendEmailList(
    params: { emailDomain: string; emailList: EmailListItem[] },
    uuid?: string
  ): Promise<SendEmailResult[]> {
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

  private handleLogEntry(logEntry: LogEntry): void {
    const sendData = this.stateManager.getPendingSend(logEntry.queueId);
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
      this.stateManager.deletePendingSend(logEntry.queueId);

      // Itera sobre todos os UUIDs no uuidQueueMap
      for (const [currentUuid, queueIds] of this.stateManager.getUuidQueueMap().entries()) {
        if (queueIds.includes(logEntry.queueId)) {
          const allProcessed = queueIds.every((qId: string) => !this.stateManager.getPendingSend(qId));
          if (allProcessed) {
            logger.info(`Chamando checkAndSendResults para UUID=${currentUuid}`);
            this.checkAndSendResults(currentUuid);
          }
        }
      }
    }
  }

  private async checkAndSendResults(uuid: string, mockMode: boolean = true): Promise<any> {
    const queueIds = this.stateManager.getQueueIdsByUuid(uuid) || [];
    const allResults: RecipientStatus[] = [];

    for (const queueId of queueIds) {
      const sendData = this.stateManager.getPendingSend(queueId);
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