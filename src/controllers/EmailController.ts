import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import StateManager from '../services/StateManager';

class EmailController {
  constructor() {
    // Bind the method to the instance
    this.sendNormal = this.sendNormal.bind(this);
  }

  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { emailDomain, emailList, fromName, uuid } = req.body;
  
    try {
      // Validação básica dos parâmetros
      const requiredParams = ['emailDomain', 'emailList', 'fromName', 'uuid'];
      const missingParams = requiredParams.filter(param => !(param in req.body));
  
      if (missingParams.length > 0) {
        throw new Error(`Parâmetros obrigatórios ausentes: ${missingParams.join(', ')}.`);
      }
  
      // Verificar se emailList é um array e contém pelo menos um item
      if (!Array.isArray(emailList) || emailList.length === 0) {
        throw new Error('O parâmetro "emailList" deve ser um array com pelo menos um e-mail.');
      }
  
      // Validar cada e-mail na lista
      for (const emailData of emailList) {
        const { email, subject, templateId, html, clientName } = emailData;
  
        if (!email || !subject) {
          throw new Error('Cada objeto em "emailList" deve conter "email" e "subject".');
        }
  
        const isHtmlPresent = typeof html === 'string' && html.trim() !== '';
        const isTemplateIdPresent = typeof templateId === 'string' && templateId.trim() !== '';
  
        if (!isHtmlPresent && !isTemplateIdPresent) {
          throw new Error('Cada objeto em "emailList" deve conter pelo menos "html" ou "templateId".');
        }
      }
  
      const emailService = EmailService.getInstance();
      const stateManager = new StateManager();
  
      // Array para armazenar os resultados de cada e-mail enviado
      const results = [];
  
      // Enviar cada e-mail da lista
      for (const emailData of emailList) {
        const { email, subject, templateId, html, clientName } = emailData;
  
        const result = await emailService.sendEmail(
          {
            emailDomain,
            fromName,
            to: email,
            subject,
            html: templateId ? `<p>Template ID: ${templateId}</p>` : html, // Substituir pelo conteúdo real do template
            clientName: clientName || fromName, // Usar clientName se estiver presente, caso contrário, usar fromName
          },
          uuid
        );
  
        // Atualiza o status do queueId com o mailId (uuid)
        await stateManager.updateQueueIdStatus(result.queueId, true, uuid);
  
        // Adiciona o resultado ao array de resultados
        results.push(result);
  
        // Log de sucesso
        logger.info(`E-mail enviado com sucesso:`, {
          uuid,
          queueId: result.queueId,
          email,
          subject,
          templateId,
          clientName,
        });
      }
  
      // Verifica se todos os e-mails foram processados
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