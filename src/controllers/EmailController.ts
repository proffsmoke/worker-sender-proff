import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import EmailQueueModel from '../models/EmailQueueModel';

class EmailController {
  constructor() {
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
        logger.info(`Novo documento criado para UUID=${uuid}`);
      } else {
        logger.info(`Documento existente encontrado para UUID=${uuid}`);
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

        // Adiciona o resultado ao array de queueIds (com email e success como null)
        emailQueue.queueIds.push({
          queueId: result.queueId,
          email,
          success: null, // Deixa como null por enquanto
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

      // Tenta salvar o documento no banco de dados
      await this.saveEmailQueue(emailQueue, uuid);

      // Retorna a resposta de sucesso
      this.sendSuccessResponse(res, emailQueue);
    } catch (error) {
      this.handleError(res, error);
    }
  }

  // Método para salvar o EmailQueue no banco de dados
  private async saveEmailQueue(emailQueue: any, uuid: string): Promise<void> {
    try {
      await emailQueue.save();
      console.log('Dados salvos com sucesso:', emailQueue); // Confirmação no console
      logger.info(`Dados salvos com sucesso para UUID=${uuid}`, { emailQueue });
    } catch (saveError) {
      console.error('Erro ao salvar os dados:', saveError); // Log de erro no console
      logger.error(`Erro ao salvar os dados para UUID=${uuid}:`, saveError);
      throw new Error('Erro ao salvar os dados no banco de dados.');
    }
  }

  // Método para enviar resposta de sucesso
  private sendSuccessResponse(
    res: Response,
    emailQueue: { uuid: string; queueIds: Array<{ queueId: string; email: string; success: boolean | null }> }
  ): void {
    res.json({
      success: true,
      uuid: emailQueue.uuid,
      queueIds: emailQueue.queueIds.map(q => ({
        queueId: q.queueId,
        email: q.email,
        success: q.success, // Pode ser null
      })),
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