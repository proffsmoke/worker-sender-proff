import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService'; // Importe o EmailService
import logger from '../utils/logger';

class EmailController {
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { emailDomain, emailList, to, subject, html, fromName, clientName } = req.body;

    try {
      const emailService = EmailService.getInstance();

      if (emailList) {
        // Se emailList for fornecido, enviar um email para cada item da lista
        const results = await emailService.sendEmailList({
          emailDomain,
          emailList,
        });

        res.json({
          success: true,
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
        });

        res.json({
          success: true,
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