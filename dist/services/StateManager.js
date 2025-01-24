"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
const EmailLog_1 = __importDefault(require("../models/EmailLog"));
class StateManager {
    constructor() {
        this.pendingSends = new Map();
        this.uuidQueueMap = new Map();
        this.uuidResultsMap = new Map();
        this.logGroups = new Map();
    }
    addPendingSend(queueId, data) {
        this.pendingSends.set(queueId, data);
        logger_1.default.info(`Dados de envio associados com sucesso para queueId=${queueId}.`);
    }
    getPendingSend(queueId) {
        return this.pendingSends.get(queueId);
    }
    deletePendingSend(queueId) {
        this.pendingSends.delete(queueId);
    }
    addQueueIdToUuid(uuid, queueId) {
        if (!this.uuidQueueMap.has(uuid)) {
            this.uuidQueueMap.set(uuid, new Set());
        }
        const queueIds = this.uuidQueueMap.get(uuid);
        if (queueIds && !queueIds.has(queueId)) {
            queueIds.add(queueId);
            logger_1.default.info(`Associado queueId ${queueId} ao UUID ${uuid}`);
        }
        else {
            logger_1.default.warn(`queueId ${queueId} já está associado ao UUID ${uuid}. Ignorando duplicação.`);
        }
    }
    isQueueIdAssociated(queueId) {
        for (const queueIds of this.uuidQueueMap.values()) {
            if (queueIds.has(queueId)) {
                return true;
            }
        }
        return false;
    }
    getQueueIdsByUuid(uuid) {
        const queueIds = this.uuidQueueMap.get(uuid);
        return queueIds ? Array.from(queueIds) : undefined;
    }
    consolidateResultsByUuid(uuid) {
        const queueIds = this.uuidQueueMap.get(uuid);
        if (!queueIds)
            return undefined;
        const allResults = [];
        queueIds.forEach((queueId) => {
            const sendData = this.pendingSends.get(queueId);
            if (sendData) {
                allResults.push(...sendData.results);
            }
        });
        return allResults;
    }
    isUuidProcessed(uuid) {
        const queueIds = this.uuidQueueMap.get(uuid);
        if (!queueIds)
            return false;
        return [...queueIds].every((queueId) => !this.pendingSends.has(queueId));
    }
    async updateQueueIdStatus(queueId, success, mailId) {
        try {
            let emailLog = await EmailLog_1.default.findOne({ queueId });
            if (!emailLog) {
                const sendData = this.getPendingSend(queueId);
                if (!sendData) {
                    logger_1.default.warn(`Nenhum dado encontrado no pendingSends para queueId=${queueId}`);
                    return;
                }
                const email = sendData.toRecipients[0] || 'no-reply@unknown.com';
                emailLog = new EmailLog_1.default({
                    mailId,
                    queueId,
                    email,
                    success,
                    updated: true,
                    sentAt: new Date(),
                    expireAt: new Date(Date.now() + 30 * 60 * 1000),
                });
            }
            else {
                emailLog.success = success;
                emailLog.updated = true;
            }
            await emailLog.save();
            logger_1.default.info(`Status do queueId=${queueId} atualizado para success=${success}`);
        }
        catch (error) {
            logger_1.default.error(`Erro ao atualizar status do queueId=${queueId}:`, error);
        }
    }
    addLogToGroup(queueId, logEntry) {
        const logGroup = this.logGroups.get(queueId) || { queueId, logs: [] };
        logGroup.logs.push(logEntry);
        this.logGroups.set(queueId, logGroup);
    }
    getLogGroup(queueId) {
        return this.logGroups.get(queueId);
    }
    getUuidByQueueId(queueId) {
        for (const [uuid, queueIds] of this.uuidQueueMap.entries()) {
            if (queueIds.has(queueId)) {
                return uuid;
            }
        }
        return undefined;
    }
}
exports.default = StateManager;
