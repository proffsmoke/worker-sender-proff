"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// log-parser.ts
const tail_1 = require("tail");
const logger_1 = __importDefault(require("./utils/logger"));
const fs_1 = __importDefault(require("fs"));
const events_1 = __importDefault(require("events"));
const EmailLog_1 = __importDefault(require("./models/EmailLog"));
const EmailQueueModel_1 = __importDefault(require("./models/EmailQueueModel"));
const EmailStats_1 = __importDefault(require("./models/EmailStats"));
class LogParser extends events_1.default {
    constructor(logFilePath = '/var/log/mail.log') {
        super();
        this.tail = null;
        this.recentLogs = [];
        this.logHashes = new Set(); // Usar Set para evitar duplicatas
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
        // Extrai informações básicas do log (queueId, email, result, message-id)
        const queueMatch = line.match(/postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<(.*)>, .*, status=(\w+)/);
        const messageIdMatch = line.match(/postfix\/cleanup\[[0-9]+\]: [A-Z0-9]+: message-id=<(.*)>/);
        if (!queueMatch)
            return null;
        const [, queueId, email, result] = queueMatch;
        const mailId = messageIdMatch ? messageIdMatch[1] : undefined;
        return {
            timestamp: new Date().toISOString(),
            queueId,
            email: email.trim(),
            result,
            success: result === 'sent',
            mailId,
        };
    }
    async handleLogLine(line) {
        try {
            logger_1.default.info(`Processing log line: ${line}`);
            const logEntry = this.parseLogLine(line);
            if (!logEntry)
                return;
            // Usar apenas queueId e result para verificar duplicidade
            const logHash = `${logEntry.queueId}-${logEntry.result}`;
            if (this.logHashes.has(logHash)) {
                logger_1.default.info(`Duplicate log ignored: ${logHash}`);
                return;
            }
            this.recentLogs.push(logEntry);
            this.logHashes.add(logHash);
            if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
                const oldestLog = this.recentLogs.shift();
                if (oldestLog) {
                    // Remover hash do log mais antigo
                    this.logHashes.delete(`${oldestLog.queueId}-${oldestLog.result}`);
                }
            }
            logger_1.default.info(`Parsed log entry: ${JSON.stringify(logEntry)}`);
            await this.processLogEntry(logEntry);
        }
        catch (error) {
            logger_1.default.error(`Error processing log line: ${line}`, error);
        }
    }
    // log-parser.ts
    async processLogEntry(logEntry) {
        try {
            const { queueId, success, mailId, email } = logEntry;
            // Atualizar estatísticas no EmailStats
            await EmailStats_1.default.incrementSent();
            if (success) {
                await EmailStats_1.default.incrementSuccess();
            }
            else {
                await EmailStats_1.default.incrementFail();
            }
            // Buscar informações no EmailLog primeiro, depois no EmailQueueModel
            let emailLog = await EmailLog_1.default.findOne({ queueId });
            if (!emailLog) {
                // Buscar no EmailQueueModel se não encontrar no EmailLog
                const emailQueue = await EmailQueueModel_1.default.findOne({ 'queueIds.queueId': queueId });
                if (emailQueue) {
                    const associatedQueue = emailQueue.queueIds.find(q => q.queueId === queueId);
                    if (associatedQueue) {
                        emailLog = new EmailLog_1.default({
                            queueId: queueId,
                            email: associatedQueue.email,
                            mailId: emailQueue.uuid,
                            success: success,
                            sentAt: new Date()
                        });
                        await emailLog.save();
                    }
                }
            }
            // Nova parte adicionada: Atualizar EmailQueueModel
            if (emailLog) {
                // Atualizar o registro na fila principal
                await EmailQueueModel_1.default.updateOne({ "queueIds.queueId": queueId }, { $set: { "queueIds.$.success": success } });
                logger_1.default.info(`Queue atualizada: ${queueId} => ${success}`);
            }
            // Emitir 'testEmailLog' se mailId estiver presente
            if (mailId) {
                this.emit('testEmailLog', { mailId, success });
            }
            // Atualizar log no EmailLog
            if (emailLog) {
                emailLog.success = success;
                if (mailId)
                    emailLog.mailId = mailId;
                await emailLog.save();
                logger_1.default.info(`Log atualizado: ${queueId}, ${mailId}, ${success}`);
            }
            else {
                logger_1.default.warn(`Log não encontrado: ${queueId}`);
            }
            this.emit('log', logEntry);
        }
        catch (error) {
            logger_1.default.error(`Erro no processamento: ${JSON.stringify(logEntry)}`, error);
        }
    }
    getRecentLogs() {
        return this.recentLogs;
    }
}
exports.default = LogParser;
