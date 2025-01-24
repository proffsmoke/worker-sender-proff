import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';

dotenv.config();

interface SendEmailParams {
  fromName: string;
  emailDomain: string;
  to: string | string[];
  bcc?: string[];
  subject: string;
  html: string;
  clientName?: string;
  mailerId?: string;
}

interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
  queueId?: string;
}

interface SendEmailResult {
  queueId: string;
  recipients: RecipientStatus[];
}

class EmailService extends EventEmitter {
  private static instance: EmailService;
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private pendingSends: Map<string, { toRecipients: string[]; bccRecipients: string[]; results: RecipientStatus[] }>;
  private uuidResults: Map<string, RecipientStatus[]>; // Mapa para consolidar resultados por UUID

  private constructor(logParser: LogParser) {
    super();
    this.transporter = nodemailer.createTransport({
      host: 'localhost',
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = logParser;
    this.pendingSends = new Map();
    this.uuidResults = new Map(); // Inicializa o mapa de resultados por UUID
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

  private createRecipientsStatus(recipients: string[], success: boolean, error?: string, queueId?: string): RecipientStatus[] {
    return recipients.map((recipient) => ({
      recipient,
      success,
      error,
      queueId,
    }));
  }

  public async sendEmail(params: SendEmailParams, uuid?: string): Promise<SendEmailResult> {
    const { fromName, emailDomain, to, bcc = [], subject, html, clientName, mailerId } = params;

    const fromEmail = `${fromName.toLowerCase().replace(/\s+/g, '.')}@${emailDomain}`;
    const from = `"${fromName}" <${fromEmail}>`;

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

      logger.info(`Preparando para enviar email: ${JSON.stringify(mailOptions)}`);

      const info = await this.transporter.sendMail(mailOptions);

      const queueIdMatch = info.response.match(/queued as\s([A-Z0-9]+)/);
      if (!queueIdMatch || !queueIdMatch[1]) {
        throw new Error('Não foi possível extrair o queueId da resposta');
      }

      const queueId = queueIdMatch[1];
      logger.info(`Email enviado com sucesso! Detalhes: 
        - De: ${from}
        - Para: ${toRecipients.join(', ')}
        - Bcc: ${bccRecipients.join(', ')}
        - QueueId: ${queueId}
      `);

      const recipientsStatus = this.createRecipientsStatus(allRecipients, true, undefined, queueId);

      this.pendingSends.set(queueId, {
        toRecipients,
        bccRecipients,
        results: recipientsStatus,
      });

      if (uuid) {
        if (!this.uuidResults.has(uuid)) {
          this.uuidResults.set(uuid, []);
        }
        // Adiciona os resultados iniciais ao UUID
        this.uuidResults.get(uuid)?.push(...recipientsStatus);
        logger.info(`Associado queueId ${queueId} ao UUID ${uuid}`);
      }

      logger.info(`Dados de envio associados com sucesso para queueId=${queueId}.`);

      return {
        queueId,
        recipients: recipientsStatus,
      };
    } catch (error: any) {
      logger.error(`Erro ao enviar email: ${error.message}`, error);

      return {
        queueId: '',
        recipients: this.createRecipientsStatus(allRecipients, false, error.message),
      };
    }
  }

  private async handleLogEntry(logEntry: LogEntry): Promise<void> {
    const sendData = this.pendingSends.get(logEntry.queueId);
    if (!sendData) {
      logger.warn(`Nenhum dado pendente encontrado para queueId=${logEntry.queueId}`);
      return;
    }

    const success = logEntry.success;
    const recipient = logEntry.email.toLowerCase();

    const recipientIndex = sendData.results.findIndex((r) => r.recipient === recipient);
    if (recipientIndex !== -1) {
      sendData.results[recipientIndex].success = success;

      if (!success) {
        sendData.results[recipientIndex].error = `Status: ${logEntry.result}`;
        logger.error(`Falha ao enviar para recipient=${recipient}. Erro: ${logEntry.result}. Log completo: ${JSON.stringify(logEntry)}`);
      } else {
        logger.info(`Resultado atualizado com sucesso para recipient=${recipient}. Status: ${success}. Log completo: ${JSON.stringify(logEntry)}`);
      }
    } else {
      logger.warn(`Recipient ${recipient} não encontrado nos resultados para queueId=${logEntry.queueId}. Log completo: ${JSON.stringify(logEntry)}`);
    }

    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length;

    if (processedRecipients >= totalRecipients) {
      logger.info(`Todos os recipients processados para queueId=${logEntry.queueId}. Removendo do pendingSends. Status atual: ${JSON.stringify(sendData)}`);
      this.pendingSends.delete(logEntry.queueId);

      // Notificar que o queueId foi processado
      this.emit('queueProcessed', logEntry.queueId, sendData.results);
    }
  }

  public async waitForUUIDCompletion(uuid: string): Promise<RecipientStatus[]> {
    return new Promise((resolve) => {
      const results = this.uuidResults.get(uuid) || [];

      const onQueueProcessed = (queueId: string, queueResults: RecipientStatus[]) => {
        // Atualiza os resultados do UUID com os novos resultados do queueId
        queueResults.forEach((result) => {
          const existingResultIndex = results.findIndex((r) => r.recipient === result.recipient && r.queueId === result.queueId);
          if (existingResultIndex !== -1) {
            results[existingResultIndex] = result; // Atualiza o resultado existente
          } else {
            results.push(result); // Adiciona um novo resultado
          }
        });

        // Verifica se todos os queueIds foram processados
        const allQueueIdsProcessed = Array.from(this.pendingSends.keys()).every((qId) => !this.uuidResults.get(uuid)?.some((r) => r.queueId === qId));
        if (allQueueIdsProcessed) {
          this.removeListener('queueProcessed', onQueueProcessed);
          resolve(results); // Retorna os resultados consolidados
        }
      };

      this.on('queueProcessed', onQueueProcessed);
    });
  }
}

export default EmailService;