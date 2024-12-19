// src/controllers/StatusController.ts

import { Request, Response, NextFunction } from 'express';
import MailerService from '../services/MailerService';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import config from '../config';

class StatusController {
    async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const version = '4.3.26-1'; // Atualize conforme necessário ou carregue de package.json
            const createdAt = MailerService.getCreatedAt().getTime();
            const domain = config.mailer.noreplyEmail.split('@')[1] || 'unknown.com';
            const port25 = MailerService.isPort25Open();
            const status = MailerService.getStatus(); // 'health' | 'blocked_permanently' | 'blocked_temporary'

            // Pipeline de agregação atualizado para contar todos os destinatários
            const aggregationResult = await EmailLog.aggregate([
                { $match: {} }, // Seleciona todos os documentos
                {
                    $project: {
                        toRecipient: "$email",
                        bccRecipients: {
                            $map: {
                                input: { $objectToArray: "$detail" },
                                as: "detailItem",
                                in: {
                                    recipient: "$$detailItem.k",
                                    success: "$$detailItem.v.success"
                                }
                            }
                        }
                    }
                },
                {
                    $project: {
                        recipients: {
                            $concatArrays: [
                                [ { recipient: "$toRecipient", success: "$success" } ],
                                "$bccRecipients"
                            ]
                        }
                    }
                },
                { $unwind: "$recipients" }, // Desmembra o array de destinatários
                {
                    $group: {
                        _id: null,
                        sent: { $sum: 1 }, // Total de destinatários enviados
                        successSent: { $sum: { $cond: [ "$recipients.success", 1, 0 ] } }, // Total de sucessos
                        failSent: { $sum: { $cond: [ "$recipients.success", 0, 1 ] } } // Total de falhas
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
                status,
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
