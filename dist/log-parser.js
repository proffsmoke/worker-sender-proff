"use strict";
// src/log-parser.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tail_1 = require("tail");
const EmailLog_1 = __importDefault(require("./models/EmailLog"));
const logger_1 = __importDefault(require("./utils/logger"));
const fs_1 = __importDefault(require("fs"));
class LogParser {
    constructor(logFilePath = '/var/log/mail.log') {
        this.logFilePath = logFilePath;
        if (!fs_1.default.existsSync(this.logFilePath)) {
            throw new Error(`Arquivo de log não encontrado: ${this.logFilePath}`);
        }
        this.tail = new tail_1.Tail(this.logFilePath, { useWatchFile: true });
    }
    startMonitoring() {
        this.tail.on('line', this.handleLogLine.bind(this));
        this.tail.on('error', (error) => {
            logger_1.default.error('Erro ao monitorar os logs:', error);
        });
        logger_1.default.info(`Monitorando o arquivo de log: ${this.logFilePath}`);
    }
    async handleLogLine(line) {
        // Regex atualizada para capturar Queue ID e status
        const regex = /(?:sendmail|sm-mta)\[\d+\]: ([A-Za-z0-9]+): .*stat=(\w+)/;
        const match = line.match(regex);
        if (match) {
            const [_, queueId, status] = match;
            try {
                const emailLog = await EmailLog_1.default.findOne({ 'detail.queueId': queueId });
                if (emailLog) {
                    emailLog.success = status === 'Sent';
                    emailLog.message = `Status atualizado: ${status}`;
                    await emailLog.save();
                    logger_1.default.info(`Log atualizado: Queue ID ${queueId}, Status: ${status}`);
                }
                else {
                    logger_1.default.warn(`Nenhum log encontrado para Queue ID ${queueId}`);
                }
            }
            catch (error) {
                logger_1.default.error(`Erro ao atualizar o log para Queue ID ${queueId}:`, error);
            }
        }
    }
}
exports.default = LogParser;
