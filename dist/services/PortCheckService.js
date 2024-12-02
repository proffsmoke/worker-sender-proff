"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = __importDefault(require("net"));
const logger_1 = __importDefault(require("../utils/logger"));
class PortCheckService {
    /**
     * Testa uma conexão com um host e porta específicos.
     * @param host Host para testar (ex.: smtp.gmail.com)
     * @param port Porta para testar (ex.: 25)
     * @returns True se a conexão for bem-sucedida, False caso contrário.
     */
    async checkPort(host, port) {
        return new Promise((resolve) => {
            const socket = new net_1.default.Socket();
            socket.setTimeout(5000); // Define o timeout de 5 segundos
            socket
                .on('connect', () => {
                socket.destroy();
                resolve(true); // Conexão bem-sucedida
            })
                .on('timeout', () => {
                socket.destroy();
                resolve(false); // Timeout
            })
                .on('error', () => {
                resolve(false); // Qualquer outro erro
            })
                .connect(port, host); // Conecta ao host e porta fornecidos
        });
    }
    /**
     * Verifica múltiplas portas em um host.
     * @param host Host para testar (ex.: smtp.gmail.com)
     * @param ports Lista de portas para verificar (ex.: [25, 587, 465])
     * @returns A primeira porta aberta encontrada ou null se nenhuma estiver aberta.
     */
    async verifyPort(host, ports) {
        for (const port of ports) {
            if (await this.checkPort(host, port)) {
                logger_1.default.info(`Verificação de porta ${port} para host ${host}: ABERTA`);
                return port; // Retorna a primeira porta aberta
            }
        }
        logger_1.default.warn(`Nenhuma porta disponível para host ${host}`);
        return null; // Nenhuma porta encontrada
    }
}
exports.default = new PortCheckService();
