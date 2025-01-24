import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import StateManager from '../services/StateManager';

class EmailController {
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { emailDomain, emailList, to, subject, html, fromName, clientName, uuid } = req.body;
    const requestUuid = uuid || uuidv4(); // Use the provided uuid or generate a new one
    const emailService = EmailService.getInstance();
    const stateManager = new StateManager();

    try {
      if (emailList) {
        // Enviar a lista de e-mails
        const results = await Promise.all(
          emailList.map((emailItem: any) =>
            emailService.sendEmail(
              {
                fromName: emailItem.name || fromName || 'No-Reply',
                emailDomain,
                to: emailItem.email,
                bcc: [],
                subject: emailItem.subject,
                html: emailItem.template,
                clientName: emailItem.clientName || clientName,
              },
              requestUuid
            )
          )
        );

        this.handleResponse(res, requestUuid, results, stateManager);
      } else {
        // Enviar um único e-mail
        if (!to || !subject || !html) {
          throw new Error('Parâmetros "to", "subject" e "html" são obrigatórios para envio de email único.');
        }

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
          requestUuid
        );

        this.handleResponse(res, requestUuid, [result], stateManager);
      }
    } catch (error) {
      this.handleError(res, error);
    }
  }

  private handleResponse(res: Response, uuid: string, results: any[], stateManager: StateManager): void {
    if (stateManager.isUuidProcessed(uuid)) {
      const consolidatedResults = stateManager.consolidateResultsByUuid(uuid);
      if (consolidatedResults) {
        logger.info(`Resultados consolidados para uuid=${uuid}:`, consolidatedResults);
        res.json({
          success: true,
          uuid,
          results: consolidatedResults,
        });
      } else {
        res.json({
          success: true,
          uuid,
          results,
        });
      }
    } else {
      res.json({
        success: true,
        uuid,
        results,
      });
    }
  }

  private handleError(res: Response, error: unknown): void {
    if (error instanceof Error) {
      logger.error(`Erro ao enviar email:`, error);
      res.status(500).json({ success: false, message: 'Erro ao enviar email.', error: error.message });
    } else {
      logger.error(`Erro desconhecido ao enviar email:`, error);
      res.status(500).json({ success: false, message: 'Erro desconhecido ao enviar email.' });
    }
  }
}

export default new EmailController();