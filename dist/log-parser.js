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
        this.logFilePath = logFilePath;
        this.startTime = new Date();
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
    stopMonitoring() {
        if (this.tail) {
            this.tail.unwatch();
            logger_1.default.info('Log monitoring stopped.');
        }
        else {
            logger_1.default.warn('No active monitoring to stop.');
        }
    }
    handleLogLine(line) {
        try {
            const logTimestamp = this.extractTimestamp(line);
            if (logTimestamp && logTimestamp < this.startTime) {
                return; // Ignora logs antigos
            }
            // Tenta extrair informações do log
            const logEntry = this.parseLogLine(line);
            if (logEntry) {
                logger_1.default.debug(`LogParser captured: ${JSON.stringify(logEntry)}`);
                this.emit('log', logEntry);
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing log line: ${line}`, error);
        }
    }
    parseLogLine(line) {
        const match = line.match(/postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<(.*)>, .*, status=(.*)/);
        if (!match)
            return null;
        const [, mailId, email, result] = match;
        // Extração do queueId
        const queueIdMatch = result.match(/<([^>]+)>/); // Captura o queueId entre os sinais de menor e maior
        const queueId = queueIdMatch ? queueIdMatch[1] : ''; // Se não encontrar, usa string vazia
        const isBulk = email.includes(','); // Verifica se é um envio em massa
        const emails = isBulk ? email.split(',') : [email]; // Separa os e-mails se for envio em massa
        // Retorna um objeto para cada e-mail
        return {
            timestamp: new Date().toISOString(), // Adiciona um timestamp atual
            mailId,
            queueId, // Agora inclui o queueId no objeto
            email: emails[0].trim(), // Considera apenas o primeiro e-mail para simplificar
            result,
            success: result.startsWith('sent'), // Determina se o envio foi bem-sucedido
        };
    }
    extractTimestamp(line) {
        const timestampRegex = /(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/;
        const match = line.match(timestampRegex);
        if (match) {
            const timestampStr = match[0];
            const currentYear = new Date().getFullYear();
            return new Date(`${timestampStr} ${currentYear}`);
        }
        return null;
    }
}
exports.default = LogParser;
