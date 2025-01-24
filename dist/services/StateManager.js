"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
const EmailLog_1 = __importDefault(require("../models/EmailLog")); // Importe o modelo de EmailLog
class StateManager {
    constructor() {
        this.pendingSends = new Map();
        this.uuidQueueMap = new Map(); // Mapeia UUID para queueIds (evita duplicação com Set)
        this.uuidResultsMap = new Map(); // Mapeia UUID para resultados
        this.logGroups = new Map(); // Agrupa logs por queueId
    }
    // Adiciona um envio pendente
    addPendingSend(queueId, data) {
        this.pendingSends.set(queueId, data);
        logger_1.default.info(`Dados de envio associados com sucesso para queueId=${queueId}.`);
    }
    // Obtém um envio pendente pelo queueId
    getPendingSend(queueId) {
        return this.pendingSends.get(queueId);
    }
    // Remove um envio pendente
    deletePendingSend(queueId) {
        this.pendingSends.delete(queueId);
    }
    // Adiciona um queueId ao UUID (Evita duplicação usando Set)
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
            logger_1.default.info(`queueId ${queueId} já está associado ao UUID ${uuid}, não será associado novamente.`);
        }
    }
    // Obtém todos os queueIds associados a um UUID
    getQueueIdsByUuid(uuid) {
        const queueIds = this.uuidQueueMap.get(uuid);
        return queueIds ? Array.from(queueIds) : undefined;
    }
    // Consolida resultados associados a um UUID
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
    // Verifica se um UUID foi completamente processado
    isUuidProcessed(uuid) {
        const queueIds = this.uuidQueueMap.get(uuid);
        if (!queueIds)
            return false;
        // Convertendo o Set para Array e usando every para verificar todos os queueIds
        return [...queueIds].every((queueId) => !this.pendingSends.has(queueId));
    }
    // Atualiza o status de um queueId com base no log
    async updateQueueIdStatus(queueId, success) {
        try {
            const emailLog = await EmailLog_1.default.findOne({ queueId }); // Buscando pelo queueId
            if (emailLog) {
                emailLog.success = success; // Atualiza o status
                emailLog.updated = true; // Marca como atualizado
                await emailLog.save();
                logger_1.default.info(`Status do queueId=${queueId} atualizado para success=${success}`);
            }
            else {
                logger_1.default.warn(`EmailLog não encontrado para queueId=${queueId}`);
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao atualizar status do queueId=${queueId}:`, error);
        }
    }
    // Adiciona um log a um grupo de logs
    addLogToGroup(queueId, logEntry) {
        const logGroup = this.logGroups.get(queueId) || { queueId, logs: [] };
        logGroup.logs.push(logEntry);
        this.logGroups.set(queueId, logGroup);
    }
    // Obtém um grupo de logs pelo queueId
    getLogGroup(queueId) {
        return this.logGroups.get(queueId);
    }
    // Obtém o UUID associado a um queueId
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
