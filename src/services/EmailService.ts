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
      host: 'localhost',  // Configura para usar o Postfix local
      port: 25,           // Porta do servidor SMTP local (geralmente é 25 no Postfix)
      secure: false,
      tls: { rejectUnauthorized: false },  // Permite conexões TLS não verificadas
    });

    this.logParser = new LogParser('/var/log/mail.log');
    this.logParser.startMonitoring();
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
      uuid: uuidv4(),
    };

    return this.sendEmail(testEmailParams);
  }

  private async handleLogEntry(logEntry: LogEntry) {
    const sendData = this.pendingSends.get(logEntry.queueId);  // Agora usa queueId para associar
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

    // Atualiza o EmailLog
    try {
        const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec(); // Usa uuid aqui
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
        this.pendingSends.delete(logEntry.queueId);  // Remove usando o queueId
    }
}

public async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
  const from = `"${fromName}" <no-reply@${emailDomain}>`;

  const toRecipients: string[] = Array.isArray(to) ? to.map((r) => r.toLowerCase()) : [to.toLowerCase()];
  const bccRecipients: string[] = bcc.map((r) => r.toLowerCase());
  const allRecipients: string[] = [...toRecipients, ...bccRecipients];

  const messageId = `${uuid}@${emailDomain}`; // Usa o uuid para definir o messageId

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

      // Log de todos os dados para depuração
      console.log(`Email enviado!`);
      console.log(`mailId (UUID gerado): ${uuid}`);
      console.log(`queueId (messageId do servidor): ${info.messageId}`);
      console.log(`info completo: `, info); // Adiciona o log completo de 'info'

      const recipientsStatus: RecipientStatus[] = allRecipients.map((recipient) => ({
          recipient,
          success: true, // Assume sucesso inicialmente
      }));

      // Armazena o uuid juntamente com o queueId para associar mais tarde
      this.pendingSends.set(info.messageId || messageId, {
          uuid,
          toRecipients,
          bccRecipients,
          results: recipientsStatus,
      });

      // Espera o queueId do Postfix nos logs
      await this.awaitEmailResults(info.messageId || messageId);

      return {
          mailId: uuid,
          queueId: info.messageId || '',  // Use messageId, que é agora o 'queueId'
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
      }, 30000); // Timeout de 30 segundos

      this.logParser.once('log', (logEntry) => {
          console.log(`Comparando queueId recebido: ${logEntry.queueId} com ${queueId}`); // Adicionando log para depuração
          if (logEntry.queueId === queueId) {
              console.log('Correspondência encontrada, resolvendo...'); // Confirma quando há correspondência
              clearTimeout(timeout);
              resolve();
          } else {
              console.log(`QueueId não corresponde: ${logEntry.queueId} != ${queueId}`); // Log de falha na correspondência
          }
      });
  });
}


}

export default new EmailService();
