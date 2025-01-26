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
        this.mailerIdQueueMap = new Map(); // Novo mapa para mailerId
        this.uuidResultsMap = new Map();
        this.logGroups = new Map();
    }
    // Adiciona dados de envio ao pendingSends
    addPendingSend(queueId, data) {
        this.pendingSends.set(queueId, data);
        logger_1.default.info(`Dados de envio associados com sucesso para queueId=${queueId}.`);
    }
    // Obtém dados de envio do pendingSends
    getPendingSend(queueId) {
        return this.pendingSends.get(queueId);
    }
    // Remove dados de envio do pendingSends
    deletePendingSend(queueId) {
        this.pendingSends.delete(queueId);
    }
    // Verifica se um queueId já está associado a algum UUID
    isQueueIdAssociated(queueId) {
        for (const queueIds of this.uuidQueueMap.values()) {
            if (queueIds.has(queueId)) {
                return true;
            }
        }
        return false;
    }
    // Obtém todos os queueIds associados a um UUID
    getQueueIdsByUuid(uuid) {
        const queueIds = this.uuidQueueMap.get(uuid);
        return queueIds ? Array.from(queueIds) : undefined;
    }
    // Associa queueId a um mailerId
    addQueueIdToMailerId(mailerId, queueId) {
        if (!this.mailerIdQueueMap.has(mailerId)) {
            this.mailerIdQueueMap.set(mailerId, new Set());
        }
        const queueIds = this.mailerIdQueueMap.get(mailerId);
        if (queueIds && !queueIds.has(queueId)) {
            queueIds.add(queueId);
            logger_1.default.info(`Associado queueId ${queueId} ao mailerId ${mailerId}`);
        }
        else {
            logger_1.default.warn(`queueId ${queueId} já está associado ao mailerId ${mailerId}. Ignorando duplicação.`);
        }
    }
    // Consolida resultados de envio para um UUID
    async consolidateResultsByUuid(uuid) {
        const queueIds = this.uuidQueueMap.get(uuid);
        if (!queueIds)
            return undefined;
        // Busca resultados do EmailLog
        const resultsFromEmailLog = await this.getResultsFromEmailLog(uuid);
        if (resultsFromEmailLog) {
            return resultsFromEmailLog;
        }
        // Caso não encontre no EmailLog, tenta buscar do pendingSends
        const allResults = [];
        queueIds.forEach((queueId) => {
            const sendData = this.pendingSends.get(queueId);
            if (sendData) {
                allResults.push(...sendData.results);
            }
        });
        return allResults.length > 0 ? allResults : undefined;
    }
    // Busca resultados do EmailLog para um UUID
    async getResultsFromEmailLog(uuid) {
        try {
            const emailLogs = await EmailLog_1.default.find({ mailId: uuid });
            if (!emailLogs || emailLogs.length === 0)
                return undefined;
            const results = emailLogs.map((log) => ({
                recipient: log.email,
                success: log.success || false,
                queueId: log.queueId,
            }));
            return results;
        }
        catch (error) {
            logger_1.default.error(`Erro ao buscar resultados do EmailLog para UUID=${uuid}:`, error);
            return undefined;
        }
    }
    // Verifica se todos os queueIds de um UUID foram processados
    isUuidProcessed(uuid) {
        const queueIds = this.uuidQueueMap.get(uuid);
        if (!queueIds)
            return false;
        return [...queueIds].every((queueId) => !this.pendingSends.has(queueId));
    }
    // Atualiza o status de um queueId no EmailLog
    async updateQueueIdStatus(queueId, success, mailId) {
        try {
            let emailLog = await EmailLog_1.default.findOne({ queueId });
            if (!emailLog) {
                const sendData = this.getPendingSend(queueId);
                if (!sendData) {
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
            logger_1.default.info(`Status do queueId=${queueId} atualizado para success=${success} com mailId=${mailId}`);
        }
        catch (error) {
            logger_1.default.error(`Erro ao atualizar status do queueId=${queueId}:`, error);
        }
    }
    // Adiciona uma entrada de log a um grupo de logs
    addLogToGroup(queueId, logEntry) {
        const logGroup = this.logGroups.get(queueId) || { queueId, logs: [] };
        logGroup.logs.push(logEntry);
        this.logGroups.set(queueId, logGroup);
    }
    // Obtém um grupo de logs por queueId
    getLogGroup(queueId) {
        return this.logGroups.get(queueId);
    }
    // StateManager.ts
    // StateManager.ts
    async addQueueIdToUuid(uuid, queueId) {
        logger_1.default.info(`Tentando associar queueId=${queueId} ao UUID=${uuid}`);
        if (!this.uuidQueueMap.has(uuid)) {
            logger_1.default.info(`UUID ${uuid} não encontrado no uuidQueueMap. Criando novo Set.`);
            this.uuidQueueMap.set(uuid, new Set());
        }
        const queueIds = this.uuidQueueMap.get(uuid);
        if (queueIds && !queueIds.has(queueId)) {
            queueIds.add(queueId);
            logger_1.default.info(`Associado queueId ${queueId} ao UUID ${uuid}`);
            // Salvar a associação no EmailLog
            await this.saveQueueIdToEmailLog(queueId, uuid);
        }
        else {
            logger_1.default.warn(`queueId ${queueId} já está associado ao UUID ${uuid}. Ignorando duplicação.`);
        }
    }
    async saveQueueIdToEmailLog(queueId, mailId) {
        try {
            logger_1.default.info(`Tentando salvar queueId=${queueId} e mailId=${mailId} no EmailLog.`);
            const existingLog = await EmailLog_1.default.findOne({ queueId });
            if (!existingLog) {
                const emailLog = new EmailLog_1.default({
                    mailId, // UUID
                    queueId,
                    email: 'no-reply@unknown.com', // E-mail padrão
                    success: null, // Inicialmente null
                    updated: false,
                    sentAt: new Date(),
                    expireAt: new Date(Date.now() + 30 * 60 * 1000), // Expira em 30 minutos
                });
                await emailLog.save();
                logger_1.default.info(`Log salvo no EmailLog: queueId=${queueId}, mailId=${mailId}`);
            }
            else {
                logger_1.default.info(`Log já existe no EmailLog: queueId=${queueId}`);
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao salvar log no EmailLog:`, error);
        }
    }
    getUuidByQueueId(queueId) {
        logger_1.default.info(`Tentando obter UUID para queueId=${queueId}`);
        for (const [uuid, queueIds] of this.uuidQueueMap.entries()) {
            if (queueIds.has(queueId)) {
                logger_1.default.info(`UUID encontrado para queueId=${queueId}: ${uuid}`);
                return uuid;
            }
        }
        logger_1.default.warn(`UUID não encontrado para queueId=${queueId}`);
        return undefined;
    }
}
exports.default = StateManager;
