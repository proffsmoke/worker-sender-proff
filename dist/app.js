"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const routes_1 = __importDefault(require("./routes"));
const logger_1 = __importDefault(require("./utils/logger"));
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = __importDefault(require("./config"));
const MailerService_1 = __importDefault(require("./services/MailerService"));
const ResultSenderServic_1 = __importDefault(require("./services/ResultSenderServic"));
const RpaService_1 = __importDefault(require("./services/RpaService"));
const app = (0, express_1.default)();
/**
 * Tentativa de conexão ao MongoDB com até 50 retries.
 * Cada falha aguarda 2s antes de nova tentativa.
 */
let attempts = 0;
async function connectWithRetry() {
    try {
        await mongoose_1.default.connect(config_1.default.mongodbUri);
        logger_1.default.info('Conectado ao MongoDB');
    }
    catch (err) {
        attempts++;
        logger_1.default.error(`Falha ao conectar ao MongoDB (tentativa ${attempts}/50):`, err);
        if (attempts < 50) {
            setTimeout(connectWithRetry, 2000);
        }
        else {
            logger_1.default.error('Não foi possível conectar ao MongoDB após 50 tentativas. Encerrando.');
            process.exit(1);
        }
    }
}
connectWithRetry();
/**
 * Garante que o MailerService seja instanciado imediatamente
 * e força o log a iniciar (caso ainda não tenha iniciado)
 */
const mailer = MailerService_1.default.getInstance();
// Chama a função que dispara o startMonitoring() se não estiver rodando.
mailer.forceLogInitialization();
// Inicia service result
const resultSenderService = new ResultSenderServic_1.default();
resultSenderService.start();
// ***** Inicia o serviço RPA (troca de hostname a cada 1 min) *****
const rpaService = RpaService_1.default.getInstance();
rpaService.start();
// ***************************************************************
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use('/api', routes_1.default);
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Rota não encontrada.' });
});
app.use((err, req, res, _next) => {
    logger_1.default.error(`Erro: ${err.message}`);
    res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
});
exports.default = app;
