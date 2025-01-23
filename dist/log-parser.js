"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tail_1 = require("tail");
const logger_1 = __importDefault(require("./utils/logger"));
const fs_1 = __importDefault(require("fs"));
const events_1 = __importDefault(require("events"));
const path_1 = __importDefault(require("path"));
class LogParser extends events_1.default {
    constructor(logFilePath = '/var/log/mail.log') {
        super();
        this.tail = null;
        this.recentLogs = [];
        this.logHashes = new Set();
        this.MAX_CACHE_SIZE = 1000;
        this.isMonitoringStarted = false;
        this.logFilePath = logFilePath;
        if (!fs_1.default.existsSync(this.logFilePath)) {
            logger_1.default.error(`Log file not found at path: ${this.logFilePath}`);
            throw new Error(`Log file not found: ${this.logFilePath}`);
        }
        this.tail = new tail_1.Tail(this.logFilePath, { useWatchFile: true });
    }
    startMonitoring() {
        if (this.isMonitoringStarted) {
            const stackTrace = new Error().stack;
            const callerInfo = this.getCallerInfo(stackTrace);
            logger_1.default.warn(`Monitoramento de logs já iniciado. Chamado por: ${callerInfo}`);
            return;
        }
        if (!this.tail) {
            logger_1.default.error('Attempting to monitor logs without initializing Tail.');
            return;
        }
        this.tail.on('line', this.handleLogLine.bind(this));
        this.tail.on('error', (error) => {
            logger_1.default.error('Error monitoring logs:', error);
        });
        this.isMonitoringStarted = true;
        logger_1.default.info(`Monitoring log file: ${this.logFilePath}`);
    }
    getCallerInfo(stackTrace) {
        if (!stackTrace)
            return 'Desconhecido';
        const stackLines = stackTrace.split('\n');
        if (stackLines.length >= 4) {
            const callerLine = stackLines[3].trim();
            const match = callerLine.match(/at (.+) \((.+):(\d+):(\d+)\)/);
            if (match) {
                const [, functionName, filePath, line, column] = match;
                const fileName = path_1.default.basename(filePath);
                return `${functionName} (${fileName}:${line}:${column})`;
            }
        }
        return 'Desconhecido';
    }
    handleLogLine(line) {
        try {
            const logEntry = this.parseLogLine(line);
            if (logEntry) {
                const logHash = `${logEntry.timestamp}-${logEntry.queueId}-${logEntry.result}`;
                if (this.logHashes.has(logHash)) {
                    logger_1.default.info(`Log duplicado ignorado: ${logHash}`);
                    return;
                }
                this.recentLogs.push(logEntry);
                this.logHashes.add(logHash);
                if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
                    const oldestLog = this.recentLogs.shift();
                    if (oldestLog) {
                        const oldestHash = `${oldestLog.timestamp}-${oldestLog.queueId}-${oldestLog.result}`;
                        this.logHashes.delete(oldestHash);
                    }
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
            success: result.startsWith('sent'),
        };
    }
    getRecentLogs() {
        return this.recentLogs;
    }
}
exports.default = LogParser;
