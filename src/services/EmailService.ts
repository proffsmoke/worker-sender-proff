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
    }
  > = new Map();

  private version: string = '1.0.0'; // Versão do serviço
  private createdAt: Date = new Date(); // Data de criação do serviço
  private status: string = 'health'; // Status do serviço
  private blockReason: string | null = null; // Razão do bloqueio, se houver

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = new LogParser('/var/log/mail.log');
    this.logParser.startMonitoring();

    // Escuta eventos de log
    this.logParser.on('log', this.handleLogEntry.bind(this));
  }

  // Métodos adicionais para suportar as chamadas em outros arquivos
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
      uuid: uuidv4(),
    };

    return this.sendEmail(testEmailParams);
  }

  private async handleLogEntry(logEntry: LogEntry) {
    const sendData = this.pendingSends.get(logEntry.queueId);  // Agora usamos o queueId
    if (!sendData) {
      return;
    }
  
    const success = logEntry.success; // Usa o campo 'success' do LogEntry
    const recipient = logEntry.email.toLowerCase(); // Usa o campo 'email' do LogEntry
  
    // Atualiza o status do destinatário
    const recipientIndex = sendData.results.findIndex((r) => r.recipient === recipient);
    if (recipientIndex !== -1) {
      sendData.results[recipientIndex].success = success;
      if (!success) {
        sendData.results[recipientIndex].error = `Status: ${logEntry.result}`;
      }
    }
  
    // Atualiza o EmailLog
    try {
      const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec();
      if (emailLog) {
        emailLog.success = sendData.results.every((r) => r.success);
        await emailLog.save();
      }
    } catch (err) {
      logger.error(`Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`);
    }
  
    // Remove do pendingSends se todos os destinatários tiverem um resultado
    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length;
  
    if (processedRecipients >= totalRecipients) {
      this.pendingSends.delete(logEntry.queueId);  // Remover usando o queueId
    }
  }
  

  public async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;
  
    const toRecipients: string[] = Array.isArray(to) ? to.map((r) => r.toLowerCase()) : [to.toLowerCase()];
    const bccRecipients: string[] = bcc.map((r) => r.toLowerCase());
    const allRecipients: string[] = [...toRecipients, ...bccRecipients];
  
    const messageId = `${uuid}@${emailDomain}`;
    const isTestEmail = fromName === 'Mailer Test' && subject === 'Email de Teste Inicial';
  
    if (isTestEmail) {
      logger.debug(`Setting Message-ID: <${messageId}> for mailId=${uuid}`);
    }
  
    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject,
        html,
        messageId: `<${messageId}>`,
      };
  
      // Envia o email
      const info = await this.transporter.sendMail(mailOptions);
      if (isTestEmail) {
        logger.info(`Email sent: ${JSON.stringify(mailOptions)}`);
        logger.debug(`SMTP server response: ${info.response}`);
      }
  
      // Cria o resultado imediatamente após o envio
      const recipientsStatus: RecipientStatus[] = allRecipients.map((recipient) => ({
        recipient,
        success: true, // Assume sucesso inicialmente
      }));
  
      // Registra o envio no pendingSends para atualização posterior
      this.pendingSends.set(info.messageId || messageId, {
        uuid,
        toRecipients,
        bccRecipients,
        results: recipientsStatus,
      });
  
      // Retorna o resultado imediatamente
      return {
        mailId: uuid,
        queueId: info.messageId || '',
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
        mailId: uuid,
        queueId: '',
        recipients: recipientsStatus,
      };
    }
  }

  public async awaitEmailResults(queueId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout exceeded for queueId ${queueId}`));
      }, 30000); // Timeout de 30 segundos, você pode ajustar conforme necessário
  
      this.logParser.once('log', (logEntry) => {
        if (logEntry.queueId === queueId) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  }
  
  
}

export default new EmailService();