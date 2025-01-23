"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tail_1 = require("tail");
const logger_1 = __importDefault(require("./utils/logger"));
const fs_1 = __importDefault(require("fs"));
const events_1 = __importDefault(require("events"));
class LogParser extends events_1.default {
    constructor(logFilePath = '/var/log/mail.log') {
        super();
        this.tail = null;
        this.recentLogs = new Set(); // Cache para evitar duplicados
        this.MAX_CACHE_SIZE = 100; // Limite do cache
        this.logFilePath = logFilePath;
        if (!fs_1.default.existsSync(this.logFilePath)) {
            logger_1.default.error(`Log file not found at path: ${this.logFilePath}`);
            throw new Error(`Log file not found: ${this.logFilePath}`);
        }
        this.tail = new tail_1.Tail(this.logFilePath, { useWatchFile: true });
    }
    startMonitoring() {
        if (!this.tail) {
            logger_1.default.error('Attempting to monitor logs without initializing Tail.');
            return;
        }
        this.tail.on('line', this.handleLogLine.bind(this));
        this.tail.on('error', (error) => {
            logger_1.default.error('Error monitoring logs:', error);
        });
        logger_1.default.info(`Monitoring log file: ${this.logFilePath}`);
    }
    handleLogLine(line) {
        try {
            const logEntry = this.parseLogLine(line);
            if (logEntry) {
                const logHash = `${logEntry.timestamp}-${logEntry.queueId}-${logEntry.result}`;
                if (this.recentLogs.has(logHash)) {
                    // Ignorar logs duplicados
                    logger_1.default.info(`Log duplicado ignorado: ${logHash}`);
                    return;
                }
                // Adicionar ao cache
                this.recentLogs.add(logHash);
                if (this.recentLogs.size > this.MAX_CACHE_SIZE) {
                    // Remover o log mais antigo do cache
                    this.recentLogs.delete([...this.recentLogs][0]);
                }
                logger_1.default.info(`Log analisado: ${JSON.stringify(logEntry)}`);
                this.emit('log', logEntry);
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao processar a linha do log: ${line}`, error);
        }
    }
    parseLogLine(line) {
        const match = line.match(/postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<(.*)>, .*, status=(.*)/);
        if (!match)
            return null;
        const [, queueId, email, result] = match;
        return {
            timestamp: new Date().toISOString(),
            queueId,
            email: email.trim(),
            result,
            success: result.startsWith('sent'), // Sucesso se o resultado começar com "sent"
        };
    }
}
exports.default = LogParser;
