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
/**
 * Esquema para armazenar estatísticas de envio de emails.
 */
const EmailStatsSchema = new mongoose_1.Schema({
    sent: { type: Number, default: 0 }, // Contador de emails enviados
    successSent: { type: Number, default: 0 }, // Contador de emails enviados com sucesso
    failSent: { type: Number, default: 0 }, // Contador de emails que falharam
}, {
    collection: 'email_stats', // Nome da coleção no banco de dados
    versionKey: false, // Desabilita o campo "__v"
});
/**
 * Incrementa o número total de emails enviados.
 * @param count - Quantidade a incrementar (padrão: 1).
 */
EmailStatsSchema.statics.incrementSent = async function (count = 1) {
    await this.findOneAndUpdate({}, { $inc: { sent: count } }, { upsert: true, new: true });
};
/**
 * Incrementa o número de emails enviados com sucesso.
 * @param count - Quantidade a incrementar (padrão: 1).
 */
EmailStatsSchema.statics.incrementSuccess = async function (count = 1) {
    await this.findOneAndUpdate({}, { $inc: { successSent: count } }, { upsert: true, new: true });
};
/**
 * Incrementa o número de emails que falharam.
 * @param count - Quantidade a incrementar (padrão: 1).
 */
EmailStatsSchema.statics.incrementFail = async function (count = 1) {
    await this.findOneAndUpdate({}, { $inc: { failSent: count } }, { upsert: true, new: true });
};
const EmailStats = mongoose_1.default.model('EmailStats', EmailStatsSchema);
exports.default = EmailStats;
