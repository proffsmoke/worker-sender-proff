// src/controllers/StatusController.ts

import { Request, Response, NextFunction } from 'express';
import MailerService from '../services/MailerService';
import Log from '../models/Log';
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

            const sent = await Log.countDocuments({});
            const successSent = await Log.countDocuments({ success: true });
            const failSent = await Log.countDocuments({ success: false });
            const left = 0; // Se houver uma fila, ajuste este valor

            const logs = await Log.find().sort({ sentAt: -1 }).limit(500).lean();

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
                logs,
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
