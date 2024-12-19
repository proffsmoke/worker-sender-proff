"use strict";
// src/controllers/StatusController.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const MailerService_1 = __importDefault(require("../services/MailerService"));
const Log_1 = __importDefault(require("../models/Log"));
const EmailLog_1 = __importDefault(require("../models/EmailLog")); // Import adicionado
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
class StatusController {
    async getStatus(req, res, next) {
        try {
            const version = '4.3.26-1'; // Atualize conforme necessário ou carregue de package.json
            const createdAt = MailerService_1.default.getCreatedAt().getTime();
            const domain = config_1.default.mailer.noreplyEmail.split('@')[1] || 'unknown.com';
            const port25 = MailerService_1.default.isPort25Open();
            const status = MailerService_1.default.getStatus(); // 'health' | 'blocked_permanently' | 'blocked_temporary'
            const sent = await Log_1.default.countDocuments({});
            const successSent = await Log_1.default.countDocuments({ success: true });
            const failSent = await Log_1.default.countDocuments({ success: false });
            const left = 0; // Se houver uma fila, ajuste este valor
            const logs = await Log_1.default.find().sort({ sentAt: -1 }).limit(500).lean();
            // Buscar os últimos 100 EmailLogs para exibição no status
            const emailLogs = await EmailLog_1.default.find()
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
                logs,
                emailLogs, // Adicionado
            });
        }
        catch (error) {
            if (error instanceof Error) {
                logger_1.default.error(`Erro ao obter status: ${error.message}`, { stack: error.stack });
            }
            res.status(500).json({ success: false, message: 'Erro ao obter status.' });
        }
    }
}
exports.default = new StatusController();
