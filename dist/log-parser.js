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
const EmailLog_1 = __importDefault(require("./models/EmailLog"));
const EmailStats_1 = __importDefault(require("./models/EmailStats")); // Modelo para atualizar estatísticas
const StateManager_1 = __importDefault(require("./services/StateManager"));
const EmailQueueModel_1 = __importDefault(require("./models/EmailQueueModel"));
/**
 * Expressão regular simples para validar email.
 */
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
class LogParser extends events_1.default {
    constructor(logFilePath = '/var/log/mail.log') {
        super();
        this.tail = null;
        this.recentLogs = [];
        this.logHashes = new Set();
        this.MAX_CACHE_SIZE = 1000;
        this.isMonitoringStarted = false;
        this.logFilePath = logFilePath;
        this.stateManager = new StateManager_1.default();
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
    isValidEmail(email) {
        return EMAIL_REGEX.test(email);
    }
    parseLogLine(line) {
        const match = line.match(/postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<([^>]+)>, .*, status=(\w+)/);
        if (!match)
            return null;
        const [, queueId, email, result] = match;
        if (!this.isValidEmail(email)) {
            logger_1.default.warn(`Email inválido detectado: ${email}`);
            return null;
        }
        const mailIdMatch = line.match(/message-id=<(.*)>/);
        const mailId = mailIdMatch ? mailIdMatch[1] : undefined;
        logger_1.default.info(`Dados extraídos do log:`);
        logger_1.default.info(`queueId: ${queueId}`);
        logger_1.default.info(`email: ${email}`);
        logger_1.default.info(`result: ${result}`);
        logger_1.default.info(`mailId: ${mailId}`);
        return {
            timestamp: new Date().toISOString(),
            queueId,
            email: email.trim(),
            result,
            success: result.startsWith('sent'),
            mailId,
        };
    }
    async handleLogLine(line) {
        try {
            logger_1.default.info(`Processando linha do log: ${line}`);
            const logEntry = this.parseLogLine(line);
            if (logEntry) {
                const logHash = `${logEntry.timestamp}-${logEntry.queueId}-${logEntry.result}`;
                logger_1.default.info(`logEntry extraído: ${JSON.stringify(logEntry)}`);
                if (this.logHashes.has(logHash)) {
                    logger_1.default.info(`Log duplicado ignorado: ${logHash}`);
                    return;
                }
                // Adicionando o log ao cache, com verificações para remoção de logs antigos
                this.recentLogs.push(logEntry);
                this.logHashes.add(logHash);
                if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
                    const oldestLog = this.recentLogs.shift();
                    if (oldestLog) {
                        const oldestHash = `${oldestLog.timestamp}-${oldestLog.queueId}-${oldestLog.result}`;
                        this.logHashes.delete(oldestHash);
                    }
                }
                logger_1.default.info(`Log processado e adicionado ao cache: ${JSON.stringify(logEntry)}`);
                this.emit('log', logEntry);
                // Atualizar estatísticas (sucesso ou falha)
                if (logEntry.success) {
                    logger_1.default.info(`Email enviado com sucesso: ${logEntry.email}`);
                    await EmailStats_1.default.incrementSuccess();
                }
                else {
                    logger_1.default.info(`Falha no envio do email: ${logEntry.email}`);
                    await EmailStats_1.default.incrementFail();
                }
                // Salvar log no banco e atualizar o modelo EmailQueue
                if (logEntry.success) {
                    await this.processLogEntry(logEntry);
                }
                else {
                    logger_1.default.info(`Log não será salvo, email com status: ${logEntry.result}`);
                }
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao processar a linha do log: ${line}`, error);
        }
    }
    async processLogEntry(logEntry) {
        const { queueId, success } = logEntry;
        logger_1.default.info(`Iniciando o processamento do log: ${JSON.stringify(logEntry)}`);
        try {
            const mailId = await this.getMailIdByQueueId(queueId);
            logger_1.default.info(`mailId obtido para queueId=${queueId}: ${mailId}`);
            if (mailId) {
                // Atualizar campo de sucesso no EmailQueueModel
                await EmailQueueModel_1.default.updateOne({ 'queueIds.queueId': queueId }, { $set: { 'queueIds.$.success': success } });
                logger_1.default.info(`Campo success atualizado no EmailQueueModel para queueId=${queueId}: success=${success}`);
                // Salvar log no EmailLog
                await this.saveLogToEmailLog(logEntry, mailId);
            }
            else {
                logger_1.default.warn(`mailId não encontrado para queueId=${queueId}. Log não será salvo.`);
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao processar logEntry para queueId=${queueId}:`, error);
        }
    }
    async getMailIdByQueueId(queueId) {
        try {
            const emailQueue = await EmailQueueModel_1.default.findOne({ 'queueIds.queueId': queueId });
            logger_1.default.info(`EmailQueue encontrado para queueId=${queueId}: ${JSON.stringify(emailQueue)}`);
            return emailQueue ? emailQueue.uuid : null;
        }
        catch (error) {
            logger_1.default.error(`Erro ao buscar mailId para queueId=${queueId}:`, error);
            return null;
        }
    }
    async saveLogToEmailLog(logEntry, mailId) {
        const { queueId, email, success } = logEntry;
        logger_1.default.info(`Salvando log no EmailLog para queueId=${queueId}:`);
        logger_1.default.info(`email: ${email}, success: ${success}, mailId: ${mailId}`);
        try {
            const existingLog = await EmailLog_1.default.findOne({ queueId });
            if (!existingLog) {
                const emailLog = new EmailLog_1.default({
                    mailId,
                    queueId,
                    email,
                    success,
                    sentAt: new Date(),
                });
                await emailLog.save();
                logger_1.default.info(`Log salvo no EmailLog: queueId=${queueId}, email=${email}, success=${success}, mailId=${mailId}`);
            }
            else {
                logger_1.default.info(`Log já existe no EmailLog para queueId=${queueId}`);
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao salvar log no EmailLog:`, error);
        }
    }
    getRecentLogs() {
        return this.recentLogs;
    }
}
exports.default = LogParser;
