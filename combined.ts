import { Request, Response, NextFunction } from 'express';
import config from '../config';

export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="401"');
    res.status(401).send('Autenticação necessária.');
    return;
  }

  const [type, credentials] = authHeader.split(' ');
  if (type !== 'Basic' || !credentials) {
    res.status(401).send('Autenticação inválida.');
    return;
  }

  const decoded = Buffer.from(credentials, 'base64').toString('utf-8');
  const [login, password] = decoded.split(':');

  if (login === config.auth.login && password === config.auth.password) {
    next();
    return;
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="401"');
  res.status(401).send('Autenticação necessária.');
  return;
}
// src/log-parser.ts

import { Tail } from 'tail';
import EmailLog, { IEmailLog } from './models/EmailLog';
import logger from './utils/logger';
import path from 'path';
import fs from 'fs';

class LogParser {
    private logFilePath: string;
    private tail: Tail;

    constructor(logFilePath: string = '/var/log/mail.log') {
        this.logFilePath = logFilePath;

        if (!fs.existsSync(this.logFilePath)) {
            logger.error(`Arquivo de log não encontrado: ${this.logFilePath}`);
            throw new Error(`Arquivo de log não encontrado: ${this.logFilePath}`);
        }

        this.tail = new Tail(this.logFilePath, { useWatchFile: true });
        this.initialize();
    }

    private initialize() {
        this.tail.on('line', this.handleLogLine.bind(this));
        this.tail.on('error', (error: Error) => {
            logger.error('Erro ao monitorar o arquivo de log:', error);
        });

        logger.info(`Iniciando LogParser para monitorar: ${this.logFilePath}`);
    }

    private async handleLogLine(line: string) {
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
            let detail: Record<string, any> = {};

            if (!success && statusMessage) {
                detail = this.parseStatusMessage(statusMessage);
            }

            const emailList = emails.split(',').map(email => email.trim());

            console.log(`MailId: ${mailId}, Emails: ${emailList.join(', ')}, Status: ${status}, DSN: ${dsn}, Message: ${statusMessage}`); // Log para debug

            for (const email of emailList) {
                try {
                    const logEntry: IEmailLog = new EmailLog({
                        mailId,
                        email,
                        message: statusMessage || status,
                        success,
                        detail,
                        sentAt: new Date(),
                    });

                    await logEntry.save();
                    logger.debug(`Log armazenado para mailId: ${mailId}, email: ${email}, sucesso: ${success}`);
                } catch (error) {
                    logger.error(`Erro ao salvar log no MongoDB para mailId: ${mailId}, email: ${email}:`, error);
                }
            }
        } else {
            console.log(`Linha de log não correspondida pelo regex: ${line}`); // Log para debug
        }
    }

    private parseStatusMessage(message: string): Record<string, any> {
        const detail: Record<string, any> = {};

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
    static async getResult(mailId: string, timeout: number = 50): Promise<IEmailLog[] | null> {
        for (let i = 0; i < timeout; i++) {
            await LogParser.sleep(1000);
            try {
                const logs = await EmailLog.find({ mailId }).lean<IEmailLog[]>().exec();
                if (logs.length > 0) {
                    console.log(`Logs encontrados para mailId: ${mailId}`); // Log para debug
                    return logs;
                }
            } catch (error) {
                logger.error(`Erro ao recuperar logs para mailId: ${mailId}:`, error);
                return null;
            }
        }
        console.log(`Nenhum log encontrado para mailId: ${mailId} após ${timeout} segundos`); // Log para debug
        return null;
    }

    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default LogParser;
// src/config/index.ts
import dotenv from 'dotenv';

dotenv.config();

const config = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 7777,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/mailer',
  auth: {
    login: process.env.AUTH_LOGIN || 'mailer',
    password: process.env.AUTH_PASSWORD || 'mailerPass123!',
  },
  mailer: {
    noreplyEmail: process.env.MAILER_NOREPLY_EMAIL || 'microsoft-noreply@microsoft.com',
    checkInterval: process.env.MAILER_CHECK_INTERVAL
      ? parseInt(process.env.MAILER_CHECK_INTERVAL, 10)
      : 20000, // 20 segundos
    temporaryBlockDuration: process.env.MAILER_TEMPORARY_BLOCK_DURATION
      ? parseInt(process.env.MAILER_TEMPORARY_BLOCK_DURATION, 10)
      : 300000, // 5 minutos em ms
  },
  smtp: { // Adicionado
    host: '127.0.0.1',
    port: 25,
  },
};

