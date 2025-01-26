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
const EmailLog_1 = __importDefault(require("./models/EmailLog")); // Importar o modelo EmailLog diretamente
const StateManager_1 = __importDefault(require("./services/StateManager")); // Importar StateManager para obter o mailId
const EmailQueueModel_1 = __importDefault(require("./models/EmailQueueModel"));
class LogParser extends events_1.default {
    constructor(logFilePath = '/var/log/mail.log') {
        super();
        this.tail = null;
        this.recentLogs = [];
        this.logHashes = new Set();
        this.MAX_CACHE_SIZE = 1000;
        this.isMonitoringStarted = false;
        this.logFilePath = logFilePath;
        this.stateManager = new StateManager_1.default(); // Instanciar StateManager
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
    parseLogLine(line) {
        const match = line.match(/postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<(.*)>, .*, status=(.*)/);
        if (!match)
            return null;
        const [, queueId, email, result] = match;
        // Extrai o mailId da linha do log, se disponível
        const mailIdMatch = line.match(/message-id=<(.*)>/);
        const mailId = mailIdMatch ? mailIdMatch[1] : undefined;
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
                // Obter o mailId (uuid) associado ao queueId usando EmailQueueModel
                const mailId = await this.getMailIdByQueueId(logEntry.queueId);
                logger_1.default.info(`mailId obtido para queueId=${logEntry.queueId}: ${mailId}`);
                // Verificar se mailId não é null antes de prosseguir
                if (mailId !== null) {
                    // Atualizar o campo success
                    await EmailQueueModel_1.default.updateOne({ 'queueIds.queueId': logEntry.queueId }, { $set: { 'queueIds.$.success': logEntry.success } });
                    logger_1.default.info(`Campo success atualizado no EmailQueueModel para queueId=${logEntry.queueId}: success=${logEntry.success}`);
                    // Salvar diretamente no EmailLog com o mailId
                    await this.saveLogToEmailLog(logEntry, mailId);
                }
                else {
                    logger_1.default.warn(`mailId não encontrado para queueId=${logEntry.queueId}. Log não será salvo.`);
                }
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao processar a linha do log: ${line}`, error);
        }
    }
    async getMailIdByQueueId(queueId) {
        try {
            // Busca o documento no EmailQueueModel que contém o queueId
            const emailQueue = await EmailQueueModel_1.default.findOne({ 'queueIds.queueId': queueId });
            if (emailQueue) {
                // Retorna o uuid associado ao queueId
                return emailQueue.uuid;
            }
            logger_1.default.warn(`Nenhum mailId encontrado para queueId=${queueId}`);
            return null;
        }
        catch (error) {
            logger_1.default.error(`Erro ao buscar mailId para queueId=${queueId}:`, error);
            return null;
        }
    }
    async updateSuccessInEmailQueueModel(queueId, success) {
        try {
            // Atualiza o campo success no EmailQueueModel para o queueId correspondente
            const result = await EmailQueueModel_1.default.updateOne({ 'queueIds.queueId': queueId }, // Filtra pelo queueId
            { $set: { 'queueIds.$.success': success } } // Atualiza o campo success
            );
            if (result.modifiedCount > 0) {
                logger_1.default.info(`Campo success atualizado no EmailQueueModel para queueId=${queueId}: success=${success}`);
            }
            else {
                logger_1.default.warn(`Nenhum documento encontrado para atualizar no EmailQueueModel: queueId=${queueId}`);
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao atualizar success no EmailQueueModel para queueId=${queueId}:`, error);
        }
    }
    async saveLogToEmailLog(logEntry, mailId) {
        try {
            const { queueId, email, success } = logEntry;
            if (!mailId) {
                logger_1.default.warn(`mailId não encontrado para queueId=${queueId}. Não será possível salvar o log.`);
                return;
            }
            logger_1.default.info(`Tentando salvar log no EmailLog: queueId=${queueId}, mailId=${mailId}`);
            const existingLog = await EmailLog_1.default.findOne({ queueId });
            if (!existingLog) {
                const emailLog = new EmailLog_1.default({
                    mailId, // Passa o mailId (uuid) aqui
                    queueId,
                    email,
                    success,
                    updated: true,
                    sentAt: new Date(),
                    expireAt: new Date(Date.now() + 30 * 60 * 1000), // Expira em 30 minutos
                });
                await emailLog.save();
                logger_1.default.info(`Log salvo no EmailLog: queueId=${queueId}, email=${email}, success=${success}, mailId=${mailId}`);
                // Verificação imediata após salvar
                await this.verifyLogSaved(queueId, mailId);
            }
            else {
                logger_1.default.info(`Log já existe no EmailLog: queueId=${queueId}`);
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao salvar log no EmailLog:`, error);
        }
    }
    async verifyLogSaved(queueId, mailId) {
        try {
            logger_1.default.info(`Verificando se o log foi salvo no EmailLog: queueId=${queueId}, mailId=${mailId}`);
            // Busca o log salvo no banco de dados
            const savedLog = await EmailLog_1.default.findOne({ queueId, mailId });
            if (savedLog) {
                logger_1.default.info(`Log encontrado no EmailLog após salvamento:`, savedLog);
            }
            else {
                logger_1.default.error(`Log NÃO encontrado no EmailLog após salvamento: queueId=${queueId}, mailId=${mailId}`);
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao verificar log salvo no EmailLog:`, error);
        }
    }
    getRecentLogs() {
        return this.recentLogs;
    }
}
exports.default = LogParser;
