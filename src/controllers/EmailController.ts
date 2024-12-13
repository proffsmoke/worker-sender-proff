// src/controllers/EmailController.ts

import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import antiSpam from '../utils/antiSpam';

class EmailController {
  // Envio normal
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
      const processedHtml = antiSpam(html);
      const result = await EmailService.sendEmail({
        fromName,
        emailDomain,
        to,
        bcc: [],
        subject,
        html: processedHtml,
        uuid,
      });

      // Determina o sucesso geral baseado nos destinatários
      const overallSuccess = result.recipients.some((r) => r.success);

      res.json({
        success: overallSuccess,
        status: result,
      });
    } catch (error) {
      logger.error(`Erro ao enviar email normal:`, error);
      res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
    }
  }

  // Envio em massa
  async sendBulk(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { fromName, emailDomain, to, bcc, subject, html, uuid } = req.body;

    if (
      !fromName ||
      !emailDomain ||
      !to ||
      !bcc ||
      !Array.isArray(bcc) ||
      bcc.length === 0 ||
      !subject ||
      !html ||
      !uuid
    ) {
      res.status(400).json({
        success: false,
        message:
          'Dados inválidos. "fromName", "emailDomain", "to", "bcc", "subject", "html" e "uuid" são obrigatórios.',
      });
      return;
    }

    try {
      const processedHtml = antiSpam(html);
      const result = await EmailService.sendEmail({
        fromName,
        emailDomain,
        to,
        bcc,
        subject,
        html: processedHtml,
        uuid,
      });

      // Determina o sucesso geral baseado nos destinatários
      const overallSuccess = result.recipients.some((r) => r.success);

      res.json({
        success: overallSuccess,
        status: result,
      });
    } catch (error) {
      logger.error(`Erro ao enviar emails em massa:`, error);
      res.status(500).json({ success: false, message: 'Erro ao enviar emails em massa.' });
    }
  }
}

export default new EmailController();