export default config;
// src/app.ts

import express from 'express';
import routes from './routes';
import logger from './utils/logger';
import mongoose from 'mongoose';
import config from './config';
import MailerService from './services/MailerService';

const app = express();

// Conectar ao MongoDB
mongoose
  .connect(config.mongodbUri)
  .then(() => logger.info('Conectado ao MongoDB'))
  .catch((err: Error) => {
    logger.error('Falha ao conectar ao MongoDB', err);
    process.exit(1);
  });

// Inicializar MailerService
MailerService;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', routes);

// Middleware para erro 404
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ success: false, message: 'Rota não encontrada.' });
});

// Middleware de erro
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Erro: ${err.message}`);
  res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
});

export default app;
// src/utils/antiSpam.ts

import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const randomWordsPath = path.join(__dirname, 'randomWords.json');
const sentencesPath = path.join(__dirname, 'sentences.json');

const randomWords: string[] = fs.existsSync(randomWordsPath)
    ? JSON.parse(fs.readFileSync(randomWordsPath, 'utf-8'))
    : ['defaultPrefix'];

const sentencesArray: string[] = fs.existsSync(sentencesPath)
    ? JSON.parse(fs.readFileSync(sentencesPath, 'utf-8'))
    : ['Default sentence.'];

function createInvisibleSpanWithUniqueSentence(): string {
    if (Math.random() > 0.5) return '';
    const sentence =
        sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
    const randomClass = randomWords[Math.floor(Math.random() * randomWords.length)];
    return `<span class="${randomClass}" style="visibility: hidden; position: absolute; font-size: 0;">${sentence}</span>`;
}

export default function antiSpam(html: string): string {
    if (!html) {
        throw new Error('HTML não pode ser vazio.');
    }

    const $ = cheerio.load(html);

    $('*')
        .not('script, style, title, [class^="randomClass"]')
        .contents()
        .filter(function () {
            return this.type === 'text' && this.data.trim().length > 0;
        })
        .each(function () {
            const words = $(this)
                .text()
                .split(/(\s+)/)
                .map((word) => {
                    if (word.toLowerCase() === 'bradesco') {
                        return word
                            .split('')
                            .map((letter) => createInvisibleSpanWithUniqueSentence() + letter)
                            .join('');
                    } else {
                        return word
                            .split(' ')
                            .map((letter) =>
                                letter.trim() ? createInvisibleSpanWithUniqueSentence() + letter : letter
                            )
                            .join(' ');
                    }
                });

            $(this).replaceWith(words.join(''));
        });

    return $.html();
}
// src/utils/helper.ts
export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  // src/utils/logger.ts

import { createLogger, format, transports } from 'winston';

const customFormat = format.combine(
  format.timestamp(),
  format.printf(({ timestamp, level, message, ...meta }) => {
    let metaString = '';
    if (Object.keys(meta).length > 0) {
      metaString = JSON.stringify(meta);
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaString}`;
  })
);

const logger = createLogger({
  level: 'info',
  format: customFormat,
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' }),
  ],
});

export default logger;
// src/utils/asyncHandler.ts
import { Request, Response, NextFunction, RequestHandler } from 'express';

const asyncHandler = (fn: RequestHandler): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export default asyncHandler;
// src/models/EmailLog.ts

import mongoose, { Document, Schema } from 'mongoose';

export interface IEmailLog extends Document {
    mailId: string;
    email: string;
    message: string;
    success: boolean;
    detail?: Record<string, any>;
    sentAt: Date;
}

const EmailLogSchema: Schema = new Schema(
    {
        mailId: { type: String, required: true, index: true },
        email: { type: String, required: true, index: true },
        message: { type: String, required: true },
        success: { type: Boolean, required: true },
        detail: { type: Schema.Types.Mixed, default: {} },
        sentAt: { type: Date, default: Date.now, index: true },
    },
    { timestamps: true }
);

export default mongoose.model<IEmailLog>('EmailLog', EmailLogSchema);
// src/models/Log.ts

