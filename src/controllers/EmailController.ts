import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import EmailQueueModel, { IEmailQueue } from '../models/EmailQueueModel';
import EmailService from '../services/EmailService';
import EmailRetryStatus from '../models/EmailRetryStatus';

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
    const taskId = req.body.taskId;
    logger.info(`Recebido pedido de envio de e-mails para UUID=${uuid}${taskId ? ` (taskId: ${taskId})` : ''}`);

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
    const {
      emailDomain,
      emailList,
      fromName,
      uuid,
      subject,
      htmlContent,
      sender,
      taskId,
    } = body;

    const isDetailedTest = taskId === "FAKE_TASK_ID_FOR_DETAILED_TEST";

    logger.info(`Iniciando processamento dos e-mails para UUID=${uuid}${isDetailedTest ? " (DETAILED TEST)" : ""}`);

    // Validação básica
    const requiredParams = ['emailDomain', 'emailList', 'fromName', 'uuid', 'subject', 'htmlContent', 'sender'];
    const missingParams = requiredParams.filter(param => !(param in body));
    if (missingParams.length > 0) {
      logger.error(`Parâmetros obrigatórios ausentes para UUID=${uuid}: ${missingParams.join(', ')}. Requisição ignorada.`);
      return;
    }

    if (!isDetailedTest) {
      let emailQueue = await EmailQueueModel.findOne({ uuid });
      if (!emailQueue) {
        emailQueue = await EmailQueueModel.create({
          uuid,
          queueIds: [],
          resultSent: false,
        });
        logger.info(`Criado novo documento EmailQueue para UUID=${uuid}`);
      }
    } else {
      logger.info(`[DETAILED TEST] Pulando criação/interação com EmailQueueModel para UUID=${uuid}`);
    }

    // 2) Remove duplicados da lista da requisição atual
    const uniqueEmailList = [];
    const emailMap = new Map();
    for (const emailData of emailList) {
      const normalizedEmail = emailData.email.toLowerCase();
      if (!emailMap.has(normalizedEmail)) {
        emailMap.set(normalizedEmail, { ...emailData, email: normalizedEmail });
        uniqueEmailList.push({ ...emailData, email: normalizedEmail });
      } else {
        logger.info(`E-mail duplicado ignorado na requisição UUID=${uuid}: ${emailData.email}`);
      }
    }

    // 3) Envia cada e-mail e faz push incremental
    const emailService = EmailService.getInstance();

    for (const emailData of uniqueEmailList) {
      const { email, name } = emailData;
      const emailAddress = email;

      // Verificar status de falha permanente ANTES de tentar enviar
      try {
        const retryStatus = await EmailRetryStatus.findOne({ email: emailAddress });
        if (retryStatus && retryStatus.isPermanentlyFailed) {
          logger.warn(`Envio para ${emailAddress} (UUID=${uuid}) PULADO. E-mail marcado como FALHA PERMANENTE.`);
          continue;
        }
      } catch (statusError) {
        logger.error(`Erro ao verificar EmailRetryStatus para ${emailAddress} (UUID=${uuid}):`, statusError);
      }

      const emailPayload: EmailPayload = {
        emailDomain,
        fromName,
        to: emailAddress,
        subject,
        html: htmlContent,
        sender,
        ...(name && name !== "null" && { name }),
      };

      try {
        const result = await emailService.sendEmail(emailPayload, uuid);

        if (isDetailedTest) {
          logger.info(`[DETAILED TEST] E-mail para ${emailAddress} (UUID=${uuid}) processado pelo EmailService. Resultado: ${JSON.stringify(result)}`);
        } else if (result.queueId) {
          await EmailQueueModel.updateOne(
            { uuid },
            {
              $push: {
                queueIds: {
                  queueId: result.queueId.toUpperCase(),
                  email: emailAddress,
                  success: null,
                },
              },
              $set: {
                resultSent: false,
              },
            }
          );

          const updatedQueue = await EmailQueueModel.findOne({ uuid }, { queueIds: 1 });
          if (updatedQueue) {
            const total = updatedQueue.queueIds.length;
            const nullCount = updatedQueue.queueIds.filter(q => q.success === null).length;
            logger.info(
              `QueueId inserido p/ UUID=${uuid}: queueId=${result.queueId}, email=${emailAddress}. ` +
              `Pendentes=${nullCount}, total=${total}.`
            );
          }
        } else if (!isDetailedTest) {
          logger.warn(`Nenhum queueId retornado para o e-mail ${emailAddress} (UUID=${uuid})`);
        }

      } catch (err) {
        logger.error(`Erro ao enfileirar/processar e-mail para ${emailAddress} (UUID=${uuid}):`, err);
      }
    }

    logger.info(`Processamento de e-mails concluído para UUID=${uuid}${isDetailedTest ? " (DETAILED TEST)" : ""}`);
  }
}

export default new EmailController();
