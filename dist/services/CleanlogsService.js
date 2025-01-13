"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const logger_1 = __importDefault(require("../utils/logger"));
class CleanlogsService {
    constructor() {
        this.interval = 12 * 60 * 60 * 1000; // 12 horas em milissegundos
        this.runCleanup();
        setInterval(() => this.runCleanup(), this.interval);
    }
    runCleanup() {
        logger_1.default.info('Iniciando limpeza de logs...');
        // Comando para limpar logs do journalctl
        (0, child_process_1.exec)('sudo journalctl --vacuum-size=100M', (error, stdout, stderr) => {
            if (error) {
                logger_1.default.error(`Erro ao limpar logs do journalctl: ${error.message}`);
                return;
            }
            if (stderr) {
                logger_1.default.warn(`Stderr ao limpar logs do journalctl: ${stderr}`);
                return;
            }
            logger_1.default.info(`Logs do journalctl limpos: ${stdout}`);
        });
        // Comando para truncar o arquivo syslog
        (0, child_process_1.exec)('sudo truncate -s 0 /var/log/syslog', (error, stdout, stderr) => {
            if (error) {
                logger_1.default.error(`Erro ao truncar /var/log/syslog: ${error.message}`);
                return;
            }
            if (stderr) {
                logger_1.default.warn(`Stderr ao truncar /var/log/syslog: ${stderr}`);
                return;
            }
            logger_1.default.info(`/var/log/syslog truncado com sucesso.`);
        });
        // Comando para truncar o arquivo mail.log
        (0, child_process_1.exec)('sudo truncate -s 0 /var/log/mail.log', (error, stdout, stderr) => {
            if (error) {
                logger_1.default.error(`Erro ao truncar /var/log/mail.log: ${error.message}`);
                return;
            }
            if (stderr) {
                logger_1.default.warn(`Stderr ao truncar /var/log/mail.log: ${stderr}`);
                return;
            }
            logger_1.default.info(`/var/log/mail.log truncado com sucesso.`);
        });
    }
}
exports.default = new CleanlogsService();
