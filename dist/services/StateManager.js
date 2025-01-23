"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class StateManager {
    constructor() {
        this.pendingSends = new Map();
        this.uuidQueueMap = new Map();
        this.uuidResultsMap = new Map();
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
        this.uuidQueueMap.get(uuid)?.push(queueId);
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
}
exports.default = StateManager;
