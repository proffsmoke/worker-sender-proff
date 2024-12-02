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
        if (!fs_1.default.existsSync(this.logFilePath)) {
            logger_1.default.error(`Arquivo de log não encontrado no caminho: ${this.logFilePath}`);
            throw new Error(`Arquivo de log não encontrado: ${this.logFilePath}`);
        }
        this.tail = new tail_1.Tail(this.logFilePath, { useWatchFile: true });
    }
    startMonitoring() {
        if (!this.tail) {
            logger_1.default.error('Tentativa de monitorar logs sem inicializar o Tail.');
            return;
        }
        this.tail.on('line', this.handleLogLine.bind(this));
        this.tail.on('error', (error) => {
            logger_1.default.error('Erro ao monitorar os logs:', error);
        });
        logger_1.default.info(`Monitorando o arquivo de log: ${this.logFilePath}`);
    }
    stopMonitoring() {
        if (this.tail) {
            this.tail.unwatch();
            logger_1.default.info('Monitoramento de logs interrompido.');
        }
        else {
            logger_1.default.warn('Nenhum monitoramento ativo para interromper.');
        }
    }
    handleLogLine(line) {
        // Regex atualizado para capturar Queue ID, recipient, status e Message-ID
        const regex = /postfix\/smtp\[\d+\]:\s+([A-Z0-9]+):\s+to=<([^>]+)>,.*status=(\w+).*<([^>]+)>/i;
        const match = line.match(regex);
        if (match) {
            const [_, queueId, recipient, status, messageId] = match;
            const logEntry = {
                queueId,
                recipient,
                status,
                messageId,
            };
            logger_1.default.info(`LogParser capturou: Queue ID=${queueId}, Recipient=${recipient}, Status=${status}, Message-ID=${messageId}`);
            // Emitir um evento com os detalhes do logEntry
            this.emit('log', logEntry);
        }
    }
}
exports.default = LogParser;
