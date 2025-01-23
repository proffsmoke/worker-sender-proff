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
const app = (0, express_1.default)();
// Conectar ao MongoDB
mongoose_1.default
    .connect(config_1.default.mongodbUri)
    .then(() => logger_1.default.info('Conectado ao MongoDB'))
    .catch((err) => {
    logger_1.default.error('Falha ao conectar ao MongoDB', err);
    process.exit(1);
});
// Inicializar MailerService
// logParser.startMonitoring();
MailerService_1.default;
// CleanlogsService;
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use('/api', routes_1.default);
// Middleware para erro 404
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Rota não encontrada.' });
});
// Middleware de erro
app.use((err, req, res, next) => {
    logger_1.default.error(`Erro: ${err.message}`);
    res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
});
exports.default = app;
