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
}

interface SendEmailResult {
  queueId: string;
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
      logger.info(`extraído com sucesso de response:${info.response}, queueId: ${queueId}`);
      logger.info(`Email enviado!`);
  
      // Verifica se o queueId já foi processado
      // Dentro do método sendEmail
      if (this.stateManager.isQueueIdAssociated(queueId)) {
        logger.warn(`queueId ${queueId} já foi processado. Ignorando duplicação.`);
        return {
          queueId,
          recipients: allRecipients.map((recipient) => ({
            recipient,
            success: true,
            queueId,
          })),
        };
      }

      // Associa imediatamente o queueId ao UUID
      if (uuid) {
        this.stateManager.addQueueIdToUuid(uuid, queueId);
        logger.info(`Associado queueId ${queueId} ao UUID ${uuid}`);
      }

  
      // Associar imediatamente o queueId ao UUID
      if (uuid) {
        this.stateManager.addQueueIdToUuid(uuid, queueId);
        logger.info(`Associado queueId ${queueId} ao UUID ${uuid}`);
      }
  
      const recipientsStatus: RecipientStatus[] = allRecipients.map((recipient) => ({
        recipient,
        success: true,
        queueId,
      }));
  
      this.stateManager.addPendingSend(queueId, {
        toRecipients,
        bccRecipients,
        results: recipientsStatus,
      });
  
      return {
        queueId,
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

  // Ajustar o método handleLogEntry para garantir que o estado esteja sendo processado corretamente
  private handleLogEntry(logEntry: LogEntry): void {
    // Tentativa de obter os dados pendentes associados ao queueId do log
    const sendData = this.stateManager.getPendingSend(logEntry.queueId);
    if (!sendData) {
      // Log adicional com informações sobre o log e estado da fila
      logger.warn(`Nenhum dado encontrado no pendingSends para queueId=${logEntry.queueId}. Log completo: ${JSON.stringify(logEntry)}`);
      return;
    }
    
    // Extraindo o sucesso do log e o email do destinatário
    const success = logEntry.success;
    const recipient = logEntry.email.toLowerCase();
  
    // Buscando o índice do destinatário nos resultados do envio
    const recipientIndex = sendData.results.findIndex((r) => r.recipient === recipient);
    if (recipientIndex !== -1) {
      sendData.results[recipientIndex].success = success;
      
      // Caso de falha, logamos o erro específico do status
      if (!success) {
        sendData.results[recipientIndex].error = `Status: ${logEntry.result}`;
        logger.error(`Falha ao enviar para recipient=${recipient}. Erro: ${logEntry.result}. Log completo: ${JSON.stringify(logEntry)}`);
      } else {
        logger.info(`Resultado atualizado com sucesso para recipient=${recipient}. Status: ${success}. Log completo: ${JSON.stringify(logEntry)}`);
      }
    } else {
      // Caso o destinatário não seja encontrado, adicionamos um log detalhado
      logger.warn(`Recipient ${recipient} não encontrado nos resultados para queueId=${logEntry.queueId}. Log completo: ${JSON.stringify(logEntry)}`);
    }
    
    // Verifica quantos destinatários foram processados em comparação com o total
    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length;
    
    logger.debug(`Status de processamento para queueId=${logEntry.queueId}: Total de recipients=${totalRecipients}, Processados=${processedRecipients}. Log completo: ${JSON.stringify(logEntry)}`);
    
    // Se todos os destinatários foram processados, removemos da lista de pendentes
    if (processedRecipients >= totalRecipients) {
      logger.info(`Todos os recipients processados para queueId=${logEntry.queueId}. Removendo do pendingSends. Status atual: ${JSON.stringify(sendData)}`);
      this.stateManager.deletePendingSend(logEntry.queueId);
      
      // Passa o mailId ao atualizar o status
      const uuid = this.stateManager.getUuidByQueueId(logEntry.queueId);
      if (uuid) {
        logger.info(`Atualizando status para queueId=${logEntry.queueId} com UUID=${uuid}.`);
        this.stateManager.updateQueueIdStatus(logEntry.queueId, success, uuid);
      }
    
      // Verifica se todos os queueIds relacionados ao UUID foram processados
      if (uuid && this.stateManager.isUuidProcessed(uuid)) {
        const results = this.stateManager.consolidateResultsByUuid(uuid);
        if (results) {
          logger.info(`Todos os queueIds para uuid=${uuid} foram processados. Resultados consolidados:`, results);
          this.consolidateAndSendResults(uuid, results);
        }
      } else {
        logger.warn(`UUID ${uuid} não encontrado ou não processado para queueId=${logEntry.queueId}.`);
      }
    }
  }
  

  private async consolidateAndSendResults(uuid: string, results: RecipientStatus[]): Promise<void> {
    const allSuccess = results.every((result) => result.success);
    logger.info(`Resultados consolidados para uuid=${uuid}:`, results);
    logger.info(`Todos os emails foram enviados com sucesso? ${allSuccess}`);
  }
}

export default EmailService;
