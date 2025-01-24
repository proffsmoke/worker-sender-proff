"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = require("winston");
// Formato personalizado para os logs
const customFormat = winston_1.format.combine(winston_1.format.timestamp(), // Adiciona um timestamp ao log
winston_1.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaString = '';
    if (Object.keys(meta).length > 0) {
        metaString = JSON.stringify(meta); // Converte metadados em string JSON
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaString}`;
}));
// Configuração do logger
const logger = (0, winston_1.createLogger)({
    level: 'info', // Nível mínimo de log (info, error, etc.)
    format: customFormat, // Usa o formato personalizado
    transports: [
        new winston_1.transports.Console(), // Saída para o console
        new winston_1.transports.File({ filename: 'logs/error.log', level: 'error' }), // Arquivo para logs de erro
        new winston_1.transports.File({ filename: 'logs/combined.log' }), // Arquivo para todos os logs
    ],
});
exports.default = logger;
