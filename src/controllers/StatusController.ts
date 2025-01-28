import { Request, Response, NextFunction } from 'express';
import os from 'os'; // Adicionado para obter o hostname
import EmailLog from '../models/EmailLog';
import EmailStats from '../models/EmailStats';
import config from '../config';
import MailerService from '../services/MailerService';
import logger from '../utils/logger';

class StatusController {
  /**
   * Obtém o status atual do sistema, incluindo métricas de envio de emails e logs recentes.
   * @param req - Objeto de requisição do Express.
   * @param res - Objeto de resposta do Express.
   * @param next - Função de próximo middleware do Express.
   */
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Obter informações do sistema
      const version = MailerService.getVersion();
      const createdAt = MailerService.getCreatedAt().getTime();

      // Calcular o domínio do hostname do sistema
      const hostname = os.hostname();
      const domainParts = hostname.split('.').slice(1);
      const domain = domainParts.length > 0 ? domainParts.join('.') : 'unknown.com';

      const status = MailerService.getStatus();
      const blockReason = MailerService.getBlockReason();

      // Obter métricas diretamente do modelo de estatísticas
      const stats = await EmailStats.findOne({});
      const sent = stats?.sent || 0;
      const successSent = stats?.successSent || 0;
      const failSent = stats?.failSent || 0;

      // Buscar os últimos 100 logs de email
      const emailLogs = await EmailLog.find()
        .sort({ sentAt: -1 })
        .limit(100)
        .lean();

      logger.debug(`Métricas obtidas: sent=${sent}, successSent=${successSent}, failSent=${failSent}`);

      // Construir resposta JSON
      const response: any = {
        version,
        createdAt,
        sent,
        left: 0, // Valor fixo, pode ser ajustado conforme necessário
        successSent,
        failSent,
        domain,
        status,
        emailLogs,
      };

      // Adicionar razão do bloqueio, se aplicável
      if (status === 'blocked_permanently' || status === 'blocked_temporary') {
        response.blockReason = blockReason;
      }

      res.json(response);
    } catch (error) {
      logger.error(`Erro ao obter status: ${error}`);
      res.status(500).json({ success: false, message: 'Erro ao obter status.' });
    }
  }
}

export default new StatusController();
