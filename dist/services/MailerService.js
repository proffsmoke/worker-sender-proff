"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
const EmailService_1 = __importDefault(require("./EmailService"));
const log_parser_1 = __importDefault(require("../log-parser"));
const BlockManagerService_1 = __importDefault(require("./BlockManagerService"));
const EmailStats_1 = __importDefault(require("../models/EmailStats"));
const uuid_1 = require("uuid");
const EmailLog_1 = __importDefault(require("../models/EmailLog"));
class MailerService {
    constructor() {
        this.isBlocked = false;
        this.isBlockedPermanently = false;
        this.blockReason = null;
        this.version = '4.3.26-1';
        this.retryIntervalId = null;
        this.isMonitoringStarted = false;
        this.initialTestCompleted = false;
        // Flags para evitar reenvio imediato:
        this.isTestEmailSending = false; // se já estamos enviando/testando
        this.lastTestEmailAttempt = 0; // timestamp da última tentativa de envio
        this.testEmailInterval = 4 * 60 * 1000; // intervalo de 4 min
        // Contador simples para transformar o block temporary em permanent caso falhe novamente:
        // (opcional, se quiser bloquear permanentemente no segundo teste falho)
        this.blockTemporaryRetries = 0;
        this.createdAt = new Date();
        this.logParser = new log_parser_1.default('/var/log/mail.log');
        this.emailService = EmailService_1.default.getInstance(this.logParser);
        this.blockManagerService = BlockManagerService_1.default.getInstance(this);
        // Conectar logParser ao BlockManagerService
        this.logParser.on('log', (logEntry) => {
            this.blockManagerService.handleLogEntry(logEntry);
        });
        // Inicia a lógica (apenas um teste inicial)
        this.initialize();
    }
    static getInstance() {
        if (!MailerService.instance) {
            MailerService.instance = new MailerService();
        }
        return MailerService.instance;
    }
    /**
     * Força o início do monitoramento de logs (caso ainda não tenha iniciado).
     */
    forceLogInitialization() {
        if (!this.isMonitoringStarted) {
            this.logParser.startMonitoring();
            this.isMonitoringStarted = true;
            logger_1.default.info('Logs foram forçados a iniciar a leitura.');
        }
    }
    initialize() {
        // Somente faz o teste inicial se não estiver permanentemente bloqueado
        if (!this.isBlockedPermanently) {
            this.sendInitialTestEmail();
        }
        else {
            logger_1.default.warn('Mailer is permanently blocked. Initial test omitted.');
        }
    }
    getVersion() {
        return this.version;
    }
    getCreatedAt() {
        return this.createdAt;
    }
    getStatus() {
        if (this.isBlockedPermanently) {
            return 'blocked_permanently';
        }
        if (this.isBlocked) {
            return 'blocked_temporary';
        }
        // Se ainda não concluímos o teste inicial, retorna "disabled".
        if (!this.initialTestCompleted) {
            return 'disabled';
        }
        return 'health';
    }
    getBlockReason() {
        return this.blockReason;
    }
    isMailerBlocked() {
        return this.isBlocked;
    }
    isMailerPermanentlyBlocked() {
        return this.isBlockedPermanently;
    }
    blockMailer(status, reason) {
        // Se já bloqueamos permanentemente, não faz nada
        if (this.isBlockedPermanently)
            return;
        if (status === 'blocked_permanently') {
            this.isBlocked = true;
            this.isBlockedPermanently = true;
            this.blockReason = reason;
            logger_1.default.warn(`🚨 PERMANENT BLOCK APPLIED: ${reason}`);
            this.clearRetryInterval();
            return;
        }
        if (!this.isBlocked) {
            this.isBlocked = true;
            this.blockReason = reason;
            logger_1.default.warn(`⏳ TEMPORARY BLOCK APPLIED: ${reason}`);
            this.scheduleRetry();
        }
    }
    unblockMailer() {
        if (this.isBlocked && !this.isBlockedPermanently) {
            this.isBlocked = false;
            this.blockReason = null;
            this.blockTemporaryRetries = 0; // reseta tentativas
            logger_1.default.info('Mailer unblocked.');
            this.clearRetryInterval();
        }
    }
    scheduleRetry() {
        if (this.isBlockedPermanently) {
            logger_1.default.info('Mailer is permanently blocked. No retries will be attempted.');
            return;
        }
        if (this.retryIntervalId) {
            return;
        }
        logger_1.default.info('Scheduling test email retry every 4 minutes.');
        this.retryIntervalId = setInterval(() => this.retrySendEmail(), 4 * 60 * 1000);
    }
    clearRetryInterval() {
        if (this.retryIntervalId) {
            clearInterval(this.retryIntervalId);
            this.retryIntervalId = null;
            logger_1.default.info('Retry interval cleared.');
        }
    }
    /**
     * Tenta reenviar o e-mail de teste caso estejamos em block temporário.
     * Se falhar novamente, bloqueia permanentemente (caso deseje essa lógica).
     */
    async retrySendEmail() {
        if (!this.isBlocked || this.isBlockedPermanently) {
            // Se não está mais bloqueado temporariamente, ou já está perm,
            // não precisamos continuar tentando.
            this.clearRetryInterval();
            logger_1.default.info('Mailer is not temporarily blocked. Canceling retries.');
            return;
        }
        logger_1.default.info('Attempting to resend test email...');
        const result = await this.sendInitialTestEmail();
        if (result.success) {
            logger_1.default.info('Test email resend successful. Canceling further retries.');
            this.clearRetryInterval();
            return;
        }
        //bloco inutil comentado
        // Se este ponto é alcançado, significa que o teste falhou de novo.
        // Caso queira bloquear permanentemente já na segunda falha:
        // this.blockTemporaryRetries += 1;
        // if (this.blockTemporaryRetries >= 1) {
        //   logger.warn('Retried test email failed again. Applying permanent block.');
        //   this.blockMailer('blocked_permanently', 'Retried test email failed again.');
        //   this.clearRetryInterval();
        // }
        // Caso prefira mais tentativas antes do permanent block,
        // ajuste o if acima para `>= 2`, por exemplo.
    }
    /**
     * Primeiro teste (inicial). Se falhar ou der timeout, marcamos temporário.
     * Se tiver sucesso, viramos "health".
     */
    async sendInitialTestEmail() {
        if (this.isBlockedPermanently) {
            logger_1.default.warn('Mailer is permanently blocked. Test omitted.');
            return { success: false };
        }
        // Se já concluímos o teste inicial com sucesso, não refazemos
        // (exceto se estivermos explicitamente em block temporário)
        if (this.initialTestCompleted && !this.isBlocked) {
            logger_1.default.info('Initial test already completed successfully. Skipping test email.');
            return { success: true };
        }
        if (this.isTestEmailSending) {
            logger_1.default.warn('A test email send is already in progress. Skipping...');
            return { success: false };
        }
        const now = Date.now();
        if (now - this.lastTestEmailAttempt < this.testEmailInterval) {
            logger_1.default.warn(`Last test email attempt was too recent (${Math.round((now - this.lastTestEmailAttempt) / 1000)}s ago). Skipping...`);
            return { success: false };
        }
        this.isTestEmailSending = true;
        this.lastTestEmailAttempt = now;
        const testEmailParams = {
            fromName: 'Mailer Test',
            emailDomain: config_1.default.mailer.noreplyEmail.split('@')[1] || 'unknown.com',
            to: config_1.default.mailer.noreplyEmail,
            subject: 'Initial Test Email',
            html: '<p>This is an initial test email to verify Mailer functionality.</p>',
            clientName: 'Test Client',
        };
        try {
            const requestUuid = (0, uuid_1.v4)();
            logger_1.default.info(`UUID generated for test: ${requestUuid}`);
            const result = await this.emailService.sendEmail(testEmailParams, requestUuid);
            const queueId = result.queueId;
            logger_1.default.info(`Test email sent with queueId=${queueId}`);
            // Aguarda log do MTA (até 1 min) para ver se deu sucesso
            const logEntry = await this.waitForLogEntry(queueId, 60000);
            // Se veio log e success=true, consideramos sucesso.
            if (logEntry && logEntry.success) {
                logger_1.default.info(`Test email sent successfully. mailId: ${logEntry.mailId}`);
                this.unblockMailer();
                this.initialTestCompleted = true; // teste inicial concluído
                return { success: true, mailId: logEntry.mailId };
            }
            else {
                // Falha ou timeout => block temporary (se ainda não for permanent)
                this.initialTestCompleted = true;
                logger_1.default.warn(`Failed to send test email. Details: ${JSON.stringify(logEntry)}`);
                if (!this.isBlockedPermanently) {
                    this.blockMailer('blocked_temporary', 'Failed to send test email.');
                }
                return { success: false, mailId: logEntry?.mailId };
            }
        }
        catch (error) {
            logger_1.default.error(`Error sending test email: ${error.message}`, error);
            if (!this.isBlockedPermanently) {
                this.blockMailer('blocked_temporary', `Error sending test email: ${error.message}`);
            }
            await EmailStats_1.default.incrementFail();
            return { success: false };
        }
        finally {
            this.isTestEmailSending = false;
        }
    }
    /**
     * Espera pelo registro do log referente ao envio, por até X ms (timeout).
     */
    async waitForLogEntry(queueId, timeout) {
        return new Promise((resolve) => {
            const checkInterval = 500;
            let elapsedTime = 0;
            const intervalId = setInterval(async () => {
                const emailLog = await EmailLog_1.default.findOne({ queueId: queueId });
                if (emailLog && emailLog.success !== null) {
                    clearInterval(intervalId);
                    const logEntry = {
                        timestamp: emailLog.sentAt.toISOString(),
                        queueId: emailLog.queueId,
                        email: emailLog.email,
                        result: emailLog.success ? 'sent' : 'failed',
                        success: emailLog.success,
                        mailId: emailLog.mailId,
                    };
                    resolve(logEntry);
                }
                else {
                    elapsedTime += checkInterval;
                    if (elapsedTime >= timeout) {
                        clearInterval(intervalId);
                        resolve(null); // timeout => sem resposta
                    }
                }
            }, checkInterval);
        });
    }
}
exports.default = MailerService;
