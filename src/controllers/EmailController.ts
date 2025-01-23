import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService'; // Importe o EmailService
import logger from '../utils/logger';

class EmailController {
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { fromName, emailDomain, to, subject, html, clientName, emailList } = req.body;

    // Validação básica
    if (!emailDomain) {
      res.status(400).json({
        success: false,
        message: 'Dados inválidos. "emailDomain" é obrigatório.',
      });
      return;
    }

    // Se emailList for fornecido, não precisa de "to", "subject" ou "html"
    if (emailList && (!Array.isArray(emailList) || emailList.length === 0)) {
      res.status(400).json({
        success: false,
        message: 'Dados inválidos. "emailList" deve ser uma lista não vazia.',
      });
      return;
    }

    // Se emailList não for fornecido, "to", "subject" e "html" são obrigatórios
    if (!emailList && (!to || !subject || !html || !clientName)) {
      res.status(400).json({
        success: false,
        message: 'Dados inválidos. "to", "subject", "html" e "clientName" são obrigatórios.',
      });
      return;
    }

    try {
      const emailService = EmailService.getInstance();

      if (emailList) {
        // Envia um email para cada item da lista
        const results = await emailService.sendEmailList({
          emailDomain,
          fromName,
          emailList,
        });

        res.json({
          success: true,
          results,
        });
      } else {
        // Envia um único email
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