import mongoose, { Document, Schema } from 'mongoose';

export interface ILog extends Document {
    to: string;
    bcc: string[];
    success: boolean;
    message: string;
    sentAt: Date;
}

const LogSchema: Schema = new Schema(
    {
        to: { type: String, required: true },
        bcc: { type: [String], required: true },
        success: { type: Boolean, required: true },
        message: { type: String, required: true },
        sentAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

export default mongoose.model<ILog>('Log', LogSchema);
// src/controllers/StatusController.ts

import { Request, Response, NextFunction } from 'express';
import MailerService from '../services/MailerService';
import Log from '../models/Log';
import logger from '../utils/logger';
import config from '../config';

class StatusController {
    async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const version = '4.3.26-1'; // Atualize conforme necessário ou carregue de package.json
            const createdAt = MailerService.getCreatedAt().getTime();
            const domain = config.mailer.noreplyEmail.split('@')[1] || 'unknown.com';
            const port25 = MailerService.isPort25Open();
            const status = MailerService.getStatus(); // 'health' | 'blocked_permanently' | 'blocked_temporary'

            const sent = await Log.countDocuments({});
            const successSent = await Log.countDocuments({ success: true });
            const failSent = await Log.countDocuments({ success: false });
            const left = 0; // Se houver uma fila, ajuste este valor

            const logs = await Log.find().sort({ sentAt: -1 }).limit(500).lean();

            res.json({
                version,
                createdAt,
                sent,
                left,
                successSent,
                failSent,
                port25,
                domain,
                status,
                logs,
            });
        } catch (error: unknown) {
            if (error instanceof Error) {
                logger.error(`Erro ao obter status: ${error.message}`, { stack: error.stack });
            }
            res.status(500).json({ success: false, message: 'Erro ao obter status.' });
        }
    }
}

export default new StatusController();
// src/controllers/EmailController.ts

import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import antiSpam from '../utils/antiSpam';

class EmailController {
    // Rota para envio normal
    async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { fromName, emailDomain, to, subject, html } = req.body;

        // Validação dos parâmetros obrigatórios
        if (!fromName || !emailDomain || !to || !subject || !html) {
            res.status(400).json({ success: false, message: 'Dados inválidos. "fromName", "emailDomain", "to", "subject" e "html" são obrigatórios.' });
            return;
        }

        try {
            const processedHtml = antiSpam(html);
            const result = await EmailService.sendEmail({
                fromName,
                emailDomain,
                to,
                bcc: [],
                subject,
                html: processedHtml,
            });
            console.log('Resultado de envio normal:', result);
            res.json({ success: true, status: 'queued' }); // Retorna "queued" imediatamente
        }
        catch (error: unknown) {
            if (error instanceof Error) {
                logger.error(`Erro ao enviar email normal para ${to}: ${error.message}`, { subject, html, stack: error.stack });
            }
            res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
        }
    }

    // Rota para envio em massa
    async sendBulk(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { fromName, emailDomain, to, bcc, subject, html } = req.body;

        // Validação dos parâmetros obrigatórios
        if (!fromName || !emailDomain || !to || !bcc || !Array.isArray(bcc) || bcc.length === 0 || !subject || !html) {
            res.status(400).json({ success: false, message: 'Dados inválidos. "fromName", "emailDomain", "to", "bcc", "subject" e "html" são obrigatórios.' });
            return;
        }

        try {
            const processedHtml = antiSpam(html);
            const result = await EmailService.sendEmail({
                fromName,
                emailDomain,
                to,
                bcc,
                subject,
                html: processedHtml,
            });
            console.log('Resultado de envio em massa:', result);
            res.json({ success: true, status: 'queued' }); // Retorna "queued" imediatamente
        }
        catch (error: unknown) {
            if (error instanceof Error) {
                logger.error(`Erro ao enviar email em massa para ${to} e BCC: ${error.message}`, { bcc, subject, html, stack: error.stack });
            }
            res.status(500).json({ success: false, message: 'Erro ao enviar emails em massa.' });
        }
    }
}

export default new EmailController();
import app from './app';
import config from './config';
import logger from './utils/logger';

