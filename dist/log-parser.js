"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tail_1 = require("tail");
const logger_1 = __importDefault(require("./utils/logger"));
const fs_1 = __importDefault(require("fs"));
const events_1 = __importDefault(require("events"));
const EmailLog_1 = __importDefault(require("./models/EmailLog"));
const EmailStats_1 = __importDefault(require("./models/EmailStats"));
const EmailRetryStatus_1 = __importDefault(require("./models/EmailRetryStatus"));
class LogParser extends events_1.default {
    constructor(logFilePath = '/var/log/mail.log') {
        super();
        this.tail = null;
        this.recentLogs = [];
        this.logHashes = new Set();
        this.MAX_CACHE_SIZE = 1000;
        this.isMonitoringStarted = false;
        this.logFilePath = logFilePath;
        // Tenta inicializar o tail com até 50 tentativas
        this.initTail();
    }
    /**
     * Tenta criar o Tail no arquivo de log, repetindo até 50x se o arquivo não existir ainda.
     * Cada falha aguarda 2s antes de nova tentativa.
     */
    initTail(retryCount = 0) {
        if (!fs_1.default.existsSync(this.logFilePath)) {
            logger_1.default.error(`Log file not found at path: ${this.logFilePath}. Tentativa ${retryCount + 1}/50`);
            if (retryCount < 50) {
                setTimeout(() => this.initTail(retryCount + 1), 2000);
            }
            else {
                throw new Error(`Log file not found após 50 tentativas: ${this.logFilePath}`);
            }
            return;
        }
        // Se achou o arquivo, inicializa o tail normalmente
        this.tail = new tail_1.Tail(this.logFilePath, { useWatchFile: true });
    }
    startMonitoring() {
        if (this.isMonitoringStarted) {
            logger_1.default.warn('Log monitoring already started.');
            return;
        }
        if (!this.tail) {
            logger_1.default.error('Tail not initialized (log file ainda não encontrado).');
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
        // Extrai informações completas do log
        const queueMatch = line.match(/postfix\/smtp\[\d+\]: (\w+): .* status=\w+ \((.*)\)/);
        const emailMatch = line.match(/to=<([^>]+)>/);
        const messageIdMatch = line.match(/message-id=<([^>]+)>/);
        if (!queueMatch)
            return null;
        const [, queueId, errorDetails] = queueMatch;
        const email = emailMatch ? emailMatch[1] : 'unknown';
        const mailId = messageIdMatch ? messageIdMatch[1] : undefined;
        return {
            timestamp: new Date().toISOString(),
            queueId,
            email,
            result: errorDetails,
            success: line.includes('status=sent'),
            mailId,
        };
    }
    async handleLogLine(line) {
        try {
            logger_1.default.info(`Processing log line: ${line}`);
            const logEntry = this.parseLogLine(line);
            if (!logEntry)
                return;
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
                    this.logHashes.delete(`${oldestLog.queueId}-${oldestLog.result}`);
                }
            }
            logger_1.default.info(`Parsed log entry: ${JSON.stringify(logEntry)}`);
            await this.processLogEntry(logEntry);
            // Emite o log para o EmailService (via evento 'log')
            this.emit('log', logEntry);
        }
        catch (error) {
            logger_1.default.error(`Error processing log line: ${line}`, error);
        }
    }
    async processLogEntry(logEntry) {
        try {
            const { queueId, success, mailId, email, result } = logEntry;
            // Incrementa as estatísticas de envio
            await EmailStats_1.default.incrementSent();
            if (success) {
                await EmailStats_1.default.incrementSuccess();
            }
            else {
                await EmailStats_1.default.incrementFail();
            }
            // Prepara o objeto de atualização para EmailLog
            const updateData = {
                success,
                email,
                mailId, // Atualiza o mailId se houver
                sentAt: new Date(),
            };
            if (!success && result) {
                updateData.errorMessage = result; // Adiciona a mensagem de erro
            }
            // Atualiza ou cria o registro de log no EmailLog com base no queueId
            await EmailLog_1.default.findOneAndUpdate({ queueId }, { $set: updateData }, // Usa o objeto updateData
            { upsert: true, new: true });
            logger_1.default.info(`Log atualizado/upserted para queueId=${queueId} com success=${success}` +
                `${!success && result ? ` error: ${result}` : ''}` // Log opcional do erro
            );
            // Lógica de Retry e Falha Permanente
            if (!success && email && email !== 'unknown') {
                try {
                    const emailAddress = email.toLowerCase(); // Usar e-mail em minúsculas para consistência
                    const updatedRetryStatus = await EmailRetryStatus_1.default.findOneAndUpdate({ email: emailAddress }, {
                        $inc: { failureCount: 1 },
                        $set: { lastAttemptAt: new Date() },
                    }, { upsert: true, new: true, setDefaultsOnInsert: true });
                    logger_1.default.info(`Status de tentativa atualizado para ${emailAddress}: falhas ${updatedRetryStatus.failureCount}`);
                    if (updatedRetryStatus.failureCount >= 10 && !updatedRetryStatus.isPermanentlyFailed) {
                        await EmailRetryStatus_1.default.updateOne({ email: emailAddress }, // Condição para encontrar o documento
                        {
                            $set: {
                                isPermanentlyFailed: true,
                                lastError: result, // Salva a última mensagem de erro que causou o bloqueio
                            },
                        });
                        logger_1.default.warn(`E-mail ${emailAddress} marcado como FALHA PERMANENTE após ${updatedRetryStatus.failureCount} tentativas. Último erro: ${result}`);
                    }
                }
                catch (retryError) {
                    logger_1.default.error(`Erro ao atualizar EmailRetryStatus para ${email}:`, retryError);
                }
            }
            if (mailId) {
                this.emit('testEmailLog', { mailId, success });
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing log entry: ${JSON.stringify(logEntry)}`, error);
        }
    }
    getRecentLogs() {
        return this.recentLogs;
    }
}
exports.default = LogParser;
