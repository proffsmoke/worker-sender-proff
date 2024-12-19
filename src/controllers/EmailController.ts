// src/controllers/EmailController.ts

import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import antiSpam from '../utils/antiSpam';
import { v4 as uuidv4 } from 'uuid'; // Import necessário para gerar UUIDs únicos

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

  // Envio em massa modificado para enviar um email por BCC
  async sendBulk(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { fromName, emailDomain, to, bcc, subject, html } = req.body;

    // Validação dos dados de entrada
    if (
      !fromName ||
      !emailDomain ||
      !to ||
      !bcc ||
      !Array.isArray(bcc) ||
      bcc.length === 0 ||
      !subject ||
      !html
    ) {
      res.status(400).json({
        success: false,
        message:
          'Dados inválidos. "fromName", "emailDomain", "to", "bcc", "subject" e "html" são obrigatórios.',
      });
      return;
    }

    try {
      const processedHtml = antiSpam(html);
      
      // Preparar um array de promessas para cada envio individual
      const sendPromises = bcc.map(async (bccEmail: string) => {
        const uuid = uuidv4(); // Gerar um UUID único para cada email
        const result = await EmailService.sendEmail({
          fromName,
          emailDomain,
          to,
          bcc: [bccEmail], // Enviar um email por BCC
          subject,
          html: processedHtml,
          uuid,
        });

        return result;
      });

      // Executar todas as promessas de envio em paralelo
      const results = await Promise.all(sendPromises);

      // Determinar o sucesso geral baseado nos resultados individuais
      const overallSuccess = results.some((result) => 
        result.recipients.some((r) => r.success)
      );

      res.json({
        success: overallSuccess,
        status: results,
      });
    } catch (error: any) {
      logger.error(`Erro ao enviar emails em massa:`, error);
      res.status(500).json({ success: false, message: 'Erro ao enviar emails em massa.' });
    }
  }
}

export default new EmailController();
