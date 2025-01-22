import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

class EmailController {
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { fromName, emailDomain, to, subject, html, uuid } = req.body;

    if (!fromName || !emailDomain || !to || !subject || !html || !uuid) {
      res.status(400).json({
        success: false,
        message:
          'Dados inválidos. "fromName", "emailDomain", "to", "subject", "html" e "uuid" são obrigatórios.',
      });
      return;
    }

    try {
      const processedHtml = html; // antiSpam(html);
      const result = await EmailService.sendEmail({
        fromName,
        emailDomain,
        to,
        bcc: [],
        subject,
        html: processedHtml,
        uuid,
      });

      // Retorna imediatamente com o queueId
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