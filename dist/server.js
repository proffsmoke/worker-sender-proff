"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const config_1 = __importDefault(require("./config"));
const logger_1 = __importDefault(require("./utils/logger"));
const startServer = async () => {
    const host = process.env.HOST || '0.0.0.0'; // Adiciona suporte para configuração via variável de ambiente
    app_1.default.listen(config_1.default.port, host, () => {
        logger_1.default.info(`Servidor rodando no endereço ${host}:${config_1.default.port}`);
    });
};
startServer();
