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
            logger_1.default.error(`Log file not found at path: ${this.logFilePath}`);
            throw new Error(`Log file not found: ${this.logFilePath}`);
        }
        this.tail = new tail_1.Tail(this.logFilePath, { useWatchFile: true, follow: true, logger: console });
    }
    startMonitoring() {
        if (!this.tail) {
            logger_1.default.error('Attempted to monitor logs without initializing Tail.');
            return;
        }
        this.tail.on('line', this.handleLogLine.bind(this));
        this.tail.on('error', (error) => {
            logger_1.default.error('Error while monitoring logs:', error);
        });
        logger_1.default.info(`Monitoring log file: ${this.logFilePath}`);
    }
    stopMonitoring() {
        if (this.tail) {
            this.tail.unwatch();
            logger_1.default.info('Stopped log monitoring.');
        }
        else {
            logger_1.default.warn('No active log monitoring to stop.');
        }
    }
    handleLogLine(line) {
        // Enhanced Regex to capture various statuses
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
            logger_1.default.info(`LogParser captured: Queue ID=${queueId}, Recipient=${recipient}, Status=${status}, Message-ID=${messageId}`);
            // Emit an event with the log entry details
            this.emit('log', logEntry);
        }
    }
}
exports.default = LogParser;
