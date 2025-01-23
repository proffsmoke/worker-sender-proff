import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
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

  constructor(logParser: LogParser) {
    this.transporter = nodemailer.createTransport({
      host: 'localhost',  // Configura para usar o Postfix local
      port: 25,           // Porta do servidor SMTP local (geralmente é 25 no Postfix)
      secure: false,
      tls: { rejectUnauthorized: false },  // Permite conexões TLS não verificadas
    });

    this.logParser = logParser;
    this.logParser.on('log', this.handleLogEntry.bind(this));  // Escuta os logs em tempo real
    this.logParser.startMonitoring();  // Inicia o monitoramento do log
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
        const extractedQueueId = queueId[1];
        logger.info(`queueId extraído com sucesso: ${extractedQueueId}`);
      } else {
        throw new Error('Não foi possível extrair o queueId da resposta');
      }

      // Log de depuração
      logger.info(`Email enviado!`);
      logger.info(`queueId (messageId do servidor): ${queueId}`);
      logger.info(`Info completo: `, info);

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

  public async awaitEmailResults(queueId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout excedido para queueId ${queueId}`));
      }, 60000); // Timeout de 60 segundos

      this.logParser.once('log', (logEntry) => {
        logger.info(`Comparando queueId recebido: ${logEntry.queueId} com ${queueId}`);
        if (logEntry.queueId === queueId) {
          logger.info('Correspondência encontrada, resolvendo...');
          clearTimeout(timeout);
          resolve();
        } else {
          logger.info(`QueueId não corresponde: ${logEntry.queueId} != ${queueId}`);
        }
      });
    });
  }
}

const logParser = new LogParser('/var/log/mail.log');
export default new EmailService(logParser);
