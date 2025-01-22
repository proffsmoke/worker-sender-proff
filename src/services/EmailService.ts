import nodemailer from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';

interface SendEmailParams {
  fromName: string;
  emailDomain: string;
  to: string | string[];
  bcc?: string[];
  subject: string;
  html: string;
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

  private version: string = '1.0.0'; // Versão do serviço
  private createdAt: Date = new Date(); // Data de criação do serviço
  private status: string = 'health'; // Status do serviço
  private blockReason: string | null = null; // Razão do bloqueio, se houver

  constructor(logParser: LogParser) {
    this.transporter = nodemailer.createTransport({
      host: 'localhost',  // Configura para usar o Postfix local
      port: 25,           // Porta do servidor SMTP local (geralmente é 25 no Postfix)
      secure: false,
      tls: { rejectUnauthorized: false },  // Permite conexões TLS não verificadas
    });

    this.logParser = logParser;
    this.logParser.on('log', this.handleLogEntry.bind(this));
  }

  public getVersion(): string {
    return this.version;
  }

  public getCreatedAt(): Date {
    return this.createdAt;
  }

  public getStatus(): string {
    return this.status;
  }

  public getBlockReason(): string | null {
    return this.blockReason;
  }

  public blockMailer(blockType: 'blocked_temporary' | 'blocked_permanently', reason: string): void {
    this.status = blockType;
    this.blockReason = reason;
    logger.warn(`Mailer bloqueado com status: ${blockType}. Razão: ${reason}`);
  }

  public unblockMailer(): void {
    this.status = 'health';
    this.blockReason = null;
    logger.info('Mailer desbloqueado.');
  }

  public async sendInitialTestEmail(): Promise<SendEmailResult> {
    const testEmailParams: SendEmailParams = {
      fromName: 'Mailer Test',
      emailDomain: 'outlook.com',
      to: 'no-reply@outlook.com',
      subject: 'Email de Teste Inicial',
      html: '<p>Este é um email de teste inicial para verificar o funcionamento do Mailer.</p>',
    };

    return this.sendEmail(testEmailParams);
  }

  private async handleLogEntry(logEntry: LogEntry) {
    const sendData = this.pendingSends.get(logEntry.queueId);
    if (!sendData) {
      return;
    }

    const success = logEntry.success;
    const recipient = logEntry.email.toLowerCase();

    // Atualiza o status do destinatário
    const recipientIndex = sendData.results.findIndex((r) => r.recipient === recipient);
    if (recipientIndex !== -1) {
      sendData.results[recipientIndex].success = success;
      if (!success) {
        sendData.results[recipientIndex].error = `Status: ${logEntry.result}`;
      }
    }

    // Remove do pendingSends se todos os destinatários tiverem um resultado
    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length;

    if (processedRecipients >= totalRecipients) {
      this.pendingSends.delete(logEntry.queueId);
    }
  }

  public async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { fromName, emailDomain, to, bcc = [], subject, html } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    const toRecipients: string[] = Array.isArray(to) ? to.map((r) => r.toLowerCase()) : [to.toLowerCase()];
    const bccRecipients: string[] = bcc.map((r) => r.toLowerCase());
    const allRecipients: string[] = [...toRecipients, ...bccRecipients];

    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject,
        html,
      };

      // Envia o email
      const info = await this.transporter.sendMail(mailOptions);

      // Extrai o queueId da resposta do servidor
      const queueId = info.response.match(/queued as\s([A-Z0-9]+)/);
      if (queueId && queueId[1]) {
        // Extrai o queueId corretamente
        const extractedQueueId = queueId[1];
        logger.info(`queueId extraído com sucesso: ${extractedQueueId}`);
      } else {
        throw new Error('Não foi possível extrair o queueId da resposta');
      }

      // Log de depuração
      console.log(`Email enviado!`);
      console.log(`queueId (messageId do servidor): ${queueId}`);
      console.log(`info completo: `, info);

      const recipientsStatus: RecipientStatus[] = allRecipients.map((recipient) => ({
        recipient,
        success: true, // Assume sucesso inicialmente
      }));

      // Armazena o queueId para monitoramento
      this.pendingSends.set(queueId[1], {
        toRecipients,
        bccRecipients,
        results: recipientsStatus,
      });

      return {
        queueId: queueId[1],
        recipients: recipientsStatus,
      };
    } catch (error: any) {
      logger.error(`Error sending email: ${error.message}`, error);

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

  public async awaitEmailResults(queueId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout exceeded for queueId ${queueId}`));
      }, 60000); // Timeout de 60 segundos

      this.logParser.once('log', (logEntry) => {
        console.log(`Comparando queueId recebido: ${logEntry.queueId} com ${queueId}`);
        if (logEntry.queueId === queueId) {
          console.log('Correspondência encontrada, resolvendo...');
          clearTimeout(timeout);
          resolve();
        } else {
          console.log(`QueueId não corresponde: ${logEntry.queueId} != ${queueId}`);
        }
      });
    });
  }
}

const logParser = new LogParser('/var/log/mail.log');
export default new EmailService(logParser);
