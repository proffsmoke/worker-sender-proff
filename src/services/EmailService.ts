import nodemailer from 'nodemailer';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser';
import axios from 'axios';

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

  private constructor(logParser: LogParser) {
    this.transporter = nodemailer.createTransport({
      host: 'localhost',
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = logParser;
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
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

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

      const queueId = info.response.match(/queued as\s([A-Z0-9]+)/);
      if (queueId && queueId[1]) {
        logger.info(`queueId extraído com sucesso: ${queueId[1]}`);
      } else {
        throw new Error('Não foi possível extrair o queueId da resposta');
      }

      logger.info(`Email enviado!`);
      logger.info(`queueId (messageId do servidor): ${queueId}`);
      logger.info(`Info completo: `, info);

      const recipientsStatus: RecipientStatus[] = allRecipients.map((recipient) => ({
        recipient,
        success: true,
      }));

      this.pendingSends.set(queueId[1], {
        toRecipients,
        bccRecipients,
        results: recipientsStatus,
      });

      if (uuid) {
        if (!this.uuidQueueMap.has(uuid)) {
          this.uuidQueueMap.set(uuid, []);
        }
        this.uuidQueueMap.get(uuid)?.push(queueId[1]);
      }

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

  public async sendEmailList(params: { emailDomain: string; emailList: EmailListItem[] }, uuid?: string): Promise<SendEmailResult[]> {
    const { emailDomain, emailList } = params;

    const results = await Promise.all(
      emailList.map(async (emailItem) => {
        return this.sendEmail({
          fromName: emailItem.name || 'No-Reply',
          emailDomain,
          to: emailItem.email,
          bcc: [],
          subject: emailItem.subject,
          html: emailItem.template,
          clientName: emailItem.clientName,
        }, uuid);
      })
    );

    return results;
  }

  private async checkAndSendResults(uuid: string, mockMode: boolean = true) {
    const queueIds = this.uuidQueueMap.get(uuid) || [];
    const allResults: RecipientStatus[] = [];
  
    // Coletar todos os resultados associados ao UUID
    for (const queueId of queueIds) {
      const sendData = this.pendingSends.get(queueId);
      if (sendData) {
        allResults.push(...sendData.results);
      }
    }
  
    // Verificar se há resultados para enviar
    if (allResults.length > 0) {
      logger.info(`Dados de resultado para o UUID ${uuid}:`, JSON.stringify(allResults, null, 2));
  
      if (mockMode) {
        // Modo mock: exibir os resultados e simular uma resposta
        logger.info('Modo mock ativado. Resultados não serão enviados para a API.');
  
        // Simular uma resposta bem-sucedida
        const mockResponse = {
          status: 200,
          data: {
            success: true,
            message: 'Resultados recebidos com sucesso (modo mock).',
            results: allResults,
          },
        };
  
        logger.info('Resposta simulada:', JSON.stringify(mockResponse.data, null, 2));
  
        // Limpar os dados associados ao UUID após o mock
        this.uuidQueueMap.delete(uuid);
        for (const queueId of queueIds) {
          this.pendingSends.delete(queueId);
        }
  
        return mockResponse;
      } else {
        // Modo real: enviar os resultados para a API
        try {
          const response = await axios.post(
            'https://result.com/api/results',
            {
              uuid,
              results: allResults,
            },
            {
              timeout: 10000, // Timeout de 10 segundos
            }
          );
  
          logger.info(`Resultados enviados para o UUID: ${uuid}`, response.data);
  
          // Limpar os dados associados ao UUID após o envio bem-sucedido
          this.uuidQueueMap.delete(uuid);
          for (const queueId of queueIds) {
            this.pendingSends.delete(queueId);
          }
  
          return response;
        } catch (error: any) {
          logger.error(`Erro ao enviar resultados para o UUID: ${uuid}`, error.message);
          if (error.response) {
            logger.error(`Resposta da API: ${JSON.stringify(error.response.data)}`);
          }
          throw error; // Lançar o erro para ser tratado externamente, se necessário
        }
      }
    } else {
      logger.warn(`Nenhum resultado encontrado para o UUID: ${uuid}`);
      return null; // Retornar null se não houver resultados
    }

  }

  private handleLogEntry(logEntry: LogEntry) {
    const sendData = this.pendingSends.get(logEntry.queueId);
    if (!sendData) {
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
    }

    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length;

    if (processedRecipients >= totalRecipients) {
      this.pendingSends.delete(logEntry.queueId);

      // Verifica se todos os emails de um UUID foram processados
      for (const [uuid, queueIds] of this.uuidQueueMap.entries()) {
        if (queueIds.includes(logEntry.queueId)) {
          this.checkAndSendResults(uuid);
        }
      }
    }
  }
}

export default EmailService;