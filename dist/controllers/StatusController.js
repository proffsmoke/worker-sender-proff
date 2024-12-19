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
            // Pipeline de agregação atualizado para separar testes e envios em massa
            const aggregationResult = await EmailLog_1.default.aggregate([
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
                            { $unwind: "$detail" },
                            {
                                $group: {
                                    _id: null,
                                    sent: { $sum: 1 },
                                    successSent: { $sum: { $cond: ["$detail.success", 1, 0] } },
                                    failSent: { $sum: { $cond: ["$detail.success", 0, 1] } }
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
