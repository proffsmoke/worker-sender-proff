// src/controllers/StatusController.ts

import { Request, Response, NextFunction } from 'express';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import config from '../config';
import MailerService from '../services/MailerService'; // Import adicionado

class StatusController {
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const version = '4.3.26-1'; // Atualize conforme necessário ou carregue de package.json
      const createdAt = new Date().getTime();
      const domain = config.mailer.noreplyEmail.split('@')[1] || 'unknown.com';
      const port25 = MailerService.isPort25Open();
      const status = MailerService.getStatus();

      // Pipeline de agregação atualizado para separar testes e envios em massa
      const aggregationResult = await EmailLog.aggregate([
        {
          $project: {
            type: {
              $cond: [
                { $eq: [{ $size: { $objectToArray: { $ifNull: ["$detail", {}] } } }, 0] },
                "test",
                "mass"
              ]
            },
            success: 1,
            detail: 1
          }
        },
        {
          $facet: {
            testEmails: [
              { $match: { type: "test" } },
              {
                $group: {
                  _id: null,
                  sent: { $sum: 1 },
                  successSent: { $sum: { $cond: ["$success", 1, 0] } },
                  failSent: { $sum: { $cond: ["$success", 0, 1] } }
                }
              }
            ],
            massEmails: [
              { $match: { type: "mass" } },
              { $project: { detailArray: { $objectToArray: "$detail" } } },
              { $unwind: "$detailArray" },
              {
                $group: {
                  _id: null,
                  sent: { $sum: 1 },
                  successSent: { $sum: { $cond: ["$detailArray.v.success", 1, 0] } },
                  failSent: { $sum: { $cond: ["$detailArray.v.success", 0, 1] } }
                }
              }
            ]
          }
        },
        {
          $project: {
            sent: {
              $add: [
                { $ifNull: [{ $arrayElemAt: ["$testEmails.sent", 0] }, 0] },
                { $ifNull: [{ $arrayElemAt: ["$massEmails.sent", 0] }, 0] }
              ]
            },
            successSent: {
              $add: [
                { $ifNull: [{ $arrayElemAt: ["$testEmails.successSent", 0] }, 0] },
                { $ifNull: [{ $arrayElemAt: ["$massEmails.successSent", 0] }, 0] }
              ]
            },
            failSent: {
              $add: [
                { $ifNull: [{ $arrayElemAt: ["$testEmails.failSent", 0] }, 0] },
                { $ifNull: [{ $arrayElemAt: ["$massEmails.failSent", 0] }, 0] }
              ]
            }
          }
        }
      ]);

      let sent = 0;
      let successSent = 0;
      let failSent = 0;

      if (aggregationResult.length > 0) {
        sent = aggregationResult[0].sent;
        successSent = aggregationResult[0].successSent;
        failSent = aggregationResult[0].failSent;
      }

      // Buscar os últimos 100 EmailLogs para exibição no status
      const emailLogs = await EmailLog.find()
        .sort({ sentAt: -1 })
        .limit(100)
        .lean();

      // Adicionar logs para depuração
      logger.debug(`Total emails enviados (sent): ${sent}`);
      logger.debug(`Emails enviados com sucesso (successSent): ${successSent}`);
      logger.debug(`Emails falhados (failSent): ${failSent}`);

      res.json({
        version,
        createdAt,
        sent,
        left: 0, // Se houver uma fila, ajuste este valor
        successSent,
        failSent,
        port25,
        domain,
        status, // Atualizado para refletir o status do MailerService
        emailLogs, // Adicionado
      });
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error(`Erro ao obter status: ${error.message}`, { stack: error.stack });
      }
      res.status(500).json({ success: false, message: 'Erro ao obter status.' });
    }
  }
}

export default new StatusController();
