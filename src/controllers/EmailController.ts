import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import StateManager from '../services/StateManager';

class EmailController {
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { mailerId, fromName, emailDomain, to, subject, html, templateId, uuid } = req.body;

    try {
      // Validação básica dos parâmetros
      const requiredParams = ['mailerId', 'fromName', 'emailDomain', 'to', 'subject', 'uuid'];
      const missingParams = requiredParams.filter(param => !(param in req.body));

      if (missingParams.length > 0) {
        throw new Error(`Parâmetros obrigatórios ausentes: ${missingParams.join(', ')}.`);
      }

      // Verificar se pelo menos 'html' ou 'templateId' está presente
      const isHtmlPresent = typeof html === 'string' && html.trim() !== '';
      const isTemplateIdPresent = typeof templateId === 'string' && templateId.trim() !== '';

      if (!isHtmlPresent && !isTemplateIdPresent) {
        throw new Error('É necessário fornecer pelo menos "html" ou "templateId".');
      }

      const emailService = EmailService.getInstance();
      const stateManager = new StateManager();

      // Enviar o e-mail
      const result = await emailService.sendEmail(
        {
          mailerId,
          fromName,
          emailDomain,
          to,
          subject,
          html: isTemplateIdPresent ? `<p>Template ID: ${templateId}</p>` : html, // Substituir pelo conteúdo real do template
          clientName: fromName, // Usar o fromName como clientName
        },
        uuid
      );

      // Atualiza o status do queueId com o mailId (uuid)
      await stateManager.updateQueueIdStatus(result.queueId, true, uuid);

      // Verifica se o e-mail foi processado
      if (stateManager.isUuidProcessed(uuid)) {
        const consolidatedResults = await stateManager.consolidateResultsByUuid(uuid);
        if (consolidatedResults) {
          logger.info(`Resultados consolidados para uuid=${uuid}:`, consolidatedResults);
          this.sendSuccessResponse(res, uuid, mailerId, consolidatedResults);
        } else {
          this.sendSuccessResponse(res, uuid, mailerId, [result]);
        }
      } else {
        this.sendSuccessResponse(res, uuid, mailerId, [result]);
      }
    } catch (error) {
      this.handleError(res, error);
    }
  }

  // Método para enviar resposta de sucesso
  private sendSuccessResponse(
    res: Response,
    uuid: string,
    mailerId: string,
    results: any[]
  ): void {
    res.json({
      success: true,
      uuid,
      mailerId,
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