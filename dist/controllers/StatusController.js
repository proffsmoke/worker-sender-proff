"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const os_1 = __importDefault(require("os")); // Adicionado para obter o hostname
const EmailLog_1 = __importDefault(require("../models/EmailLog"));
const EmailStats_1 = __importDefault(require("../models/EmailStats"));
const MailerService_1 = __importDefault(require("../services/MailerService"));
const logger_1 = __importDefault(require("../utils/logger"));
class StatusController {
    /**
     * Obtém o status atual do sistema, incluindo métricas de envio de emails e logs recentes.
     * @param req - Objeto de requisição do Express.
     * @param res - Objeto de resposta do Express.
     * @param next - Função de próximo middleware do Express.
     */
    async getStatus(req, res, next) {
        try {
            // Obter informações do sistema
            const version = MailerService_1.default.getVersion();
            const createdAt = MailerService_1.default.getCreatedAt().getTime();
            // Calcular o domínio do hostname do sistema
            const hostname = os_1.default.hostname();
            const domainParts = hostname.split('.').slice(1);
            const domain = domainParts.length > 0 ? domainParts.join('.') : 'unknown.com';
            const status = MailerService_1.default.getStatus();
            const blockReason = MailerService_1.default.getBlockReason();
            // Obter métricas diretamente do modelo de estatísticas
            const stats = await EmailStats_1.default.findOne({});
            const sent = stats?.sent || 0;
            const successSent = stats?.successSent || 0;
            const failSent = stats?.failSent || 0;
            // Buscar os últimos 100 logs de email
            const emailLogs = await EmailLog_1.default.find()
                .sort({ sentAt: -1 })
                .limit(100)
                .lean();
            logger_1.default.debug(`Métricas obtidas: sent=${sent}, successSent=${successSent}, failSent=${failSent}`);
            // Construir resposta JSON
            const response = {
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
        }
        catch (error) {
            logger_1.default.error(`Erro ao obter status: ${error}`);
            res.status(500).json({ success: false, message: 'Erro ao obter status.' });
        }
    }
}
exports.default = new StatusController();
