"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tail_1 = require("tail");
const logger_1 = __importDefault(require("./utils/logger"));
const fs_1 = __importDefault(require("fs"));
class LogParser {
    constructor(logFilePath = '/var/log/mail.log') {
        this.tail = null; // Inicialize como nulo para evitar erros.
        this.resolveQueueId = () => { };
        this.logFilePath = logFilePath;
        if (!fs_1.default.existsSync(this.logFilePath)) {
            logger_1.default.error(`Arquivo de log não encontrado no caminho: ${this.logFilePath}`);
            throw new Error(`Arquivo de log não encontrado: ${this.logFilePath}`);
        }
        this.tail = new tail_1.Tail(this.logFilePath, { useWatchFile: true });
        this.queueIdPromise = new Promise((resolve) => {
            this.resolveQueueId = resolve;
        });
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
    async waitForQueueId(uuid) {
        const timeout = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Timeout ao capturar Queue ID para UUID: ${uuid}`));
            }, 10000); // 10 segundos
        });
        return Promise.race([this.queueIdPromise, timeout]).finally(() => this.stopMonitoring());
    }
    handleLogLine(line) {
        const regex = /(?:sendmail|sm-mta)\[\d+\]: ([A-Za-z0-9]+): .*uuid=([A-Za-z0-9-]+)/;
        const match = line.match(regex);
        if (match) {
            const [_, queueId, logUuid] = match;
            if (this.resolveQueueId) {
                this.resolveQueueId(queueId);
            }
        }
    }
}
exports.default = LogParser;
