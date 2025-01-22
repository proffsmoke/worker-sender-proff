import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';

class EmailController {
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { fromName, emailDomain, to, subject, html } = req.body;

    if (!fromName || !emailDomain || !to || !subject || !html) {
      res.status(400).json({
        success: false,
        message:
          'Dados inválidos. "fromName", "emailDomain", "to", "subject" e "html" são obrigatórios.',
      });
      return;
    }

    try {
      const result = await EmailService.sendEmail({
        fromName,
        emailDomain,
        to,
        bcc: [],
        subject,
        html,
      });

      // Retorna o queueId imediatamente
      res.json({
        success: true,
        queueId: result.queueId,
      });
    } catch (error) {
      logger.error(`Erro ao enviar email normal:`, error);
      res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
    }
  }
}

export default new EmailController();