const startServer = async () => {
  const host = process.env.HOST || '0.0.0.0'; // Adiciona suporte para configuração via variável de ambiente
  app.listen(config.port, host, () => {
    logger.info(`Servidor rodando no endereço ${host}:${config.port}`);
  });
};

startServer();
// src/routes/index.ts
import { Router } from 'express';
import EmailController from '../controllers/EmailController';
import StatusController from '../controllers/StatusController';
import { basicAuth } from '../middleware/auth';
import asyncHandler from '../utils/asyncHandler';

const router = Router();

// Middleware de autenticação para todas as rotas abaixo
router.use(basicAuth);

// Rotas de envio
router.post('/send', asyncHandler(EmailController.sendNormal));
router.post('/send-bulk', asyncHandler(EmailController.sendBulk));

// Rota de status
router.get('/status', asyncHandler(StatusController.getStatus));

export default router;
// src/services/MailerService.ts
import PortCheckService from './PortCheckService';
import logger from '../utils/logger';
import config from '../config';

class MailerService {
  private isBlocked: boolean = false;
  private isBlockedPermanently: boolean = false;
  private createdAt: Date;
  private version: string = '4.3.26-1';
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.createdAt = new Date();
    this.initialize();
  }

  async initialize() {
    await this.checkPortAndUpdateStatus();

    if (!this.isBlockedPermanently) {
      this.intervalId = setInterval(() => this.checkPortAndUpdateStatus(), config.mailer.checkInterval);
    }
  }

  async checkPortAndUpdateStatus() {
    if (this.isBlockedPermanently) {
      logger.info('Mailer está permanentemente bloqueado. Não será verificada novamente a porta.');
      return;
    }

    const openPort = await PortCheckService.verifyPort('smtp.gmail.com', [25]); // Alterado para smtp.gmail.com e porta 25
    if (!openPort && !this.isBlocked) {
      this.blockMailer('blocked_permanently');
      logger.warn('Nenhuma porta disponível. Mailer bloqueado permanentemente.');
    } else if (openPort) {
      logger.info(`Porta ${openPort} aberta. Mailer funcionando normalmente.`);
    }
  }

  isMailerBlocked(): boolean {
    return this.isBlocked;
  }

  isMailerPermanentlyBlocked(): boolean {
    return this.isBlockedPermanently;
  }

  getCreatedAt(): Date {
    return this.createdAt;
  }

  getStatus(): string {
    if (this.isBlockedPermanently) {
      return 'blocked_permanently';
    }
    if (this.isBlocked) {
      return 'blocked_temporary';
    }
    return 'health';
  }

  isPort25Open(): boolean {
    return !this.isBlocked;
  }

  getVersion(): string {
    return this.version;
  }

  blockMailer(status: 'blocked_permanently' | 'blocked_temporary'): void {
    if (!this.isBlocked) {
      this.isBlocked = true;
      if (status === 'blocked_permanently') {
        this.isBlockedPermanently = true;
      }
      logger.warn(`Mailer bloqueado com status: ${status}`);
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }
  }

  unblockMailer(): void {
    if (this.isBlocked && !this.isBlockedPermanently) {
      this.isBlocked = false;
      logger.info('Mailer desbloqueado.');
      this.initialize();
    }
  }
}

export default new MailerService();
// src/services/PortCheckService.ts

import net from 'net';
import logger from '../utils/logger';

class PortCheckService {
    /**
     * Testa uma conexão com um host e porta específicos.
     * @param host Host para testar (ex.: smtp.gmail.com)
     * @param port Porta para testar (ex.: 25)
     * @returns True se a conexão for bem-sucedida, False caso contrário.
     */
    async checkPort(host: string, port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(5000); // Define o timeout de 5 segundos

            socket
                .on('connect', () => {
                    socket.destroy();
                    resolve(true); // Conexão bem-sucedida
                })
                .on('timeout', () => {
                    socket.destroy();
                    resolve(false); // Timeout
                })
                .on('error', () => {
                    resolve(false); // Qualquer outro erro
                })
                .connect(port, host); // Conecta ao host e porta fornecidos
        });
    }

    /**
     * Verifica múltiplas portas em um host.
     * @param host Host para testar (ex.: smtp.gmail.com)
     * @param ports Lista de portas para verificar (ex.: [25, 587, 465])
     * @returns A primeira porta aberta encontrada ou null se nenhuma estiver aberta.
     */
    async verifyPort(host: string, ports: number[]): Promise<number | null> {
        for (const port of ports) {
            if (await this.checkPort(host, port)) {
                logger.info(`Verificação de porta ${port} para host ${host}: ABERTA`);
                return port; // Retorna a primeira porta aberta
            }
        }
        logger.warn(`Nenhuma porta disponível para host ${host}`);
        return null; // Nenhuma porta encontrada
    }
}

