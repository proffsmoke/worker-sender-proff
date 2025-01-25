import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import EmailLog from '../models/EmailLog';

dotenv.config();

interface SendEmailParams {
  fromName: string;
  emailDomain: string;
  to: string;
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
  logEntry?: LogEntry; // Adicionado para incluir o log completo
}

interface SendEmailResult {
  queueId: string;
  recipient: RecipientStatus;
}

class EmailService extends EventEmitter {
  private static instance: EmailService;
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private pendingSends: Map<string, RecipientStatus>;
  private uuidResults: Map<string, RecipientStatus[]>;

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
    this.uuidResults = new Map();
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

  private createRecipientStatus(recipient: string, success: boolean, error?: string, queueId?: string): RecipientStatus {
    return {
      recipient,
      success,
      error,
      queueId,
    };
  }

  // EmailService.ts

public async sendEmail(params: SendEmailParams, uuid?: string): Promise<SendEmailResult> {
  const { fromName, emailDomain, to, bcc = [], subject, html, clientName, mailerId } = params;

  const fromEmail = `${fromName.toLowerCase().replace(/\s+/g, '.')}@${emailDomain}`;
  const from = `"${fromName}" <${fromEmail}>`;

  const recipient = to.toLowerCase();

  try {
    const mailOptions = {
      from,
      to: recipient,
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
      - Para: ${recipient}
      - Bcc: ${bcc.join(', ')}
      - QueueId: ${queueId}
    `);

    const recipientStatus = this.createRecipientStatus(recipient, true, undefined, queueId);

    this.pendingSends.set(queueId, recipientStatus);

    if (uuid) {
      if (!this.uuidResults.has(uuid)) {
        this.uuidResults.set(uuid, []);
      }
      this.uuidResults.get(uuid)?.push(recipientStatus);
      logger.info(`Associado queueId ${queueId} ao UUID ${uuid}`);

      // Salvar a associação no EmailLog
      await this.saveQueueIdToEmailLog(queueId, uuid);
    }

    logger.info(`Dados de envio associados com sucesso para queueId=${queueId}.`);

    return {
      queueId,
      recipient: recipientStatus,
    };
  } catch (error: any) {
    logger.error(`Erro ao enviar email: ${error.message}`, error);

    const recipientStatus = this.createRecipientStatus(recipient, false, error.message);
    return {
      queueId: '',
      recipient: recipientStatus,
    };
  }
}

private async saveQueueIdToEmailLog(queueId: string, mailId: string): Promise<void> {
  try {
    logger.info(`Tentando salvar queueId=${queueId} e mailId=${mailId} no EmailLog.`);

    const existingLog = await EmailLog.findOne({ queueId });

    if (!existingLog) {
      const emailLog = new EmailLog({
        mailId, // UUID
        queueId,
        email: 'no-reply@unknown.com', // E-mail padrão
        success: null, // Inicialmente null
        updated: false,
        sentAt: new Date(),
        expireAt: new Date(Date.now() + 30 * 60 * 1000), // Expira em 30 minutos
      });

      await emailLog.save();
      logger.info(`Log salvo no EmailLog: queueId=${queueId}, mailId=${mailId}`);
    } else {
      logger.info(`Log já existe no EmailLog: queueId=${queueId}`);
    }
  } catch (error) {
    logger.error(`Erro ao salvar log no EmailLog:`, error);
  }
}

  private async handleLogEntry(logEntry: LogEntry): Promise<void> {
    const recipientStatus = this.pendingSends.get(logEntry.queueId);
    if (!recipientStatus) {
      logger.warn(`Nenhum dado pendente encontrado para queueId=${logEntry.queueId}`);
      return;
    }

    recipientStatus.success = logEntry.success;
    recipientStatus.logEntry = logEntry; // Adiciona o logEntry ao recipientStatus

    if (!logEntry.success) {
      recipientStatus.error = `Status: ${logEntry.result}`;
      logger.error(`Falha ao enviar para recipient=${recipientStatus.recipient}. Erro: ${logEntry.result}. Log completo: ${JSON.stringify(logEntry)}`);
    } else {
      logger.info(`Resultado atualizado com sucesso para recipient=${recipientStatus.recipient}. Status: ${logEntry.success}. Log completo: ${JSON.stringify(logEntry)}`);
    }

    this.emit('queueProcessed', logEntry.queueId, recipientStatus);
  }

  public async waitForUUIDCompletion(uuid: string): Promise<{
    uuid: string;
    recipients: RecipientStatus[];
    summary: {
      total: number;
      success: number;
      failed: number;
    };
  }> {
    return new Promise((resolve) => {
      const results = this.uuidResults.get(uuid) || [];
  
      const onQueueProcessed = (queueId: string, recipientStatus: RecipientStatus) => {
        // Atualiza o resultado no array de resultados do UUID
        const existingResultIndex = results.findIndex((r) => r.queueId === queueId);
        if (existingResultIndex !== -1) {
          results[existingResultIndex] = recipientStatus; // Atualiza o resultado existente
        } else {
          results.push(recipientStatus); // Adiciona um novo resultado
        }
  
        // Verifica se todos os queueIds foram processados
        const allQueueIdsProcessed = Array.from(this.pendingSends.keys()).every((qId) => 
          !this.uuidResults.get(uuid)?.some((r) => r.queueId === qId)
        );
  
        if (allQueueIdsProcessed) {
          this.removeListener('queueProcessed', onQueueProcessed);
  
          // Cria o resumo consolidado
          const summary = {
            total: results.length,
            success: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
          };
  
          // Retorna o resumo completo
          resolve({
            uuid,
            recipients: results,
            summary,
          });
  
          // Exibe o resumo no log
          logger.info('Resumo Completo:');
          logger.info(`UUID: ${uuid}`);
          logger.info('Recipients:');
          results.forEach((recipient) => {
            logger.info(`- Recipient: ${recipient.recipient}`);
            logger.info(`  Success: ${recipient.success}`);
            logger.info(`  QueueId: ${recipient.queueId}`);
            if (recipient.error) {
              logger.info(`  Error: ${recipient.error}`);
            }
            if (recipient.logEntry) {
              logger.info(`  Log Completo: ${JSON.stringify(recipient.logEntry)}`);
            }
          });
          logger.info('Summary:');
          logger.info(`  Total: ${summary.total}`);
          logger.info(`  Success: ${summary.success}`);
          logger.info(`  Failed: ${summary.failed}`);
        }
      };
  
      this.on('queueProcessed', onQueueProcessed);
    });
  }
}

export default EmailService;