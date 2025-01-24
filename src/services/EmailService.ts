import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
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

interface RecipientStatus {
  recipient: string;
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

      // Associar imediatamente o queueId ao UUID
      if (uuid) {
        this.stateManager.addQueueIdToUuid(uuid, queueId); // Garante que o queueId seja associado corretamente
        logger.info(`Associado queueId ${queueId} ao UUID ${uuid}`);
      }

      // Adicionar o queueId no pendingSends
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

      // Associar o queueId ao mailId
      this.stateManager.addQueueIdToMailId(mailId, queueId);

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

  private handleLogEntry(logEntry: LogEntry): void {
    logger.info(`Log recebido para queueId=${logEntry.queueId}: ${JSON.stringify(logEntry)}`);
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

      // Atualiza o status do queueId com base no log
      this.stateManager.updateQueueIdStatus(logEntry.queueId, success);

      // Verifica se há uuid associado ao queueId
      const uuid = this.stateManager.getUuidByQueueId(logEntry.queueId);
      if (uuid && this.stateManager.isUuidProcessed(uuid)) {
        const results = this.stateManager.consolidateResultsByUuid(uuid);
        if (results) {
          logger.info(`Todos os queueIds para uuid=${uuid} foram processados. Resultados consolidados:`, results);
          this.consolidateAndSendResults(uuid, results);
        }
      }
    }
  }

  private async consolidateAndSendResults(uuid: string, results: RecipientStatus[]): Promise<void> {
    const allSuccess = results.every((result) => result.success);
    logger.info(`Resultados consolidados para uuid=${uuid}:`, results);
    logger.info(`Todos os emails foram enviados com sucesso? ${allSuccess}`);

    // Aqui você pode enviar os resultados consolidados para uma API, banco de dados, etc.
    // Exemplo:
    // await this.sendResultsToApi(uuid, results);
  }
}

export default EmailService;
