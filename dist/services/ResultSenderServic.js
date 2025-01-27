"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultSenderService = void 0;
const axios_1 = __importDefault(require("axios"));
const zod_1 = require("zod"); // Importando Zod para validação
const EmailQueueModel_1 = __importDefault(require("../models/EmailQueueModel"));
const logger_1 = __importDefault(require("../utils/logger"));
// Esquema de validação com Zod
const ResultItemSchema = zod_1.z.object({
    queueId: zod_1.z.string(),
    email: zod_1.z.string().email(),
    success: zod_1.z.boolean(),
    data: zod_1.z.unknown().optional(),
});
const PayloadSchema = zod_1.z.object({
    fullPayload: zod_1.z.object({
        uuid: zod_1.z.string(),
        results: zod_1.z.array(ResultItemSchema),
    }),
});
const DOMAINS = ['http://localhost:4008'];
// Estratégia de rotação de domínios
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
            timeout: 8000,
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
        logger_1.default.info('ResultSenderService iniciado e agendado para executar a cada 10 segundos.');
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            logger_1.default.info('ResultSenderService parado.');
        }
    }
    async processResults() {
        if (this.isSending) {
            logger_1.default.info('ResultSenderService já está processando resultados. Aguardando a próxima iteração.');
            return;
        }
        this.isSending = true;
        logger_1.default.info('Iniciando o processamento de resultados.');
        try {
            logger_1.default.debug('Buscando registros no banco de dados com resultado não enviado e sucesso definido.');
            const emailQueues = await EmailQueueModel_1.default.find({
                'queueIds.success': { $exists: true, $ne: null },
                resultSent: false,
            }).lean(); // Usando lean() para melhorar a performance
            logger_1.default.info(`Encontrados ${emailQueues.length} registros para processar.`);
            logger_1.default.debug('Registros encontrados:', { emailQueues });
            const resultsByUuid = {};
            for (const emailQueue of emailQueues) {
                const { uuid, queueIds } = emailQueue;
                logger_1.default.info(`Processando emailQueue com uuid: ${uuid}`);
                logger_1.default.debug('Dados da emailQueue:', { uuid, queueIds });
                const validQueueIds = queueIds.filter((q) => q.success !== null);
                logger_1.default.debug(`Filtrados ${validQueueIds.length} queueIds com sucesso definido.`);
                const results = validQueueIds.map((q) => ({
                    queueId: q.queueId,
                    email: q.email,
                    success: q.success,
                    data: q.data,
                }));
                logger_1.default.debug('Resultados mapeados:', { results });
                if (results.length > 0) {
                    resultsByUuid[uuid] = [...(resultsByUuid[uuid] || []), ...results];
                }
            }
            logger_1.default.debug('Resultados agrupados por UUID:', { resultsByUuid });
            for (const [uuid, results] of Object.entries(resultsByUuid)) {
                if (results.length === 0) {
                    logger_1.default.warn(`Nenhum resultado válido para o uuid: ${uuid}. Pulando envio.`);
                    continue;
                }
                await this.validateAndSendResults(uuid, results);
            }
        }
        catch (error) {
            const { message, stack } = this.getErrorDetails(error);
            logger_1.default.error(`Erro ao processar resultados: ${message}`, { stack });
        }
        finally {
            this.isSending = false;
            logger_1.default.info('Processamento de resultados concluído.');
        }
    }
    async validateAndSendResults(uuid, results) {
        logger_1.default.info(`Validando e enviando resultados para o uuid: ${uuid}`);
        logger_1.default.debug('Resultados a serem enviados:', { uuid, results });
        try {
            const payload = {
                fullPayload: {
                    uuid,
                    results: results.map((r) => ({
                        queueId: r.queueId,
                        email: r.email,
                        success: r.success,
                        data: r.data,
                    })),
                },
            };
            logger_1.default.debug('Payload construído:', { payload });
            // Validação do payload com Zod
            const validatedPayload = PayloadSchema.safeParse(payload);
            if (!validatedPayload.success) {
                logger_1.default.error('Validação do payload falhou.', { errors: validatedPayload.error.errors });
                throw new Error(`Payload inválido: ${validatedPayload.error.message}`);
            }
            logger_1.default.info('Payload validado com sucesso.');
            const currentDomain = this.domainStrategy.getNextDomain();
            const url = `${currentDomain}/api/results`;
            logger_1.default.info(`Enviando payload para: ${url}`);
            logger_1.default.debug('Payload enviado:', { payload: validatedPayload.data });
            const response = await this.axiosInstance.post(url, validatedPayload.data);
            logger_1.default.info(`Resposta recebida: Status ${response.status} - ${response.statusText}`);
            logger_1.default.debug('Dados da resposta:', { data: response.data });
            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            // Atualizando os registros como enviados
            const updateResult = await EmailQueueModel_1.default.updateMany({ uuid }, {
                $set: {
                    resultSent: true,
                    lastUpdated: new Date(),
                },
            });
            logger_1.default.info(`Sucesso no envio: ${uuid} (${results.length} resultados). Registros atualizados: ${updateResult.nModified}`);
        }
        catch (error) {
            const errorDetails = this.getErrorDetails(error);
            const truncatedError = errorDetails.message.slice(0, 200);
            logger_1.default.error(`Falha no envio: ${uuid}`, {
                error: truncatedError,
                stack: errorDetails.stack?.split('\n').slice(0, 3).join(' '),
            });
            try {
                await EmailQueueModel_1.default.updateMany({ uuid }, {
                    $set: {
                        lastError: truncatedError,
                        errorDetails: JSON.stringify(errorDetails).slice(0, 500),
                    },
                    $inc: { retryCount: 1 },
                });
                logger_1.default.debug(`Registro atualizado com erros para o uuid: ${uuid}`);
            }
            catch (updateError) {
                const { message: updateMsg, stack: updateStack } = this.getErrorDetails(updateError);
                logger_1.default.error(`Falha ao atualizar o registro de erro para o uuid: ${uuid}`, {
                    error: updateMsg,
                    stack: updateStack,
                });
            }
        }
    }
    getErrorDetails(error) {
        if (error instanceof Error) {
            return {
                message: error.message,
                stack: error.stack,
            };
        }
        return {
            message: 'Erro desconhecido',
        };
    }
}
exports.ResultSenderService = ResultSenderService;
exports.default = ResultSenderService;
