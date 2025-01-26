"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
// Schema do Mongoose
const EmailQueueSchema = new mongoose_1.Schema({
    uuid: { type: String, required: true, unique: true },
    queueIds: [
        {
            queueId: { type: String, required: true },
            email: { type: String, required: true },
            success: { type: Boolean, default: null }, // Permite null
        },
    ],
});
// Modelo do Mongoose
const EmailQueueModel = (0, mongoose_1.model)('EmailQueue', EmailQueueSchema);
exports.default = EmailQueueModel;
