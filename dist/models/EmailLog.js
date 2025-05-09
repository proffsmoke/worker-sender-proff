"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const EmailLogSchema = new mongoose_1.Schema({
    mailId: { type: String, required: true, index: true }, // UUID único
    queueId: { type: String, required: true, unique: true, index: true }, // Queue ID único
    email: { type: String, required: true, index: true },
    success: { type: Boolean, default: null }, // Inicialmente null
    updated: { type: Boolean, default: false }, // Inicialmente false
    sentAt: { type: Date, default: Date.now, expires: '48h', index: true }, // Expira após 48h
    errorMessage: { type: String, required: false }, // Opcional
}, {
    timestamps: true, // Adiciona campos createdAt e updatedAt automaticamente
    collection: 'emailLogs', // Nome da coleção no MongoDB
});
exports.default = mongoose_1.default.model('EmailLog', EmailLogSchema);
