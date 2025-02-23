"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// EmailQueueModel.ts
const mongoose_1 = require("mongoose");
const EmailQueueSchema = new mongoose_1.Schema({
    uuid: { type: String, required: true, unique: true },
    queueIds: [
        {
            queueId: { type: String, required: true },
            email: { type: String, required: true },
            success: { type: Boolean, default: null },
            mailId: { type: String, default: null }
        },
    ],
    resultSent: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now, expires: '48h' },
}, {
    timestamps: true, // cria createdAt e updatedAt automaticamente
});
// Índice para acelerar a busca pelo queueId
EmailQueueSchema.index({ 'queueIds.queueId': 1 });
exports.default = (0, mongoose_1.model)('EmailQueue', EmailQueueSchema);
