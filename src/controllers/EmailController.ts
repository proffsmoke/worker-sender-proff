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
  name?: string;
  sender?: string;
}

class EmailController {
  constructor() {
    this.sendNormal = this.sendNormal.bind(this);
  }

  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uuid } = req.body;
    logger.info(`Recebido pedido de envio de e-mails para UUID=${uuid}`);

    // Resposta imediata
    res.status(200).json({ message: 'Emails enfileirados para envio.', uuid });

    // Processamento assíncrono em background
    this.processEmails(req.body).catch(error => {
      logger.error(`Erro no processamento dos emails para UUID=${uuid}:`, error);
    });
  }

  private async processEmails(body: any): Promise<void> {
    const { emailDomain, emailList, fromName, uuid, subject, htmlContent, sender } = body;

    logger.info(`Iniciando processamento dos e-mails para UUID=${uuid}`);

    // Validação básica
    const requiredParams = ['emailDomain', 'emailList', 'fromName', 'uuid', 'subject', 'htmlContent', 'sender'];
    const missingParams = requiredParams.filter(param => !(param in body));
    if (missingParams.length > 0) {
      throw new Error(`Parâmetros obrigatórios ausentes: ${missingParams.join(', ')}.`);
    }

    // Instância do EmailService
    const emailService = EmailService.getInstance();

    // Cria ou localiza documento no banco de dados
    let emailQueue = await EmailQueueModel.findOne({ uuid });
    if (!emailQueue) {
      emailQueue = new EmailQueueModel({ uuid, queueIds: [] });
      logger.info(`Novo documento criado para UUID=${uuid}`);
    } else {
      logger.info(`Documento existente encontrado para UUID=${uuid}, atualizando...`);
    }

    // Remove duplicados da lista de e-mails
    const uniqueEmailList = [];
    const emailMap = new Map();
    for (const emailData of emailList) {
      if (!emailMap.has(emailData.email)) {
        emailMap.set(emailData.email, emailData);
        uniqueEmailList.push(emailData);
      } else {
        logger.info(`Email duplicado detectado e ignorado: ${emailData.email}`);
      }
    }

    // Map para checar se queueId já existe
    const queueIdMap = new Map(emailQueue.queueIds.map((item: any) => [item.queueId, item]));

    // Envia cada email e salva queueIds
    for (const emailData of uniqueEmailList) {
      const { email, name } = emailData;

      const emailPayload: EmailPayload = {
        emailDomain,
        fromName,
        to: email,
        subject,
        html: htmlContent,
        sender,
        ...(name && { name }),
      };

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

    // Salva no banco (criado ou atualizado)
    try {
      await emailQueue.save();
      logger.info(`Documento salvo com sucesso para UUID=${uuid}`);
    } catch (error) {
      logger.error(`Erro ao salvar os dados para UUID=${uuid}:`, error);
      throw new Error('Erro ao salvar os dados no banco de dados.');
    }

    logger.info(`Processamento concluído para UUID=${uuid}`);
  }
}

export default new EmailController();