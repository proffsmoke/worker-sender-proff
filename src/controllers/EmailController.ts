import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import EmailQueueModel, { IEmailQueue } from '../models/EmailQueueModel';
import EmailService from '../services/EmailService';

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

  /**
   * Recebe a requisição para envio de e-mails, responde imediatamente
   * e processa o envio em background.
   */
  async sendNormal(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const { uuid } = req.body;
    logger.info(`Recebido pedido de envio de e-mails para UUID=${uuid}`);

    // Resposta imediata
    res.status(200).json({ message: 'Emails enfileirados para envio.', uuid });

    // Processa em background (sem travar a requisição principal)
    this.processEmails(req.body).catch(error => {
      logger.error(`Erro no processamento dos emails para UUID=${uuid}:`, error);
    });
  }

  /**
   * Processa as listas de e-mails:
   * - Garante que o documento EmailQueue existe (senão cria).
   * - Remove duplicadas.
   * - Para cada e-mail, envia e faz $push incremental no array queueIds.
   */
  private async processEmails(body: any): Promise<void> {
    const { emailDomain, emailList, fromName, uuid, subject, htmlContent, sender } = body;
    logger.info(`Iniciando processamento dos e-mails para UUID=${uuid}`);

    // Validação básica
    const requiredParams = ['emailDomain', 'emailList', 'fromName', 'uuid', 'subject', 'htmlContent', 'sender'];
    const missingParams = requiredParams.filter(param => !(param in body));
    if (missingParams.length > 0) {
      throw new Error(`Parâmetros obrigatórios ausentes: ${missingParams.join(', ')}.`);
    }

    // 1) Garante que o documento no Mongo exista
    let emailQueue = await EmailQueueModel.findOne({ uuid });
    if (!emailQueue) {
      emailQueue = await EmailQueueModel.create({
        uuid,
        queueIds: [],
        resultSent: false,
      });
      logger.info(`Criado novo documento EmailQueue para UUID=${uuid}`);
    }

    // 2) Remove duplicados
    const uniqueEmailList = [];
    const emailMap = new Map();
    for (const emailData of emailList) {
      if (!emailMap.has(emailData.email)) {
        emailMap.set(emailData.email, emailData);
        uniqueEmailList.push(emailData);
      } else {
        logger.info(`E-mail duplicado ignorado: ${emailData.email}`);
      }
    }

    // 3) Envia cada e-mail e faz push incremental
    const emailService = EmailService.getInstance();

    for (const emailData of uniqueEmailList) {
      const { email, name } = emailData;
      const emailPayload: EmailPayload = {
        emailDomain,
        fromName,
        to: email,
        subject,
        html: htmlContent,
        sender,
        ...(name && { name }), // adiciona `name` somente se existir
      };

      try {
        // Envio (await) - não bloqueia completamente pois o service já lida em lotes
        const result = await emailService.sendEmail(emailPayload, uuid);

        if (result.queueId) {
          // Incrementa no Mongo o array com este queueId
          await EmailQueueModel.updateOne(
            { uuid },
            {
              $push: {
                queueIds: {
                  queueId: result.queueId.toUpperCase(),
                  email: email.toLowerCase(),
                  success: null,
                },
              },
              $set: {
                resultSent: false,
              },
            }
          );

          // (Opcional) Loga quantos ainda estão null e quantos total
          const updatedQueue = await EmailQueueModel.findOne({ uuid }, { queueIds: 1 });
          if (updatedQueue) {
            const total = updatedQueue.queueIds.length;
            const nullCount = updatedQueue.queueIds.filter(q => q.success === null).length;
            logger.info(
              `QueueId inserido p/ UUID=${uuid}: queueId=${result.queueId}, email=${email}. ` +
              `Pendentes=${nullCount}, total=${total}.`
            );
          }

        } else {
          logger.warn(`Nenhum queueId retornado para o e-mail ${email}`);
        }

      } catch (err) {
        logger.error(`Erro ao enfileirar e-mail para ${email}:`, err);
      }
    }

    logger.info(`Processamento concluído para UUID=${uuid}`);
  }
}

export default new EmailController();
