import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import StateManager from '../services/StateManager';

class EmailController {
  constructor() {
    // Bind the method to the instance
    this.sendNormal = this.sendNormal.bind(this);
  }

  // EmailController.ts

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
    const stateManager = new StateManager();

    const results = [];

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

      // Atualiza o status do queueId com o mailId (uuid)
      await stateManager.updateQueueIdStatus(result.queueId, true, uuid);

      results.push(result);

      logger.info(`E-mail enviado com sucesso:`, {
        uuid,
        queueId: result.queueId,
        email,
        subject,
        templateId,
        clientName,
      });
    }

    if (stateManager.isUuidProcessed(uuid)) {
      const consolidatedResults = await stateManager.consolidateResultsByUuid(uuid);
      if (consolidatedResults) {
        logger.info(`Resultados consolidados para uuid=${uuid}:`, consolidatedResults);
        this.sendSuccessResponse(res, uuid, consolidatedResults);
      } else {
        this.sendSuccessResponse(res, uuid, results);
      }
    } else {
      this.sendSuccessResponse(res, uuid, results);
    }
  } catch (error) {
    this.handleError(res, error);
  }
}

  // Método para enviar resposta de sucesso
  private sendSuccessResponse(
    res: Response,
    uuid: string,
    results: any[]
  ): void {
    res.json({
      success: true,
      uuid,
      results,
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