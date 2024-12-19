// src/controllers/StatusController.ts

import { Request, Response, NextFunction } from 'express';
import MailerService from '../services/MailerService';
import EmailLog from '../models/EmailLog'; // Import adicionado
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

            // Atualizar as contagens para utilizar EmailLog
            const sent = await EmailLog.countDocuments({});
            const successSent = await EmailLog.countDocuments({ success: true });
            const failSent = await EmailLog.countDocuments({ success: false });
            const left = 0; // Se houver uma fila, ajuste este valor

            // Buscar os últimos 100 EmailLogs para exibição no status
            const emailLogs = await EmailLog.find()
                .sort({ sentAt: -1 })
                .limit(100)
                .lean();

            res.json({
                version,
                createdAt,
                sent,
                left,
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
