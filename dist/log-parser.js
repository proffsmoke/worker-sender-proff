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
        this.recentLogs = []; // Cache para evitar duplicados
        this.MAX_CACHE_SIZE = 1000; // Aumentando o tamanho do cache
        this.isMonitoringStarted = false; // Flag para evitar inicialização dupla
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
        // Verifica se o monitoramento já foi iniciado
        if (this.isMonitoringStarted) {
            const stackTrace = new Error().stack; // Captura a stack trace
            const callerInfo = this.getCallerInfo(stackTrace); // Extrai informações do chamador
            logger_1.default.warn(`Monitoramento de logs já iniciado. Chamado por: ${callerInfo}`);
            return;
        }
        this.tail.on('line', this.handleLogLine.bind(this));
        this.tail.on('error', (error) => {
            logger_1.default.error('Error monitoring logs:', error);
        });
        this.isMonitoringStarted = true; // Marca como iniciado
        logger_1.default.info(`Monitoring log file: ${this.logFilePath}`);
    }
    getCallerInfo(stackTrace) {
        if (!stackTrace)
            return 'Desconhecido';
        // Divide a stack trace em linhas
        const stackLines = stackTrace.split('\n');
        // A linha 3 da stack trace contém informações sobre o chamador
        if (stackLines.length >= 4) {
            const callerLine = stackLines[3].trim();
            const match = callerLine.match(/at (.+) \((.+):(\d+):(\d+)\)/);
            if (match) {
                const [, functionName, filePath, line, column] = match;
                const fileName = path_1.default.basename(filePath); // Extrai o nome do arquivo
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
                // Verifica se o log já está no cache
                if (this.recentLogs.some(log => `${log.timestamp}-${log.queueId}-${log.result}` === logHash)) {
                    logger_1.default.info(`Log duplicado ignorado: ${logHash}`);
                    return;
                }
                // Adiciona ao cache
                this.recentLogs.push(logEntry);
                if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
                    this.recentLogs.shift(); // Remove o log mais antigo
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
    getRecentLogs() {
        return this.recentLogs;
    }
}
exports.default = LogParser;
