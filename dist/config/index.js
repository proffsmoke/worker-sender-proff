"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/config/index.ts
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const config = {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 7777,
    mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/mailer',
    auth: {
        login: process.env.AUTH_LOGIN || 'mailer',
        password: process.env.AUTH_PASSWORD || 'mailerPass123!',
    },
    mailer: {
        noreplyEmail: process.env.MAILER_NOREPLY_EMAIL || 'microsoft-noreply@microsoft.com',
        checkInterval: process.env.MAILER_CHECK_INTERVAL
            ? parseInt(process.env.MAILER_CHECK_INTERVAL, 10)
            : 20000, // 20 segundos
        temporaryBlockDuration: process.env.MAILER_TEMPORARY_BLOCK_DURATION
            ? parseInt(process.env.MAILER_TEMPORARY_BLOCK_DURATION, 10)
            : 300000, // 5 minutos em ms
    },
};
exports.default = config;
