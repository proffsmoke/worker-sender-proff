"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/services/PortCheckService.ts
const net_1 = __importDefault(require("net"));
const logger_1 = __importDefault(require("../utils/logger"));
class PortCheckService {
    async checkPort25(ip) {
        return new Promise((resolve) => {
            const socket = new net_1.default.Socket();
            socket.setTimeout(5000);
            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            }).on('timeout', () => {
                socket.destroy();
                resolve(false);
            }).on('error', () => {
                resolve(false);
            }).connect(25, ip);
        });
    }
    async verifyPort25(ip) {
        const isOpen = await this.checkPort25(ip);
        logger_1.default.info(`Verificação de porta 25 para IP ${ip}: ${isOpen ? 'ABERTA' : 'FECHADA'}`);
        return isOpen;
    }
}
exports.default = new PortCheckService();
