// src/controllers/EmailController.ts
import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import EmailQueueModel from '../models/EmailQueueModel';

interface EmailPayload {
  emailDomain: string;
  fromName: string;
  to: string;
  subject: string;
  html: string;
  name?: string; // Usa "name" em vez de "clientName"
  sender?: string;
}

class EmailController {
  constructor() {
    this.sendNormal = this.sendNormal.bind(this);
  }

  /**
   * Endpoint que recebe a requisição do servidor.
   * Esse método responde imediatamente e, em seguida, processa os emails em background.
   */
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uuid } = req.body;
    logger.info(`Recebido pedido de envio de e-mails para UUID=${uuid}`);
    
    // Responde imediatamente para que o axios não aguarde o processamento pesado
    res.status(200).json({ message: 'Emails enfileirados para envio.', uuid });
    
    // Em background, inicia o processamento dos emails
    this.processEmails(req.body).catch(error => {
      logger.error(`Erro no processamento dos emails para UUID=${uuid}:`, error);
    });
  }
  
  /**
   * Processa os emails recebidos.
   * Essa função contém a lógica atual de validação, remoção de duplicatas, envio via EmailService
   * e atualização do documento EmailQueueModel.
   */
  private async processEmails(body: any): Promise<void> {
    const { emailDomain, emailList, fromName, uuid, subject, htmlContent, sender } = body;
    
    logger.info(`Iniciando processamento dos e-mails para UUID=${uuid}`);
  
    // Validação básica dos parâmetros
    const requiredParams = ['emailDomain', 'emailList', 'fromName', 'uuid', 'subject', 'htmlContent', 'sender'];
    const missingParams = requiredParams.filter(param => !(param in body));
  
    if (missingParams.length > 0) {
      throw new Error(`Parâmetros obrigatórios ausentes: ${missingParams.join(', ')}.`);
    }
  
    const emailService = EmailService.getInstance();
  
    // Cria ou atualiza o documento no banco de dados
    let emailQueue = await EmailQueueModel.findOne({ uuid });
    if (!emailQueue) {
      emailQueue = new EmailQueueModel({ uuid, queueIds: [] });
      logger.info(`Novo documento criado para UUID=${uuid}`);
    } else {
      logger.info(`Documento existente encontrado para UUID=${uuid}`);
    }
  
    // Remover duplicatas da emailList
    const uniqueEmailList = [];
    const emailMap = new Map();
  
    for (const emailData of emailList) {
      logger.info(`Processando emailData: ${JSON.stringify(emailData)}`);
      if (!emailMap.has(emailData.email)) {
        emailMap.set(emailData.email, emailData);
        uniqueEmailList.push(emailData);
      } else {
        logger.info(`Email duplicado detectado e ignorado: ${emailData.email}`);
      }
    }
  
    // Usar um Map para acompanhar os queueIds já existentes
    const queueIdMap = new Map(emailQueue.queueIds.map((item: any) => [item.queueId, item]));
  
    // Processa os emails (aqui, pode ser em paralelo ou sequencialmente)
    for (const emailData of uniqueEmailList) {
      const { email, name } = emailData;
  
      const emailPayload: EmailPayload = {
        emailDomain,
        fromName,
        to: email,
        subject,
        html: htmlContent,
        sender,
      };
  
      if (name) {
        emailPayload.name = name;
      }
  
      logger.info(`Enfileirando envio de e-mail para: ${email} com payload: ${JSON.stringify(emailPayload)}`);
  
      try {
        const result = await emailService.sendEmail(emailPayload, uuid, emailQueue.queueIds);
  
        if (!queueIdMap.has(result.queueId)) {
          const queueIdData = {
            queueId: result.queueId,
            email,
            success: null,
          };
          emailQueue.queueIds.push(queueIdData);
          queueIdMap.set(result.queueId, queueIdData);
          logger.info(`E-mail enfileirado com sucesso: UUID=${uuid}, queueId=${result.queueId}, email=${email}`);
        } else {
          logger.info(`O queueId ${result.queueId} já está presente para o UUID=${uuid}, ignorando duplicata.`);
        }
      } catch (error) {
        logger.error(`Erro ao enfileirar e-mail para ${email}:`, error);
      }
    }
  
    await this.saveEmailQueue(emailQueue, uuid);
    logger.info(`Processamento concluído para UUID=${uuid}`);
  }
  
  // Método para salvar o EmailQueue no banco de dados
  private async saveEmailQueue(emailQueue: any, uuid: string): Promise<void> {
    try {
      await emailQueue.save();
      logger.info(`Dados salvos com sucesso para UUID=${uuid}`);
    } catch (saveError) {
      logger.error(`Erro ao salvar os dados para UUID=${uuid}:`, saveError);
      throw new Error('Erro ao salvar os dados no banco de dados.');
    }
  }
}

export default new EmailController();