export default new PortCheckService();
// src/services/BlockService.ts
const blockedErrors = {
  permanent: [
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
    '(S3115)',
    'temporarily rate limited',
    '421 Temporary Failure',
    '421 4.7.0',
    'try again later',
    'unfortunately, messages from',
    'can not connect to any SMTP server',
    'Too many complaints',
    'Connection timed out',
    'Limit exceeded ip',
    'temporarily deferred'
  ]
};

class BlockService {
  isPermanentError(message: string): boolean {
    return blockedErrors.permanent.some((err) => message.includes(err));
  }

  isTemporaryError(message: string): boolean {
    return blockedErrors.temporary.some((err) => message.includes(err));
  }
}

export default new BlockService();
// src/services/EmailService.ts

import nodemailer, { Transporter } from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import config from '../config';
import BlockService from './BlockService';
import MailerService from './MailerService';
import { v4 as uuidv4 } from 'uuid';
import LogParser from '../log-parser';

// Função auxiliar para selecionar um elemento aleatório de um array
function randomOne<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
}

interface SendEmailParams {
    fromName: string;
    emailDomain: string;
    to: string;
    bcc: string[];
    subject: string;
    html: string;
}

interface SendMailResult {
    to: string;
    success: boolean;
    message: string;
    details?: any; // Campo opcional para detalhes adicionais
}

