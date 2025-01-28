"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tail_1 = require("tail");
const logger_1 = __importDefault(require("./utils/logger"));
const fs_1 = __importDefault(require("fs"));
const events_1 = __importDefault(require("events"));
const EmailLog_1 = __importDefault(require("./models/EmailLog")); // Modelo para salvar logs
const EmailQueueModel_1 = __importDefault(require("./models/EmailQueueModel")); // Modelo para buscar email associado ao queueId e mailId
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
            logger_1.default.warn('Log monitoring already started.');
            return;
        }
        if (!this.tail) {
            logger_1.default.error('Tail not initialized.');
            return;
        }
        this.tail.on('line', this.handleLogLine.bind(this));
        this.tail.on('error', (error) => {
            logger_1.default.error('Error monitoring logs:', error);
        });
        this.isMonitoringStarted = true;
        logger_1.default.info(`Monitoring started for log file: ${this.logFilePath}`);
    }
    parseLogLine(line) {
        // Extrai informações básicas do log (queueId, email, result)
        const queueMatch = line.match(/postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<(.*)>, .*, status=(\w+)/);
        // **Modificado para extrair mailId após o log de 'removed'**
        const mailIdMatch = line.match(/postfix\/qmgr\[.*\]: ([A-Z0-9]+): removed/);
        if (!queueMatch)
            return null;
        const [, queueId, email, result] = queueMatch;
        // **mailId agora é extraído de outra linha que contém 'removed'**
        const mailId = mailIdMatch ? mailIdMatch[1] : undefined;
        return {
            timestamp: new Date().toISOString(),
            queueId,
            email: email.trim(),
            result,
            success: result === 'sent',
            mailId, // Adiciona o mailId ao objeto LogEntry
        };
    }
    async handleLogLine(line) {
        try {
            logger_1.default.info(`Processing log line: ${line}`);
            const logEntry = this.parseLogLine(line);
            if (!logEntry)
                return;
            const logHash = `${logEntry.timestamp}-${logEntry.queueId}-${logEntry.result}`;
            if (this.logHashes.has(logHash)) {
                logger_1.default.info(`Duplicate log ignored: ${logHash}`);
                return;
            }
            this.recentLogs.push(logEntry);
            this.logHashes.add(logHash);
            if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
                const oldestLog = this.recentLogs.shift();
                if (oldestLog) {
                    this.logHashes.delete(`${oldestLog.timestamp}-${oldestLog.queueId}-${oldestLog.result}`);
                }
            }
            logger_1.default.info(`Parsed log entry: ${JSON.stringify(logEntry)}`);
            await this.processLogEntry(logEntry);
        }
        catch (error) {
            logger_1.default.error(`Error processing log line: ${line}`, error);
        }
    }
    async processLogEntry(logEntry) {
        try {
            const { queueId, success, mailId } = logEntry;
            // **Modificado para buscar pelo mailId no EmailQueueModel e no EmailLog**
            const emailQueue = await EmailQueueModel_1.default.findOne({ 'queueIds.queueId': queueId });
            const emailLog = await EmailLog_1.default.findOne({ mailId });
            // **Emitir 'testEmailLog' se mailId estiver presente (indicando um possível email de teste)**
            if (mailId) {
                this.emit('testEmailLog', { mailId, success });
            }
            if (!emailQueue && !emailLog) {
                logger_1.default.warn(`EmailQueue and EmailLog not found for queueId=${queueId} and mailId=${mailId}`);
                return;
            }
            // **Obter o email correto do EmailLog, se disponível, senão do EmailQueueModel**
            const email = emailLog ? emailLog.email : (emailQueue ? emailQueue.queueIds.find((q) => q.queueId === queueId)?.email : undefined);
            if (!email) {
                logger_1.default.error(`Email not found for queueId=${queueId} and mailId=${mailId}. Skipping log save.`);
                return;
            }
            // **Usar mailId do logEntry, se disponível**
            const logMailId = mailId || emailQueue?.uuid;
            // Atualizar log no EmailLog
            await this.saveOrUpdateEmailLog(queueId, email, logMailId, success, logEntry.timestamp);
        }
        catch (error) {
            logger_1.default.error(`Error processing log entry: ${JSON.stringify(logEntry)}`, error);
        }
    }
    async saveOrUpdateEmailLog(queueId, email, mailId, // Agora aceita undefined
    success, timestamp) {
        try {
            // **Verificação se mailId é undefined**
            if (!mailId) {
                logger_1.default.warn(`mailId is undefined for queueId=${queueId}. Log will be saved without mailId.`);
            }
            const existingLog = await EmailLog_1.default.findOne({ mailId });
            if (existingLog) {
                // Atualizar log existente
                existingLog.success = success;
                existingLog.email = email; // Atualiza o email para o correto
                existingLog.queueId = queueId;
                await existingLog.save();
                logger_1.default.info(`Log updated in EmailLog: queueId=${queueId}, mailId=${mailId}`);
            }
            else {
                // Criar novo log
                // **Verificação se mailId é undefined ao criar novo log**
                const emailLog = new EmailLog_1.default({
                    mailId: mailId || null, // Se mailId for undefined, salva como null
                    queueId,
                    email,
                    success,
                    sentAt: new Date(timestamp),
                });
                await emailLog.save();
                logger_1.default.info(`Log saved in EmailLog: queueId=${queueId}, mailId=${mailId}`);
            }
        }
        catch (error) {
            logger_1.default.error(`Error saving/updating log in EmailLog for queueId=${queueId}, mailId=${mailId}:`, error);
        }
    }
    getRecentLogs() {
        return this.recentLogs;
    }
}
exports.default = LogParser;
