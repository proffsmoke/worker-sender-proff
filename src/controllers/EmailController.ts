// src/controllers/EmailController.ts

import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import antiSpam from '../utils/antiSpam';

class EmailController {
  // Rota para envio normal
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { fromName, emailDomain, to, subject, html } = req.body;

    // Validação dos parâmetros obrigatórios
    if (!fromName || !emailDomain || !to || !subject || !html) {
      res.status(400).json({ success: false, message: 'Dados inválidos. "fromName", "emailDomain", "to", "subject" e "html" são obrigatórios.' });
      return;
    }

    try {
      const processedHtml = antiSpam(html);
      const results = await EmailService.sendEmail({
        fromName,
        emailDomain,
        to,
        bcc: [],
        subject,
        html: processedHtml,
      });
      res.json({ success: true, results });
    } catch (error: any) {
      logger.error(`Erro ao enviar email normal para ${to}: ${error.message}`, { subject, html, stack: error.stack });
      res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
    }
  }

  // Rota para envio em massa
  async sendBulk(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { fromName, emailDomain, to, bcc, subject, html } = req.body;

    // Validação dos parâmetros obrigatórios
    if (!fromName || !emailDomain || !to || !bcc || !Array.isArray(bcc) || bcc.length === 0 || !subject || !html) {
      res.status(400).json({ success: false, message: 'Dados inválidos. "fromName", "emailDomain", "to", "bcc", "subject" e "html" são obrigatórios.' });
      return;
    }

    try {
      const processedHtml = antiSpam(html);
      const results = await EmailService.sendEmail({
        fromName,
        emailDomain,
        to,
        bcc,
        subject,
        html: processedHtml,
      });
      res.json({ success: true, results });
    } catch (error: any) {
      logger.error(`Erro ao enviar email em massa para ${to} e BCC: ${error.message}`, { bcc, subject, html, stack: error.stack });
      res.status(500).json({ success: false, message: 'Erro ao enviar emails em massa.' });
    }
  }
}

export default new EmailController();
