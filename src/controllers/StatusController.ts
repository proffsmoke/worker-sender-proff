import { Request, Response, NextFunction } from 'express';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import config from '../config';
import MailerService from '../services/MailerService';

class StatusController {
  /**
   * Obtém o status atual do sistema, incluindo métricas de envio de emails e logs recentes.
   * @param req - Objeto de requisição do Express.
   * @param res - Objeto de resposta do Express.
   * @param next - Função de próximo middleware do Express.
   */
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Obter informações do MailerService
      const version = MailerService.getVersion(); // Versão do MailerService
      const createdAt = MailerService.getCreatedAt().getTime(); // Tempo de criação do MailerService
      const domain = config.mailer.noreplyEmail.split('@')[1] || 'unknown.com'; // Domínio do email
      const status = MailerService.getStatus(); // Status atual do MailerService
      const blockReason = MailerService.getBlockReason(); // Razão do bloqueio, se houver

      // Calcular métricas de envio de emails
      const { sent, successSent, failSent } = await this.calculateEmailMetrics();

      // Buscar os últimos 100 logs de email para exibição no status
      const emailLogs = await EmailLog.find()
        .sort({ sentAt: -1 }) // Ordena por data de envio (mais recentes primeiro)
        .limit(100) // Limita a 100 registros
        .lean(); // Retorna objetos JavaScript simples

      // Adicionar logs para depuração
      logger.debug(`Total emails enviados (sent): ${sent}`);
      logger.debug(`Emails enviados com sucesso (successSent): ${successSent}`);
      logger.debug(`Emails falhados (failSent): ${failSent}`);

      // Preparar a resposta JSON
      const response: any = {
        version,
        createdAt,
        sent,
        left: 0, // Se houver uma fila, ajuste este valor
        successSent,
        failSent,
        domain,
        status,
        emailLogs, // Inclui os últimos logs de email
      };

      // Incluir a razão do bloqueio, se o Mailer estiver bloqueado
      if (status === 'blocked_permanently' || status === 'blocked_temporary') {
        response.blockReason = blockReason;
      }

      // Retornar a resposta
      res.json(response);
    } catch (error: unknown) {
      // Tratamento de erros
      if (error instanceof Error) {
        logger.error(`Erro ao obter status: ${error.message}`, { stack: error.stack });
      }
      res.status(500).json({ success: false, message: 'Erro ao obter status.' });
    }
  }

  /**
   * Calcula as métricas de envio de emails (total enviado, sucessos e falhas).
   * @returns Um objeto contendo as métricas de envio.
   */
  private async calculateEmailMetrics(): Promise<{ sent: number; successSent: number; failSent: number }> {
    try {
      // Agregação para calcular métricas de emails de teste e envios em massa
      const aggregationResult = await EmailLog.aggregate([
        {
          $project: {
            type: {
              $cond: [
                { $eq: [{ $size: { $objectToArray: { $ifNull: ['$detail', {}] } } }, 0] },
                'test', // Se não houver detalhes, é um email de teste
                'mass', // Caso contrário, é um envio em massa
              ],
            },
            success: 1,
            detail: 1,
          },
        },
        {
          $facet: {
            testEmails: [
              { $match: { type: 'test' } }, // Filtra emails de teste
              {
                $group: {
                  _id: null,
                  sent: { $sum: 1 }, // Total de emails de teste enviados
                  successSent: { $sum: { $cond: ['$success', 1, 0] } }, // Emails de teste com sucesso
                  failSent: { $sum: { $cond: ['$success', 0, 1] } }, // Emails de teste falhados
                },
              },
            ],
            massEmails: [
              { $match: { type: 'mass' } }, // Filtra envios em massa
              { $project: { detailArray: { $objectToArray: '$detail' } } }, // Converte o objeto "detail" em array
              { $unwind: '$detailArray' }, // Desestrutura o array para processar cada destinatário
              {
                $group: {
                  _id: null,
                  sent: { $sum: 1 }, // Total de envios em massa
                  successSent: { $sum: { $cond: ['$detailArray.v.success', 1, 0] } }, // Envios em massa com sucesso
                  failSent: { $sum: { $cond: ['$detailArray.v.success', 0, 1] } }, // Envios em massa falhados
                },
              },
            ],
          },
        },
        {
          $project: {
            sent: {
              $add: [
                { $ifNull: [{ $arrayElemAt: ['$testEmails.sent', 0] }, 0] }, // Total de emails de teste
                { $ifNull: [{ $arrayElemAt: ['$massEmails.sent', 0] }, 0] }, // Total de envios em massa
              ],
            },
            successSent: {
              $add: [
                { $ifNull: [{ $arrayElemAt: ['$testEmails.successSent', 0] }, 0] }, // Sucessos em emails de teste
                { $ifNull: [{ $arrayElemAt: ['$massEmails.successSent', 0] }, 0] }, // Sucessos em envios em massa
              ],
            },
            failSent: {
              $add: [
                { $ifNull: [{ $arrayElemAt: ['$testEmails.failSent', 0] }, 0] }, // Falhas em emails de teste
                { $ifNull: [{ $arrayElemAt: ['$massEmails.failSent', 0] }, 0] }, // Falhas em envios em massa
              ],
            },
          },
        },
      ]);

      // Extrair métricas do resultado da agregação
      const metrics = aggregationResult.length > 0 ? aggregationResult[0] : { sent: 0, successSent: 0, failSent: 0 };
      return metrics;
    } catch (error) {
      logger.error(`Erro ao calcular métricas de envio de emails: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
      return { sent: 0, successSent: 0, failSent: 0 }; // Retorna valores padrão em caso de erro
    }
  }
}

export default new StatusController();