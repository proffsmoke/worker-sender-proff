"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultSenderService = void 0;
const EmailQueueModel_1 = __importDefault(require("../models/EmailQueueModel"));
const logger_1 = __importDefault(require("../utils/logger"));
const axios_1 = __importDefault(require("axios"));
const json_stringify_safe_1 = __importDefault(require("json-stringify-safe")); // Biblioteca para serialização segura
// Função utilitária para evitar referências circulares
const replacerFunc = () => {
    const visited = new WeakSet();
    return (key, value) => {
        if (typeof value === "object" && value !== null) {
            if (visited.has(value)) {
                logger_1.default.warn(`Referência circular detectada na chave: ${key}`);
                return '[Circular Reference]';
            }
            visited.add(value);
        }
        return value;
    };
};
// Serviço para enviar resultados
class ResultSenderService {
    constructor() {
        this.interval = null;
        this.isSending = false;
        this.start();
    }
    // Inicia o serviço
    start() {
        if (this.interval) {
            logger_1.default.warn('O serviço ResultSenderService já está em execução.');
            return;
        }
        this.interval = setInterval(() => this.processResults(), 10000);
        logger_1.default.info('ResultSenderService iniciado.');
    }
    // Para o serviço
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            logger_1.default.info('ResultSenderService parado.');
        }
    }
    // Processa os resultados
    async processResults() {
        if (this.isSending) {
            logger_1.default.info('ResultSenderService já está processando resultados. Aguardando...');
            return;
        }
        this.isSending = true;
        try {
            logger_1.default.info('Iniciando busca de registros no banco de dados...');
            const emailQueues = await EmailQueueModel_1.default.find({
                'queueIds.success': { $exists: true, $ne: null },
                resultSent: false,
            });
            logger_1.default.info(`Encontrados ${emailQueues.length} registros para processar.`);
            // Agrupa os resultados por uuid
            const resultsByUuid = {};
            for (const emailQueue of emailQueues) {
                const { uuid, queueIds } = emailQueue;
                logger_1.default.info(`Processando emailQueue com uuid: ${uuid}`);
                // Filtra os resultados válidos
                const filteredQueueIds = queueIds.filter((q) => q.success != null);
                const results = filteredQueueIds.map((q) => ({
                    queueId: q.queueId,
                    email: q.email,
                    success: q.success,
                }));
                logger_1.default.info(`Filtrados ${results.length} resultados válidos para uuid: ${uuid}`);
                // Agrupa os resultados por uuid
                if (!resultsByUuid[uuid]) {
                    resultsByUuid[uuid] = [];
                }
                resultsByUuid[uuid].push(...results);
            }
            // Exibe os resultados agrupados
            logger_1.default.info('Resultados agrupados por uuid:', (0, json_stringify_safe_1.default)(resultsByUuid, replacerFunc(), 2));
            // Envia os resultados agrupados por uuid
            for (const [uuid, results] of Object.entries(resultsByUuid)) {
                logger_1.default.info(`Preparando para enviar resultados: uuid=${uuid}, total de resultados=${results.length}`);
                logger_1.default.info('Resultados a serem enviados:', (0, json_stringify_safe_1.default)(results, replacerFunc(), 2));
                if (results.length === 0) {
                    logger_1.default.warn(`Nenhum resultado válido encontrado para enviar: uuid=${uuid}`);
                    continue;
                }
                await this.sendResults(uuid, results);
            }
        }
        catch (error) {
            logger_1.default.error('Erro ao processar resultados:', (0, json_stringify_safe_1.default)(error, replacerFunc(), 2));
        }
        finally {
            this.isSending = false;
            logger_1.default.info('Processamento de resultados concluído.');
        }
    }
    // Envia os resultados para o servidor
    async sendResults(uuid, results) {
        try {
            // Constrói o payload seguro (sem referências circulares)
            const payload = {
                uuid,
                results: results.map(r => ({
                    queueId: r.queueId,
                    email: r.email,
                    success: r.success,
                })),
            };
            // Limpa o payload de referências circulares
            const cleanedPayload = JSON.parse((0, json_stringify_safe_1.default)(payload, replacerFunc(), 2));
            // Exibe o payload construído
            logger_1.default.info('Payload construído:', (0, json_stringify_safe_1.default)(cleanedPayload, replacerFunc(), 2));
            // Envia os resultados para o servidor
            logger_1.default.info('Enviando payload para o servidor...');
            const response = await axios_1.default.post('http://localhost:4008/api/results', cleanedPayload, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            // Verifica se a resposta existe e se contém dados
            if (response && response.data) {
                logger_1.default.info('Resposta do servidor:', (0, json_stringify_safe_1.default)(response.data, replacerFunc(), 2));
                if (response.status === 200) {
                    logger_1.default.info(`Resultados enviados com sucesso: uuid=${uuid}`);
                    // Marca o registro como enviado no banco de dados
                    await EmailQueueModel_1.default.updateMany({ uuid }, { $set: { resultSent: true } });
                    logger_1.default.info(`Resultados marcados como enviados: uuid=${uuid}`);
                }
                else {
                    logger_1.default.error(`Falha ao enviar resultados: uuid=${uuid}, status=${response.status}`);
                }
            }
            else {
                logger_1.default.error('Resposta do servidor inválida ou sem dados.');
            }
        }
        catch (error) {
            // Exibe detalhes do erro
            logger_1.default.error('Erro ao enviar resultados:', (0, json_stringify_safe_1.default)(error, replacerFunc(), 2));
            if (error.response) {
                logger_1.default.error('Detalhes da resposta do servidor:', (0, json_stringify_safe_1.default)(error.response.data, replacerFunc(), 2));
            }
            else if (error.request) {
                logger_1.default.error('Requisição feita, mas sem resposta do servidor:', (0, json_stringify_safe_1.default)(error.request, replacerFunc(), 2));
            }
            else {
                logger_1.default.error('Erro ao configurar a requisição:', (0, json_stringify_safe_1.default)(error.message, replacerFunc(), 2));
            }
        }
    }
}
exports.ResultSenderService = ResultSenderService;
exports.default = ResultSenderService;
