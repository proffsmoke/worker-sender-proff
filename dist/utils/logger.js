"use strict";
// src/utils/logger.ts
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = require("winston");
const customFormat = winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaString = '';
    if (Object.keys(meta).length > 0) {
        metaString = JSON.stringify(meta);
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaString}`;
}));
const logger = (0, winston_1.createLogger)({
    level: 'info',
    format: customFormat,
    transports: [
        new winston_1.transports.Console(),
        new winston_1.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston_1.transports.File({ filename: 'logs/combined.log' }),
    ],
});
exports.default = logger;
