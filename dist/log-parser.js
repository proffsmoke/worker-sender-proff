"use strict";
// src/log-parser.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tail_1 = require("tail");
const EmailLog_1 = __importDefault(require("./models/EmailLog"));
const logger_1 = __importDefault(require("./utils/logger"));
const fs_1 = __importDefault(require("fs"));
class LogParser {
    constructor(logFilePath = '/var/log/mail.log') {
        this.logFilePath = logFilePath;
        if (!fs_1.default.existsSync(this.logFilePath)) {
            logger_1.default.error(`Arquivo de log não encontrado: ${this.logFilePath}`);
            throw new Error(`Arquivo de log não encontrado: ${this.logFilePath}`);
        }
        this.tail = new tail_1.Tail(this.logFilePath, { useWatchFile: true });
        this.initialize();
    }
    initialize() {
        this.tail.on('line', this.handleLogLine.bind(this));
        this.tail.on('error', (error) => {
            logger_1.default.error('Erro ao monitorar o arquivo de log:', error);
        });
        logger_1.default.info(`Iniciando LogParser para monitorar: ${this.logFilePath}`);
    }
    async handleLogLine(line) {
        console.log(`Linha de log recebida: ${line}`); // Log para debug
        /**
         * Exemplos de linhas de log:
         * sendmail[34063]: 4B20po7G034063: to=recipient@example.com, ctladdr=naoresponder@seu-dominio.com (0/0), delay=00:00:00, xdelay=00:00:00, mailer=relay, pri=31004, relay=[127.0.0.1] [127.0.0.1], dsn=2.0.0, stat=Sent (4B20pogp034064 Message accepted for delivery)
         * sm-mta[35942]: 4B24QxX9035940: to=<prasmatic@outlook.comm>, delay=00:00:00, xdelay=00:00:00, mailer=esmtp, pri=31235, relay=outlook.com., dsn=5.1.2, stat=Host unknown (Name server: outlook.comm: host not found)
         */
        // Atualize a expressão regular para capturar diferentes formatos e status
        const regex = /(?:sendmail|sm-mta)\[[0-9]+\]: ([A-Z0-9]+): to=<?([^>,]+(?:, *[^>,]+)*)>?, .*dsn=(\d+\.\d+\.\d+), stat=([^ ]+)(?: \((.+)\))?/i;
        const match = line.match(regex);
        if (match) {
            const [, mailId, emails, dsn, status, statusMessage] = match;
            const success = status.toLowerCase().startsWith('sent') || status.toLowerCase().startsWith('queued');
            let detail = {};
            if (!success && statusMessage) {
                detail = this.parseStatusMessage(statusMessage);
            }
            const emailList = emails.split(',').map(email => email.trim());
            console.log(`MailId: ${mailId}, Emails: ${emailList.join(', ')}, Status: ${status}, DSN: ${dsn}, Message: ${statusMessage}`); // Log para debug
            for (const email of emailList) {
                try {
                    const logEntry = new EmailLog_1.default({
                        mailId,
                        email,
                        message: statusMessage || status,
                        success,
                        detail,
                        sentAt: new Date(),
                    });
                    await logEntry.save();
                    logger_1.default.debug(`Log armazenado para mailId: ${mailId}, email: ${email}, sucesso: ${success}`);
                }
                catch (error) {
                    logger_1.default.error(`Erro ao salvar log no MongoDB para mailId: ${mailId}, email: ${email}:`, error);
                }
            }
        }
        else {
            console.log(`Linha de log não correspondida pelo regex: ${line}`); // Log para debug
        }
    }
    parseStatusMessage(message) {
        const detail = {};
        if (message.toLowerCase().includes('blocked')) {
            detail['blocked'] = true;
        }
        if (message.toLowerCase().includes('timeout')) {
            detail['timeout'] = true;
        }
        if (message.toLowerCase().includes('rejected')) {
            detail['rejected'] = true;
        }
        if (message.toLowerCase().includes('host unknown')) {
            detail['hostUnknown'] = true;
        }
        // Adicione mais condições conforme necessário
        return detail;
    }
    /**
     * Recupera os logs associados a um mailId específico.
     * @param mailId O ID único do email enviado.
     * @param timeout Tempo máximo em segundos para aguardar os logs.
     * @returns Array de logs ou null se nenhum log encontrado.
     */
    static async getResult(mailId, timeout = 50) {
        for (let i = 0; i < timeout; i++) {
            await LogParser.sleep(1000);
            try {
                const logs = await EmailLog_1.default.find({ mailId }).lean().exec();
                if (logs.length > 0) {
                    console.log(`Logs encontrados para mailId: ${mailId}`); // Log para debug
                    return logs;
                }
            }
            catch (error) {
                logger_1.default.error(`Erro ao recuperar logs para mailId: ${mailId}:`, error);
                return null;
            }
        }
        console.log(`Nenhum log encontrado para mailId: ${mailId} após ${timeout} segundos`); // Log para debug
        return null;
    }
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.default = LogParser;
