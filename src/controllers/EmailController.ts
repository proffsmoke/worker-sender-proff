import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

class EmailController {
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { emailDomain, emailList, to, subject, html, fromName, clientName, uuid } = req.body;

    try {
      const emailService = EmailService.getInstance();
      const requestUuid = uuid || uuidv4();

      if (emailList) {
        // Enviar a lista de e-mails
        const results = await emailService.sendEmailList(
          {
            emailDomain,
            emailList,
          },
          requestUuid
        );

        res.json({
          success: true,
          uuid: requestUuid,
          results,
        });
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
          requestUuid
        );

        res.json({
          success: true,
          uuid: requestUuid,
          queueId: result.queueId,
          mailId: result.mailId,
          recipients: result.recipients,
        });
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