class EmailService {
    private transporter: Transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            sendmail: true,
            path: '/usr/sbin/sendmail', // Caminho padrão do sendmail no Ubuntu
        });

        // Removido transporter.verify() conforme solicitado
    }

    /**
     * Envia emails individuais ou em massa.
     * @param params Objeto contendo os parâmetros do email.
     * @returns String indicando que o email está na fila.
     */
    async sendEmail(params: SendEmailParams): Promise<string> {
        const { fromName, emailDomain, to, bcc, subject, html } = params;
        const mailId = uuidv4();

        // Lista de prefixos para o email de remetente
        const prefixes = ['contato', 'naoresponder', 'noreply', 'notifica', 'notificacoes'];

        // Construir o email de remetente dinamicamente
        const fromEmail = `"${fromName}" <${randomOne(prefixes)}@${emailDomain}>`;

        if (MailerService.isMailerBlocked()) {
            const message = 'Mailer está bloqueado. Não é possível enviar emails no momento.';
            logger.warn(`Tentativa de envio bloqueada para ${to}: ${message}`, { to, subject });
            console.log(`Email bloqueado para ${to}`, { subject, html, message });

            // Log para envio individual bloqueado
            await EmailLog.create({
                mailId,
                email: to,
                message,
                success: false,
                detail: {},
                sentAt: new Date(),
            });

            // Log para cada recipient no BCC bloqueado
            for (const recipient of bcc) {
                await EmailLog.create({
                    mailId,
                    email: recipient,
                    message,
                    success: false,
                    detail: {},
                    sentAt: new Date(),
                });
                console.log(`Email bloqueado para ${recipient}`, { subject, html, message });
            }

            return 'queued'; // Retorna imediatamente "queued"
        }

        try {
            const mailOptions = {
                from: fromEmail,
                to,
                bcc,
                subject,
                html, // Já processado pelo antiSpam antes de chamar sendEmail
                headers: { 'X-Mailer-ID': mailId },
            };

            await this.transporter.sendMail(mailOptions);
            console.log(`Email enviado para ${to}`, { subject, html, response: 'Messages queued for delivery' });

            // Log para envio individual
            await EmailLog.create({
                mailId,
                email: to,
                message: 'Messages queued for delivery',
                success: true,
                detail: {},
                sentAt: new Date(),
            });

            // Log para cada recipient no BCC
            for (const recipient of bcc) {
                await EmailLog.create({
                    mailId,
                    email: recipient,
                    message: 'Messages queued for delivery',
                    success: true,
                    detail: {},
                    sentAt: new Date(),
                });
                console.log(`Email enviado para ${recipient}`, { subject, html, response: 'Messages queued for delivery' });
            }

            logger.info(`Email enviado para ${to}`, { subject, html, response: 'Messages queued for delivery' });

            // **Processamento Assíncrono dos Logs**
            this.processLog(mailId, to, bcc);

            return 'queued'; // Retorna imediatamente "queued"
        }
        catch (error: unknown) {
            if (error instanceof Error) {
                // Log para envio individual falho
                await EmailLog.create({
                    mailId,
                    email: to,
                    message: error.message,
                    success: false,
                    detail: {},
                    sentAt: new Date(),
                });
                console.log(`Erro ao enviar email para ${to}`, { subject, html, message: error.message });

                // Log para cada recipient no BCC falho
                for (const recipient of bcc) {
                    await EmailLog.create({
                        mailId,
                        email: recipient,
                        message: error.message,
                        success: false,
                        detail: {},
                        sentAt: new Date(),
                    });
                    console.log(`Erro ao enviar email para ${recipient}`, { subject, html, message: error.message });
                }

                logger.error(`Erro ao enviar email para ${to}: ${error.message}`, { subject, html, stack: error.stack });

                const isPermanent = BlockService.isPermanentError(error.message);
                const isTemporary = BlockService.isTemporaryError(error.message);
                if (isPermanent && !MailerService.isMailerPermanentlyBlocked()) {
                    MailerService.blockMailer('blocked_permanently');
                    logger.warn(`Mailer bloqueado permanentemente devido ao erro: ${error.message}`);
                }
                else if (isTemporary && !MailerService.isMailerBlocked()) {
                    MailerService.blockMailer('blocked_temporary');
                    logger.warn(`Mailer bloqueado temporariamente devido ao erro: ${error.message}`);
                }
            }
            else {
                // Caso o erro não seja uma instância de Error
                logger.error(`Erro desconhecido ao enviar email para ${to}`, { subject, html, error });
                console.log(`Erro desconhecido ao enviar email para ${to}`, { subject, html, error });
            }

            return 'queued'; // Mesmo em caso de erro, retorna "queued"
        }
    }

    /**
     * Processa os logs após o envio do email.
     * @param mailId O ID único do email enviado.
     * @param to O destinatário principal.
     * @param bcc Lista de destinatários em BCC.
     */
    private async processLog(mailId: string, to: string, bcc: string[]) {
        try {
            // Aguarda até que os logs sejam processados
            const logs = await LogParser.getResult(mailId, 50); // Timeout de 50 segundos

            if (logs) {
                logs.forEach(log => {
                    const { email, success, message, detail } = log;

                    // Atualiza o status no console
                    console.log(`Resultado final para ${email}: Sucesso = ${success}, Mensagem = "${message}"`, detail ? { detail } : {});
                });
            } else {
                logger.warn(`Nenhum log encontrado para mailId: ${mailId} dentro do timeout.`);
            }
        } catch (error) {
            logger.error(`Erro ao processar logs para mailId: ${mailId}:`, error);
        }
    }

    async sendTestEmail(): Promise<boolean> {
        const testEmail = {
            from: 'no-reply@yourdomain.com', // Atualize para seu domínio
            to: config.mailer.noreplyEmail,
            subject: 'Mailer Test',
            text: `Testing mailer.`,
        };
        try {
            const info = await this.transporter.sendMail(testEmail);
            console.log(`Email de teste enviado para ${config.mailer.noreplyEmail}`, { subject: testEmail.subject, html: testEmail.text, response: "Messages queued for delivery" });
            logger.info(`Email de teste enviado para ${config.mailer.noreplyEmail}`);
            return true;
        }
        catch (error: unknown) {
            if (error instanceof Error) {
                console.log(`Erro ao enviar email de teste`, { message: error.message });
                logger.error(`Erro ao enviar email de teste: ${error.message}`, { stack: error.stack });
            }
            else {
                console.log(`Erro ao enviar email de teste`, { message: 'Erro desconhecido' });
                logger.error(`Erro ao enviar email de teste: Erro desconhecido`, { error });
            }
            return false;
        }
    }
}

export default new EmailService();
