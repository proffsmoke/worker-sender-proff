"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultSenderService = void 0;
// src/services/ResultSenderService.ts
const EmailQueueModel_1 = __importDefault(require("../models/EmailQueueModel"));
const logger_1 = __importDefault(require("../utils/logger"));
const axios_1 = __importDefault(require("axios")); // Importa o axios para fazer requisições HTTP
class ResultSenderService {
    constructor(useMock = false) {
        this.interval = null;
        this.isSending = false;
        this.useMock = useMock;
        this.start();
    }
    // Inicia o serviço
    start() {
        if (this.interval) {
            logger_1.default.warn('O serviço ResultSenderService já está em execução.');
            return;
        }
        this.interval = setInterval(() => this.processResults(), 10000); // Verifica a cada 10 segundos
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
    // Processa os resultados pendentes
    async processResults() {
        if (this.isSending) {
            logger_1.default.info('ResultSenderService já está processando resultados. Aguardando...');
            return;
        }
        this.isSending = true;
        try {
            // Busca registros com success preenchido e resultSent = false
            const emailQueues = await EmailQueueModel_1.default.find({
                'queueIds.success': { $ne: null }, // success não é null
                resultSent: false, // resultSent é false
            });
            logger_1.default.info(`Encontrados ${emailQueues.length} registros para processar.`);
            // Processa cada registro
            for (const emailQueue of emailQueues) {
                await this.sendResults(emailQueue);
                await new Promise((resolve) => setTimeout(resolve, 1000)); // Limita a 1 envio por segundo
            }
        }
        catch (error) {
            logger_1.default.error('Erro ao processar resultados:', error);
        }
        finally {
            this.isSending = false;
        }
    }
    // Envia os resultados (mock ou real)
    async sendResults(emailQueue) {
        const { uuid, queueIds } = emailQueue;
        // Filtra os queueIds com success preenchido
        const results = queueIds
            .filter((q) => q.success !== null)
            .map((q) => ({
            queueId: q.queueId,
            email: q.email,
            success: q.success,
        }));
        logger_1.default.info(`Preparando para enviar resultados: uuid=${uuid}`);
        // Usa o mock ou o envio real
        const sendSuccess = this.useMock
            ? await this.mockSendResults(uuid, results) // Usa o mock
            : await this.realSendResults(uuid, results); // Usa o envio real
        if (sendSuccess) {
            // Atualiza o campo resultSent para true
            await EmailQueueModel_1.default.updateOne({ uuid }, { $set: { resultSent: true } });
            logger_1.default.info(`Resultados marcados como enviados: uuid=${uuid}`);
        }
        else {
            logger_1.default.error(`Falha ao enviar resultados: uuid=${uuid}`);
        }
    }
    // Mock: Simula o envio de resultados
    async mockSendResults(uuid, results) {
        // Simula um delay de 500ms para o envio
        await new Promise((resolve) => setTimeout(resolve, 500));
        // Exibe os resultados que estão sendo enviados
        logger_1.default.info(`Mock: Enviando resultados para uuid=${uuid}`);
        results.forEach((result, index) => {
            logger_1.default.info(`Resultado ${index + 1}:`, {
                queueId: result.queueId,
                email: result.email,
                success: result.success,
            });
        });
        // Simula um envio bem-sucedido
        logger_1.default.info(`Mock: Resultados enviados com sucesso: uuid=${uuid}`);
        return true; // Retorna true para indicar sucesso
    }
    // Real: Envia os resultados para o servidor
    async realSendResults(uuid, results) {
        try {
            // Faz uma requisição POST para o servidor
            const response = await axios_1.default.post('http://localhost:4008/api/results', {
                uuid,
                results,
            });
            // Verifica se a requisição foi bem-sucedida
            if (response.status === 200) {
                logger_1.default.info(`Resultados enviados com sucesso: uuid=${uuid}`);
                return true;
            }
            else {
                logger_1.default.error(`Falha ao enviar resultados: uuid=${uuid}, status=${response.status}`);
                return false;
            }
        }
        catch (error) {
            logger_1.default.error(`Erro ao enviar resultados ao servidor: uuid=${uuid}`, error);
            return false;
        }
    }
}
exports.ResultSenderService = ResultSenderService;
exports.default = ResultSenderService;
