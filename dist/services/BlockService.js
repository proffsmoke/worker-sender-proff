"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../utils/logger"));
const blockedErrors = {
    permanent: [
        '(S3140)',
        'blacklisted',
        'blacklistado',
        'Spamhaus',
        'Barracuda',
        'barracuda',
        "The IP you're using to send mail is not authorized",
        'Spam message rejected',
        'www.spamhaus.org',
        'SPFBL permanently blocked',
        'SPFBL BLOCKED',
        'banned sending IP',
        'on our block list',
        '550 5.7.1',
        '554 Refused',
        'access denied',
        'blocked by policy',
        'IP blacklisted',
        'too many bad commands',
        'rejected due to policy'
    ],
    temporary: [
        '(S3114)',
        '(S844)',
        'temporarily rate limited',
        '421 Temporary Failure',
        '421 4.7.0',
        // 'try again later',
        'unfortunately, messages from',
        'can not connect to any SMTP server',
        'Too many complaints',
        'Connection timed out',
        'Limit exceeded ip',
        'temporarily deferred'
    ]
};
class BlockService {
    constructor() {
        this.isActive = false;
    }
    // Método para iniciar o serviço
    start() {
        if (this.isActive)
            return;
        this.isActive = true;
        logger_1.default.info('BlockService iniciado.');
        // Aqui você pode adicionar a lógica para monitorar o mail.log
    }
    // Método para parar o serviço
    stop() {
        if (!this.isActive)
            return;
        this.isActive = false;
        logger_1.default.info('BlockService parado.');
    }
    isPermanentError(message) {
        if (typeof message !== 'string')
            return false;
        return blockedErrors.permanent.some((err) => message.includes(err));
    }
    isTemporaryError(message) {
        if (typeof message !== 'string')
            return false;
        return blockedErrors.temporary.some((err) => message.includes(err));
    }
}
exports.default = new BlockService();
