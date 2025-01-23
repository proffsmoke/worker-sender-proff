"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
class StateManager {
    constructor() {
        this.pendingSends = new Map();
        this.uuidQueueMap = new Map();
        this.uuidResultsMap = new Map();
        this.logGroups = new Map();
        this.mailIdQueueMap = new Map();
    }
    addPendingSend(queueId, data) {
        this.pendingSends.set(queueId, data);
    }
    getPendingSend(queueId) {
        return this.pendingSends.get(queueId);
    }
    deletePendingSend(queueId) {
        this.pendingSends.delete(queueId);
    }
    addQueueIdToUuid(uuid, queueId) {
        if (!this.uuidQueueMap.has(uuid)) {
            this.uuidQueueMap.set(uuid, []);
        }
        // Verifica se o queueId já está associado ao uuid
        if (!this.uuidQueueMap.get(uuid)?.includes(queueId)) {
            this.uuidQueueMap.get(uuid)?.push(queueId);
            logger_1.default.info(`Associado queueId ${queueId} ao uuid ${uuid}`);
        }
        else {
            logger_1.default.info(`queueId ${queueId} já está associado ao uuid ${uuid}`);
        }
    }
    getQueueIdsByUuid(uuid) {
        return this.uuidQueueMap.get(uuid);
    }
    getUuidQueueMap() {
        return this.uuidQueueMap;
    }
    addResultsToUuid(uuid, results) {
        this.uuidResultsMap.set(uuid, results);
    }
    getResultsByUuid(uuid) {
        return this.uuidResultsMap.get(uuid);
    }
    deleteResultsByUuid(uuid) {
        this.uuidResultsMap.delete(uuid);
    }
    addLogToGroup(queueId, logEntry) {
        const mailId = logEntry.mailId || 'unknown';
        const logGroup = this.logGroups.get(mailId) || { queueId, mailId, logs: [] };
        logGroup.logs.push(logEntry);
        this.logGroups.set(mailId, logGroup);
    }
    getLogGroup(mailId) {
        return this.logGroups.get(mailId);
    }
    addQueueIdToMailId(mailId, queueId) {
        if (!this.mailIdQueueMap.has(mailId)) {
            this.mailIdQueueMap.set(mailId, []);
        }
        this.mailIdQueueMap.get(mailId)?.push(queueId);
        logger_1.default.info(`Associado queueId ${queueId} ao mailId ${mailId}`); // Log para depuração
    }
    getQueueIdsByMailId(mailId) {
        return this.mailIdQueueMap.get(mailId);
    }
    isMailIdProcessed(mailId) {
        const queueIds = this.mailIdQueueMap.get(mailId);
        if (!queueIds)
            return false;
        return queueIds.every((queueId) => !this.pendingSends.has(queueId));
    }
    getResultsByMailId(mailId) {
        const queueIds = this.mailIdQueueMap.get(mailId);
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
}
exports.default = StateManager;
