import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';  // Certifique-se de importar corretamente o EmailService
import logger from '../utils/logger';
import LogParser from '../log-parser';

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
      // Instanciando EmailService com o logParser (caso necessário)
      const logParser = new LogParser('/var/log/mail.log');  // Crie ou reutilize o LogParser que você já tem
      const emailService = new EmailService(logParser);  // Instanciando a classe com o logParser

      // Agora chamamos o método sendEmail na instância de EmailService
      const result = await emailService.sendEmail({
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
