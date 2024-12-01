"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/services/MailerService.ts
const PortCheckService_1 = __importDefault(require("./PortCheckService"));
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
class MailerService {
    constructor() {
        this.isBlocked = false;
        this.isBlockedPermanently = false;
        this.version = '4.3.26-1'; // Atualize conforme necessário
        this.intervalId = null;
        this.createdAt = new Date();
        this.initialize();
    }
    async initialize() {
        await this.checkPortAndUpdateStatus();
        if (!this.isBlockedPermanently) {
            this.intervalId = setInterval(() => this.checkPortAndUpdateStatus(), config_1.default.mailer.checkInterval);
        }
    }
    async checkPortAndUpdateStatus() {
        if (this.isBlockedPermanently) {
            logger_1.default.info('Mailer está permanentemente bloqueado. Não será verificada novamente a porta 25.');
            return;
        }
        const portStatus = await PortCheckService_1.default.verifyPort25('127.0.0.1');
        if (!portStatus && !this.isBlocked) {
            this.blockMailer('blocked_permanently'); // Bloqueio permanente
        }
        // Não recheck se já está bloqueado
    }
    isMailerBlocked() {
        return this.isBlocked;
    }
    isMailerPermanentlyBlocked() {
        return this.isBlockedPermanently;
    }
    getCreatedAt() {
        return this.createdAt;
    }
    getStatus() {
        if (this.isBlockedPermanently) {
            return 'blocked_permanently';
        }
        if (this.isBlocked) {
            return 'blocked_temporary';
        }
        return 'health';
    }
    isPort25Open() {
        return !this.isBlocked;
    }
    getVersion() {
        return this.version;
    }
    blockMailer(status) {
        if (!this.isBlocked) {
            this.isBlocked = true;
            if (status === 'blocked_permanently') {
                this.isBlockedPermanently = true;
            }
            logger_1.default.warn(`Mailer bloqueado com status: ${status}`);
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
        }
    }
    unblockMailer() {
        if (this.isBlocked && !this.isBlockedPermanently) {
            this.isBlocked = false;
            logger_1.default.info('Mailer desbloqueado.');
            this.initialize(); // Recomeça as verificações periódicas
        }
    }
}
exports.default = new MailerService();
