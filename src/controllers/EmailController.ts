import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService'; // Importe o EmailService
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

class EmailController {
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { emailDomain, emailList, to, subject, html, fromName, clientName, uuid } = req.body;

    try {
      const emailService = EmailService.getInstance();
      const requestUuid = uuid || uuidv4(); // Gera um UUID se não for fornecido

      if (emailList) {
        // Se emailList for fornecido, enviar um email para cada item da lista
        const results = await emailService.sendEmailList({
          emailDomain,
          emailList,
        }, requestUuid);

        res.json({
          success: true,
          uuid: requestUuid,
          results,
        });
      } else {
        // Caso contrário, enviar um único email
        const result = await emailService.sendEmail({
          fromName,
          emailDomain,
          to,
          bcc: [],
          subject,
          html,
          clientName,
        }, requestUuid);

        res.json({
          success: true,
          uuid: requestUuid,
          queueId: result.queueId,
        });
      }
    } catch (error) {
      logger.error(`Erro ao enviar email normal:`, error);
      res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
    }
  }
}

export default new EmailController();