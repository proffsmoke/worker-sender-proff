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
        this.queueIdToMessageId = new Map();
        this.logFilePath = logFilePath;
        this.startTime = new Date();
        if (!fs_1.default.existsSync(this.logFilePath)) {
            logger_1.default.error(`Log file not found at path: ${this.logFilePath}`);
            throw new Error(`Log file not found: ${this.logFilePath}`);
        }
        this.tail = new tail_1.Tail(this.logFilePath, { useWatchFile: true });
    }
    startMonitoring() {
        if (!this.tail) {
            logger_1.default.error('Attempting to monitor logs without initializing Tail.');
            return;
        }
        this.tail.on('line', this.handleLogLine.bind(this));
        this.tail.on('error', (error) => {
            logger_1.default.error('Error monitoring logs:', error);
        });
        logger_1.default.info(`Monitoring log file: ${this.logFilePath}`);
    }
    stopMonitoring() {
        if (this.tail) {
            this.tail.unwatch();
            logger_1.default.info('Log monitoring stopped.');
        }
        else {
            logger_1.default.warn('No active monitoring to stop.');
        }
    }
    handleLogLine(line) {
        const logTimestamp = this.extractTimestamp(line);
        if (logTimestamp && logTimestamp < this.startTime) {
            return;
        }
        const smtpRegex = /postfix\/smtp\[\d+\]:\s+([A-Z0-9]+):\s+to=<([^>]+)>,.*dsn=(\d+\.\d+\.\d+),.*status=([a-z]+)/i;
        const cleanupRegex = /postfix\/cleanup\[\d+\]:\s+([A-Z0-9]+):\s+message-id=<([^>]+)>/i;
        const bounceRegex = /postfix\/bounce\[\d+\]:\s+([A-Z0-9]+):\s+sender non-delivery notification:/i;
        const qmgrRegex = /postfix\/qmgr\[\d+\]:\s+([A-Z0-9]+):\s+removed/i;
        let match = line.match(cleanupRegex);
        if (match) {
            const [_, queueId, messageId] = match;
            this.queueIdToMessageId.set(queueId, messageId);
            logger_1.default.debug(`Mapped Queue ID=${queueId} to Message-ID=${messageId}`);
            return;
        }
        match = line.match(smtpRegex);
        if (match) {
            const [_, queueId, recipient, dsn, status] = match;
            const messageId = this.queueIdToMessageId.get(queueId) || '';
            const logEntry = {
                queueId,
                recipient,
                status,
                messageId,
                dsn,
                message: line,
            };
            logger_1.default.debug(`LogParser captured: ${JSON.stringify(logEntry)}`);
            this.emit('log', logEntry);
        }
        match = line.match(bounceRegex);
        if (match) {
            const [_, queueId] = match;
            const messageId = this.queueIdToMessageId.get(queueId) || '';
            const logEntry = {
                queueId,
                recipient: '',
                status: 'bounced',
                messageId,
                dsn: '5.0.0',
                message: line,
            };
            logger_1.default.debug(`LogParser captured bounce: ${JSON.stringify(logEntry)}`);
            this.emit('log', logEntry);
        }
        match = line.match(qmgrRegex);
        if (match) {
            const [_, queueId] = match;
            const messageId = this.queueIdToMessageId.get(queueId) || '';
            const logEntry = {
                queueId,
                recipient: '',
                status: 'removed',
                messageId,
                dsn: '2.0.0',
                message: line,
            };
            logger_1.default.debug(`LogParser captured qmgr removal: ${JSON.stringify(logEntry)}`);
            this.emit('log', logEntry);
        }
    }
    extractTimestamp(line) {
        const timestampRegex = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/;
        const match = line.match(timestampRegex);
        if (match) {
            return new Date(match[1]);
        }
        return null;
    }
}
exports.default = LogParser;
