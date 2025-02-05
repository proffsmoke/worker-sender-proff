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

    // Processa em background
    this.processEmails(req.body).catch(error => {
      logger.error(`Erro no processamento dos emails para UUID=${uuid}:`, error);
    });
  }

  /**
   * Processa as listas de e-mails (remoção de duplicatas, envio e salvamento dos queueIds).
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

    // Remove duplicados da lista de e-mails
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

    // Envia cada e-mail e obtém o queueId retornado
    const emailService = EmailService.getInstance();
    // Array temporário para os itens a serem adicionados
    const queueIdsTemp: Array<{ queueId: string; email: string; success: boolean | null }> = [];

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
        const result = await emailService.sendEmail(emailPayload, uuid);
        // Se houver queueId retornado, armazenamos em memória
        if (result.queueId) {
          queueIdsTemp.push({ queueId: result.queueId, email, success: null });
        } else {
          logger.warn(`Nenhum queueId retornado para o e-mail ${email}`);
        }
      } catch (err) {
        logger.error(`Erro ao enfileirar e-mail para ${email}:`, err);
      }
    }

    // --- Atualização do documento EmailQueue ---
    // Se o documento já existir, não sobrescrevemos todo o array,
    // mas adicionamos novos itens usando $push (evitando sobrescrever o status já atualizado).
    try {
      const existingQueue = await EmailQueueModel.findOne({ uuid });
      if (existingQueue) {
        // Para cada novo item, se já existir um entry para o e-mail, atualiza somente o queueId,
        // caso contrário, adiciona o item ao array.
        for (const item of queueIdsTemp) {
          const updateResult = await EmailQueueModel.updateOne(
            { uuid, 'queueIds.email': item.email },
            { $set: { 'queueIds.$.queueId': item.queueId } }
          );
          if (updateResult.matchedCount === 0) {
            await EmailQueueModel.updateOne(
              { uuid },
              { $push: { queueIds: item } }
            );
          }
        }
        // Garante que resultSent seja false
        await EmailQueueModel.updateOne({ uuid }, { $set: { resultSent: false } });
      } else {
        // Se não existir, cria o documento com os itens
        await EmailQueueModel.create({ uuid, queueIds: queueIdsTemp, resultSent: false });
      }

      logger.info(`Documento EmailQueue salvo/atualizado para UUID=${uuid}`);
    } catch (err) {
      logger.error(`Erro ao salvar EmailQueue para UUID=${uuid}:`, err);
      throw new Error('Erro ao salvar os dados no banco de dados.');
    }

    logger.info(`Processamento concluído para UUID=${uuid}`);
  }
}

export default new EmailController();
