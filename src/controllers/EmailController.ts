import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import StateManager from '../services/StateManager';

class EmailController {
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { emailDomain, emailList, to, subject, html, fromName, clientName, uuid } = req.body;

    try {
      const emailService = EmailService.getInstance();
      const stateManager = new StateManager();
      const requestUuid = uuid || uuidv4(); // Use o uuid fornecido ou gere um novo

      if (emailList) {
        // Enviar a lista de e-mails usando sendEmail com o mesmo uuid para cada envio
        const results = await Promise.all(
          emailList.map(async (emailItem: any) => {
            const result = await emailService.sendEmail(
              {
                fromName: emailItem.name || fromName || 'No-Reply',
                emailDomain,
                to: emailItem.email,
                bcc: [],
                subject: emailItem.subject,
                html: emailItem.template,
                clientName: emailItem.clientName || clientName,
              },
              requestUuid // Passando o uuid para associar com todos os e-mails
            );

            // Atualiza o status do queueId com o mailId (requestUuid)
            await stateManager.updateQueueIdStatus(result.queueId, true, requestUuid);
            return result;
          })
        );

        // Verifica se todos os emails da lista foram processados
        if (stateManager.isUuidProcessed(requestUuid)) {
          const consolidatedResults = stateManager.consolidateResultsByUuid(requestUuid);
          if (consolidatedResults) {
            logger.info(`Resultados consolidados para uuid=${requestUuid}:`, consolidatedResults);
            res.json({
              success: true,
              uuid: requestUuid,
              results: consolidatedResults,
            });
          } else {
            res.json({
              success: true,
              uuid: requestUuid,
              results,
            });
          }
        } else {
          res.json({
            success: true,
            uuid: requestUuid,
            results,
          });
        }
      } else {
        if (!to || !subject || !html) {
          throw new Error('Parâmetros "to", "subject" e "html" são obrigatórios para envio de email único.');
        }

        // Enviar um único e-mail
        const result = await emailService.sendEmail(
          {
            fromName,
            emailDomain,
            to,
            bcc: [],
            subject,
            html,
            clientName,
          },
          requestUuid // Passando o uuid para associar com o e-mail
        );

        // Atualiza o status do queueId com o mailId (requestUuid)
        await stateManager.updateQueueIdStatus(result.queueId, true, requestUuid);

        // Verifica se o email foi processado
        if (stateManager.isUuidProcessed(requestUuid)) {
          const consolidatedResults = stateManager.consolidateResultsByUuid(requestUuid);
          if (consolidatedResults) {
            logger.info(`Resultados consolidados para uuid=${requestUuid}:`, consolidatedResults);
            res.json({
              success: true,
              uuid: requestUuid,
              queueId: result.queueId, // Incluindo o queueId
              recipients: consolidatedResults, // Envia os resultados consolidados
            });
          } else {
            res.json({
              success: true,
              uuid: requestUuid,
              queueId: result.queueId,
              recipients: result.recipients, // Envia os resultados do envio único
            });
          }
        } else {
          res.json({
            success: true,
            uuid: requestUuid,
            queueId: result.queueId,
            recipients: result.recipients,
          });
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Erro ao enviar email normal:`, error);
        res.status(500).json({ success: false, message: 'Erro ao enviar email.', error: error.message });
      } else {
        logger.error(`Erro desconhecido ao enviar email normal:`, error);
        res.status(500).json({ success: false, message: 'Erro desconhecido ao enviar email.' });
      }
    }
  }
}

export default new EmailController();