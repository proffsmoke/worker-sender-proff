"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultSenderService = void 0;
const axios_1 = __importDefault(require("axios"));
const zod_1 = require("zod");
const EmailQueueModel_1 = __importDefault(require("../models/EmailQueueModel"));
const logger_1 = __importDefault(require("../utils/logger"));
const logPrefix = '[resultservice]';
const DOMAINS = ['https://sender.construcoesltda.com'];
const PayloadSchema = zod_1.z.object({
    uuid: zod_1.z.string().uuid(),
    results: zod_1.z.array(zod_1.z.object({
        queueId: zod_1.z.string().min(1, "ID da fila inválido"),
        email: zod_1.z.string().email("Formato de e-mail inválido"),
        success: zod_1.z.boolean(),
        data: zod_1.z.unknown().optional(),
    })).nonempty("A lista de resultados não pode estar vazia"),
});
class DomainStrategy {
    constructor(domains) {
        this.domains = domains;
        this.currentIndex = 0;
    }
    getNextDomain() {
        const domain = this.domains[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.domains.length;
        logger_1.default.debug(`${logPrefix} Domínio selecionado: ${domain}`);
        return domain;
    }
}
class ResultSenderService {
    constructor() {
        this.interval = null;
        this.isSending = false;
        this.domainStrategy = new DomainStrategy(DOMAINS);
        this.axiosInstance = axios_1.default.create({
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' },
        });
        this.start();
    }
    start() {
        if (this.interval) {
            logger_1.default.warn(`${logPrefix} Serviço já está em execução`);
            return;
        }
        this.interval = setInterval(() => this.processResults(), 10000);
        logger_1.default.info(`${logPrefix} Serviço iniciado com intervalo de 10s`);
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            logger_1.default.info(`${logPrefix} Serviço parado`);
        }
    }
    // Substitua o método processResults por:
    async processResults() {
        if (this.isSending) {
            logger_1.default.debug(`${logPrefix} Processamento já em andamento`);
            return;
        }
        this.isSending = true;
        logger_1.default.info(`${logPrefix} Iniciando ciclo de processamento`);
        try {
            const emailQueues = await EmailQueueModel_1.default.find({
                'queueIds.success': { $exists: true, $ne: null },
                resultSent: false,
                $expr: {
                    $gt: [
                        { $size: {
                                $filter: {
                                    input: "$queueIds",
                                    cond: { $ne: ["$$this.success", null] }
                                }
                            } },
                        0
                    ]
                }
            }).lean();
            logger_1.default.info(`${logPrefix} Filas encontradas: ${emailQueues.length}`);
            const resultsByUuid = this.groupResultsByUuid(emailQueues);
            await this.processUuidResults(resultsByUuid);
        }
        catch (error) {
            const errorDetails = this.getErrorDetails(error);
            logger_1.default.error(`${logPrefix} Erro no processamento geral`, {
                message: errorDetails.message,
                stack: errorDetails.stack
            });
        }
        finally {
            this.isSending = false;
            logger_1.default.info(`${logPrefix} Ciclo de processamento finalizado`);
        }
    }
    groupResultsByUuid(emailQueues) {
        const results = {};
        for (const queue of emailQueues) {
            const validResults = queue.queueIds
                .filter((q) => q.success !== null)
                .map((q) => ({
                queueId: q.queueId,
                email: q.email,
                success: q.success,
                data: q.data
            }));
            if (validResults.length > 0) {
                results[queue.uuid] = validResults;
                logger_1.default.debug(`${logPrefix} UUID ${queue.uuid} tem ${validResults.length} resultados válidos`);
            }
            else {
                logger_1.default.warn(`${logPrefix} UUID ${queue.uuid} ignorado - sem resultados válidos`);
            }
        }
        return results;
    }
    async processUuidResults(resultsByUuid) {
        for (const [uuid, results] of Object.entries(resultsByUuid)) {
            try {
                logger_1.default.info(`${logPrefix} Processando UUID ${uuid} com ${results.length} resultados`);
                await this.validateAndSendResults(uuid, results);
            }
            catch (error) {
                const errorDetails = this.getAxiosErrorDetails(error);
                logger_1.default.error(`${logPrefix} Falha no UUID ${uuid}`, {
                    error: errorDetails.message,
                    code: errorDetails.code,
                    attempts: errorDetails.response?.retryCount || 1
                });
            }
        }
    }
    async validateAndSendResults(uuid, results) {
        const validation = PayloadSchema.safeParse({ uuid, results });
        if (!validation.success) {
            const errors = validation.error.errors
                .map(err => `${err.path.join('.')}: ${err.message}`)
                .join(', ');
            logger_1.default.error(`${logPrefix} Validação falhou para ${uuid}`, {
                errors,
                resultCount: results.length,
                sampleEmail: results[0]?.email
            });
            throw new Error(`Erro de validação: ${errors}`);
        }
        const domain = this.domainStrategy.getNextDomain();
        await this.sendResults(domain, uuid, validation.data);
        await this.markAsSent(uuid, results.length);
    }
    async sendResults(domain, uuid, payload) {
        const url = `${domain}/api/results`;
        logger_1.default.info(`${logPrefix} Enviando ${payload.results.length} resultados para ${url}`, {
            uuid,
            domain,
            firstQueueId: payload.results[0]?.queueId
        });
        const response = await this.axiosInstance.post(url, payload);
        logger_1.default.info(`${logPrefix} Resposta recebida de ${domain}`, {
            status: response.status,
            uuid,
            responseSummary: response.data?.success ? 'Sucesso' : 'Erro'
        });
    }
    async markAsSent(uuid, resultCount) {
        const updateResult = await EmailQueueModel_1.default.updateOne({ uuid }, {
            $set: {
                resultSent: true,
                lastUpdated: new Date(),
                'queueIds.$[].success': null
            }
        });
        logger_1.default.info(`${logPrefix} UUID ${uuid} atualizado`, {
            resultCount,
            matched: updateResult.matchedCount,
            modified: updateResult.modifiedCount
        });
    }
    getErrorDetails(error) {
        if (error instanceof Error) {
            return { message: error.message, stack: error.stack };
        }
        return { message: 'Erro desconhecido', stack: String(error) };
    }
    getAxiosErrorDetails(error) {
        if (axios_1.default.isAxiosError(error)) {
            return {
                message: error.message,
                code: error.code,
                config: error.config,
                response: error.response?.data,
            };
        }
        return this.getErrorDetails(error);
    }
}
exports.ResultSenderService = ResultSenderService;
exports.default = ResultSenderService;
