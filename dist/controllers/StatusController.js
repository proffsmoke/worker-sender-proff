"use strict";
// src/controllers/StatusController.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const MailerService_1 = __importDefault(require("../services/MailerService"));
const EmailLog_1 = __importDefault(require("../models/EmailLog"));
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
            // Pipeline de agregação atualizado para contar todos os destinatários
            const aggregationResult = await EmailLog_1.default.aggregate([
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
                                [{ recipient: "$toRecipient", success: "$success" }],
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
                        successSent: { $sum: { $cond: ["$recipients.success", 1, 0] } }, // Total de sucessos
                        failSent: { $sum: { $cond: ["$recipients.success", 0, 1] } } // Total de falhas
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
            const emailLogs = await EmailLog_1.default.find()
                .sort({ sentAt: -1 })
                .limit(100)
                .lean();
            // Adicionar logs para depuração
            logger_1.default.debug(`Total emails enviados (sent): ${sent}`);
            logger_1.default.debug(`Emails enviados com sucesso (successSent): ${successSent}`);
            logger_1.default.debug(`Emails falhados (failSent): ${failSent}`);
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
