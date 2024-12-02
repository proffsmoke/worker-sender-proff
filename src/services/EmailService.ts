import nodemailer from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import LogParser from '../log-parser';
import { v4 as uuidv4 } from 'uuid';

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
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private pendingSends: Map<string, { uuid: string; recipients: string[]; results: RecipientStatus[]; resolve: Function; reject: Function }> = new Map();

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: '127.0.0.1',
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = new LogParser('/var/log/mail.log');
    this.logParser.startMonitoring();

    // Escutar os eventos de log
    this.logParser.on('log', this.handleLogEntry.bind(this));
  }

  private handleLogEntry(logEntry: { queueId: string; recipient: string; status: string; messageId: string }) {
    // Verificar se há algum envio pendente com este Message-ID
    for (const [messageId, sendData] of this.pendingSends.entries()) {
      if (logEntry.messageId === messageId) {
        const success = logEntry.status.toLowerCase() === 'sent';

        // Atualizar o resultado para o destinatário
        sendData.results.push({
          recipient: logEntry.recipient,
          success,
        });

        logger.info(`Atualizado status para ${logEntry.recipient}: ${success ? 'Enviado' : 'Falha'}`);

        // Verificar se todos os destinatários foram processados
        if (sendData.results.length === sendData.recipients.length) {
          // Resolver a promessa com os resultados
          sendData.resolve(sendData.results);

          // Remover o envio pendente
          this.pendingSends.delete(messageId);
        }
      }
    }
  }

  async sendEmail(params: SendEmailParams): Promise<{ mailId: string; queueId: string; recipients: RecipientStatus[] }> {
    const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    // Combinar 'to' e 'bcc' em uma lista completa de destinatários
    const recipients: string[] = Array.isArray(to) ? [...to, ...bcc] : [to, ...bcc];

    // Gerar um Message-ID único usando o UUID
    const messageId = `${uuid}@${emailDomain}`;

    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject,
        html,
        headers: {
          'Message-ID': `<${messageId}>`,
        },
      };

      const info = await this.transporter.sendMail(mailOptions);

      logger.info(`Email enviado: ${JSON.stringify(mailOptions)}`);
      logger.debug(`Resposta do servidor SMTP: ${info.response}`);

      // Preparar a promessa para aguardar os resultados dos destinatários
      const sendPromise = new Promise<RecipientStatus[]>((resolve, reject) => {
        // Adicionar ao mapa de envios pendentes
        this.pendingSends.set(messageId, {
          uuid,
          recipients,
          results: [],
          resolve,
          reject,
        });

        // Definir um timeout para evitar espera indefinida
        setTimeout(() => {
          if (this.pendingSends.has(messageId)) {
            const sendData = this.pendingSends.get(messageId)!;
            sendData.reject(new Error('Timeout ao capturar status para todos os destinatários.'));
            this.pendingSends.delete(messageId);
          }
        }, 10000); // 10 segundos
      });

      const results = await sendPromise;

      // Verificar se todos os envios foram bem-sucedidos
      const allSuccess = results.every((r) => r.success);

      logger.info(`Resultado do envio: MailID: ${uuid}, Message-ID: ${messageId}, Destinatários: ${JSON.stringify(results)}`);

      return {
        mailId: uuid,
        queueId: '', // Pode ser omitido ou ajustado conforme necessário
        recipients: results,
      };
    } catch (error) {
      logger.error(`Erro ao enviar e-mail: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
      throw error;
    }
  }
}

export default new EmailService();
