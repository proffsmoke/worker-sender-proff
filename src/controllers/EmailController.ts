import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import EmailQueueModel from '../models/EmailQueueModel'; // Importando o novo modelo

class EmailController {
  constructor() {
    // Bind the method to the instance
    this.sendNormal = this.sendNormal.bind(this);
  }

  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { emailDomain, emailList, fromName, uuid } = req.body;

    try {
      logger.info(`Iniciando envio de e-mails para UUID=${uuid}`);

      // Validação básica dos parâmetros
      const requiredParams = ['emailDomain', 'emailList', 'fromName', 'uuid'];
      const missingParams = requiredParams.filter(param => !(param in req.body));

      if (missingParams.length > 0) {
        throw new Error(`Parâmetros obrigatórios ausentes: ${missingParams.join(', ')}.`);
      }

      const emailService = EmailService.getInstance();

      // Cria ou atualiza o documento no banco de dados
      let emailQueue = await EmailQueueModel.findOne({ uuid });

      if (!emailQueue) {
        emailQueue = new EmailQueueModel({ uuid, queueIds: [] });
      }

      for (const emailData of emailList) {
        const { email, subject, templateId, html, clientName } = emailData;

        const result = await emailService.sendEmail(
          {
            emailDomain,
            fromName,
            to: email,
            subject,
            html: templateId ? `<p>Template ID: ${templateId}</p>` : html,
            clientName: clientName || fromName,
          },
          uuid
        );

        // Adiciona o resultado ao array de queueIds
        emailQueue.queueIds.push({
          queueId: result.queueId,
          email,
          success: true, // Assume que o envio foi bem-sucedido
        });

        logger.info(`E-mail enviado com sucesso:`, {
          uuid,
          queueId: result.queueId,
          email,
          subject,
          templateId,
          clientName,
        });
      }

      // Salva o documento no banco de dados
      await emailQueue.save();

      this.sendSuccessResponse(res, emailQueue);
    } catch (error) {
      this.handleError(res, error);
    }
  }

  // Método para enviar resposta de sucesso
  private sendSuccessResponse(
    res: Response,
    emailQueue: { uuid: string; queueIds: Array<{ queueId: string; email: string; success: boolean }> }
  ): void {
    res.json({
      success: true,
      uuid: emailQueue.uuid,
      queueIds: emailQueue.queueIds,
    });
  }

  // Método para tratar erros
  private handleError(res: Response, error: unknown): void {
    if (error instanceof Error) {
      logger.error(`Erro ao enviar e-mail:`, error);
      res.status(500).json({
        success: false,
        message: 'Erro ao enviar e-mail.',
        error: error.message,
      });
    } else {
      logger.error(`Erro desconhecido ao enviar e-mail:`, error);
      res.status(500).json({
        success: false,
        message: 'Erro desconhecido ao enviar e-mail.',
      });
    }
  }
}

export default new EmailController();