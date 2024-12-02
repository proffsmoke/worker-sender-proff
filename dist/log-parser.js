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
        this.tail = null;
        this.resolveQueueId = () => { };
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
    async waitForQueueId(queueId) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                logger_1.default.warn(`Timeout ao capturar status para Queue ID: ${queueId}`);
                resolve('timeout');
            }, 10000);
            this.resolveQueueId = (logQueueId) => {
                if (logQueueId === queueId) {
                    clearTimeout(timeout);
                    resolve('sent');
                }
            };
        });
    }
    handleLogLine(line) {
        const regex = /(?:sendmail|sm-mta)\[\d+\]: ([A-Za-z0-9]+): .*stat=(\w+)/;
        const match = line.match(regex);
        if (match) {
            const [_, queueId, status] = match;
            if (this.resolveQueueId) {
                this.resolveQueueId(queueId);
                logger_1.default.info(`Status do Queue ID ${queueId}: ${status}`);
            }
        }
    }
}
exports.default = LogParser;
