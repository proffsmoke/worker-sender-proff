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
const PayloadSchema = zod_1.z.object({
    uuid: zod_1.z.string().uuid(), // Validação de UUID
    results: zod_1.z.array(zod_1.z.object({
        queueId: zod_1.z.string(),
        email: zod_1.z.string().email(), // Validação de e-mail
        success: zod_1.z.boolean(),
        data: zod_1.z.unknown().optional(),
    })),
});
const DOMAINS = ['https://sender2.construcoesltda.com'];
class DomainStrategy {
    constructor(domains) {
        this.domains = domains;
        this.currentIndex = 0;
    }
    getNextDomain() {
        const domain = this.domains[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.domains.length;
        logger_1.default.debug(`Selecionado o domínio: ${domain}`);
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
            logger_1.default.warn('O serviço ResultSenderService já está em execução.');
            return;
        }
        this.interval = setInterval(() => this.processResults(), 10000);
        logger_1.default.info('ResultSenderService iniciado.');
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            logger_1.default.info('ResultSenderService parado.');
        }
    }
    async processResults() {
        if (this.isSending)
            return;
        this.isSending = true;
        try {
            const emailQueues = await EmailQueueModel_1.default.find({
                'queueIds.success': { $exists: true, $ne: null },
                resultSent: false,
            }).lean();
            const resultsByUuid = {};
            for (const emailQueue of emailQueues) {
                const { uuid, queueIds } = emailQueue;
                const validQueueIds = queueIds.filter((q) => q.success !== null);
                resultsByUuid[uuid] = [
                    ...(resultsByUuid[uuid] || []),
                    ...validQueueIds.map((q) => ({
                        queueId: q.queueId,
                        email: q.email,
                        success: q.success,
                        data: q.data,
                    })),
                ];
            }
            for (const [uuid, results] of Object.entries(resultsByUuid)) {
                if (results.length > 0) {
                    await this.validateAndSendResults(uuid, results);
                }
            }
        }
        catch (error) {
            const { message, stack } = this.getErrorDetails(error);
            logger_1.default.error(`Erro ao processar resultados: ${message}`, { stack });
        }
        finally {
            this.isSending = false;
        }
    }
    async validateAndSendResults(uuid, results) {
        try {
            const payload = { uuid, results };
            const validatedPayload = PayloadSchema.safeParse(payload);
            if (!validatedPayload.success) {
                const validationError = validatedPayload.error.format();
                logger_1.default.error('Falha na validação do payload:', validationError);
                throw new Error(`Payload inválido: ${JSON.stringify(validationError)}`);
            }
            const currentDomain = this.domainStrategy.getNextDomain();
            const url = `${currentDomain}/api/results`;
            logger_1.default.info(`Enviando para: ${url}`, validatedPayload.data);
            const response = await this.axiosInstance.post(url, validatedPayload.data);
            await EmailQueueModel_1.default.updateMany({ uuid }, { $set: { resultSent: true, lastUpdated: new Date() } });
            logger_1.default.info(`Sucesso: ${uuid} (${results.length} resultados)`);
        }
        catch (error) {
            const errorDetails = this.getAxiosErrorDetails(error);
            logger_1.default.error(`Falha no envio: ${uuid}`, {
                error: errorDetails.message,
                url: errorDetails.config?.url,
            });
            await EmailQueueModel_1.default.updateMany({ uuid }, {
                $set: {
                    lastError: errorDetails.message.slice(0, 200),
                    errorDetails: JSON.stringify(errorDetails.response?.data || {}).slice(0, 500),
                },
                $inc: { retryCount: 1 },
            });
        }
    }
    getErrorDetails(error) {
        return error instanceof Error
            ? { message: error.message, stack: error.stack }
            : { message: 'Erro desconhecido' };
    }
    getAxiosErrorDetails(error) {
        return axios_1.default.isAxiosError(error)
            ? {
                message: error.message,
                code: error.code,
                config: error.config,
                response: error.response?.data,
            }
            : this.getErrorDetails(error);
    }
}
exports.ResultSenderService = ResultSenderService;
exports.default = ResultSenderService;
