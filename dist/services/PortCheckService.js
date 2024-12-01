"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = __importDefault(require("net"));
const logger_1 = __importDefault(require("../utils/logger"));
class PortCheckService {
    async checkPort(ip, port) {
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
            }).connect(port, ip);
        });
    }
    async verifyPort(ip = '0.0.0.0', ports) {
        for (const port of ports) {
            if (await this.checkPort(ip, port)) {
                logger_1.default.info(`Verificação de porta ${port} para IP ${ip}: ABERTA`);
                return port;
            }
        }
        logger_1.default.warn(`Nenhuma porta disponível para IP ${ip}`);
        return null;
    }
}
exports.default = new PortCheckService();
