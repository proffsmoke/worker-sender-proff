import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import StateManager from '../services/StateManager';

class EmailController {
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { mailerId, fromName, emailDomain, emailList, uuid } = req.body;

    try {
      // Validação básica dos parâmetros
      if (!mailerId || !fromName || !emailDomain || !uuid) {
        throw new Error('Parâmetros obrigatórios faltando: mailerId, fromName, emailDomain, uuid.');
      }

      if (!emailList || !Array.isArray(emailList) || emailList.length === 0) {
        throw new Error('A lista de e-mails (emailList) é obrigatória e deve conter pelo menos um e-mail.');
      }

      const emailService = EmailService.getInstance();
      const stateManager = new StateManager();

      // Enviar a lista de e-mails
      const results = await this.sendEmailList(emailService, stateManager, {
        mailerId,
        fromName,
        emailDomain,
        emailList,
        uuid,
      });

      // Verifica se todos os e-mails foram processados
      if (stateManager.isUuidProcessed(uuid)) {
        const consolidatedResults = await stateManager.consolidateResultsByUuid(uuid);
        if (consolidatedResults) {
          logger.info(`Resultados consolidados para uuid=${uuid}:`, consolidatedResults);
          this.sendSuccessResponse(res, uuid, mailerId, consolidatedResults);
        } else {
          this.sendSuccessResponse(res, uuid, mailerId, results);
        }
      } else {
        this.sendSuccessResponse(res, uuid, mailerId, results);
      }
    } catch (error) {
      this.handleError(res, error);
    }
  }

  // Método para enviar a lista de e-mails
  private async sendEmailList(
    emailService: EmailService,
    stateManager: StateManager,
    params: {
      mailerId: string;
      fromName: string;
      emailDomain: string;
      emailList: any[];
      uuid: string;
    }
  ): Promise<any[]> {
    const { mailerId, fromName, emailDomain, emailList, uuid } = params;

    return Promise.all(
      emailList.map(async (emailItem) => {
        try {
          const result = await emailService.sendEmail(
            {
              mailerId,
              fromName,
              emailDomain,
              to: emailItem.email,
              subject: emailItem.subject,
              html: `<p>Template ID: ${emailItem.templateId}</p>`, // Substituir pelo conteúdo real do template
              clientName: fromName, // Usar o fromName como clientName
            },
            uuid
          );

          // Atualiza o status do queueId com o mailId (uuid)
          await stateManager.updateQueueIdStatus(result.queueId, true, uuid);
          return result;
        } catch (error) {
          logger.error(`Erro ao enviar e-mail para ${emailItem.email}:`, error);
          return {
            recipient: emailItem.email,
            success: false,
            error: error instanceof Error ? error.message : 'Erro desconhecido',
          };
        }
      })
    );
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
      logger.error(`Erro ao enviar e-mails:`, error);
      res.status(500).json({
        success: false,
        message: 'Erro ao enviar e-mails.',
        error: error.message,
      });
    } else {
      logger.error(`Erro desconhecido ao enviar e-mails:`, error);
      res.status(500).json({
        success: false,
        message: 'Erro desconhecido ao enviar e-mails.',
      });
    }
  }
}

export default new EmailController();