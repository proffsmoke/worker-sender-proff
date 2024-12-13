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
// LogParser.js
import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';

interface LogEntry {
  queueId: string;
  recipient: string;
  status: string;
  messageId: string;
  dsn: string;
}

class LogParser extends EventEmitter {
  private logFilePath: string;
  private tail: Tail | null = null;
  private queueIdToMessageId: Map<string, string> = new Map();

  constructor(logFilePath: string = '/var/log/mail.log') {
    super();
    this.logFilePath = logFilePath;

    if (!fs.existsSync(this.logFilePath)) {
      logger.error(`Log file not found at path: ${this.logFilePath}`);
      throw new Error(`Log file not found: ${this.logFilePath}`);
    }

    this.tail = new Tail(this.logFilePath, { useWatchFile: true });
  }

  startMonitoring() {
    if (!this.tail) {
      logger.error('Attempting to monitor logs without initializing Tail.');
      return;
    }

    this.tail.on('line', this.handleLogLine.bind(this));
    this.tail.on('error', (error) => {
      logger.error('Error monitoring logs:', error);
    });

    logger.info(`Monitoring log file: ${this.logFilePath}`);
  }

  stopMonitoring() {
    if (this.tail) {
      this.tail.unwatch();
      logger.info('Log monitoring stopped.');
    } else {
      logger.warn('No active monitoring to stop.');
    }
  }

  private handleLogLine(line: string) {
    const cleanupRegex = /postfix\/cleanup\[\d+\]:\s+([A-Z0-9]+):\s+message-id=<([^>]+)>/i;
    const smtpRegex = /postfix\/smtp\[\d+\]:\s+([A-Z0-9]+):\s+to=<([^>]+)>,.*dsn=(\d+\.\d+\.\d+),.*status=([a-z]+)/i;

    let match = line.match(cleanupRegex);
    if (match) {
      const [_, queueId, messageId] = match;
      this.queueIdToMessageId.set(queueId, messageId);
      logger.debug(`Mapped Queue ID=${queueId} to Message-ID=${messageId}`);
      return;
    }

    match = line.match(smtpRegex);
    if (match) {
      const [_, queueId, recipient, dsn, status] = match;
      const messageId = this.queueIdToMessageId.get(queueId) || '';
      if (!messageId) {
        logger.warn(`No Message-ID found for Queue ID=${queueId}`);
      }

      const logEntry: LogEntry = {
        queueId,
        recipient,
        status,
        messageId,
        dsn,
      };

      logger.info(`LogParser captured: Queue ID=${queueId}, Recipient=${recipient}, Status=${status}, Message-ID=${messageId}, DSN=${dsn}`);

      this.emit('log', logEntry);
    }
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
  server: {
    logResultEndpoint: process.env.LOG_RESULT_ENDPOINT || 'https://mainserver.com/logs',
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
import mongoose, { Document, Schema } from 'mongoose';

export interface IEmailLog extends Document {
  mailId: string; // UUID
  sendmailQueueId?: string; // Queue ID
  email: string;
  message: string;
  success: boolean | null;
  detail?: Record<string, any>;
  sentAt: Date;
}

const EmailLogSchema: Schema = new Schema(
  {
    mailId: { type: String, required: true, index: true },
    sendmailQueueId: { type: String, index: true },
    email: { type: String, required: true, index: true },
    message: { type: String, required: true },
    success: { type: Boolean, default: null },
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
import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import antiSpam from '../utils/antiSpam';

class EmailController {
    // Envio normal
    async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { fromName, emailDomain, to, subject, html, uuid } = req.body;

        if (!fromName || !emailDomain || !to || !subject || !html || !uuid) {
            res.status(400).json({
                success: false,
                message: 'Dados inválidos. "fromName", "emailDomain", "to", "subject", "html" e "uuid" são obrigatórios.',
            });
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
                uuid,
            });
            res.json({ success: true, status: result });
        } catch (error) {
            logger.error(`Erro ao enviar email normal:`, error);
            res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
        }
    }

    // Envio em massa
    async sendBulk(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { fromName, emailDomain, to, bcc, subject, html, uuid } = req.body;

        if (
            !fromName ||
            !emailDomain ||
            !to ||
            !bcc ||
            !Array.isArray(bcc) ||
            bcc.length === 0 ||
            !subject ||
            !html ||
            !uuid
        ) {
            res.status(400).json({
                success: false,
                message: 'Dados inválidos. "fromName", "emailDomain", "to", "bcc", "subject", "html" e "uuid" são obrigatórios.',
            });
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
                uuid,
            });
            res.json({ success: true, status: result });
        } catch (error) {
            logger.error(`Erro ao enviar emails em massa:`, error);
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
// EmailService.js
import nodemailer from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import LogParser from '../log-parser';
import { v4 as uuidv4 } from 'uuid';

interface SendEmailParams {
  fromName: string;
  emailDomain: string;
  to: string | string[];
  bcc?: string[];
  subject: string;
  html: string;
  uuid: string;
}

interface RecipientStatus {
  recipient: string;
  success: boolean;
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private pendingSends: Map<string, { uuid: string; recipients: string[]; results: RecipientStatus[]; resolve: Function; reject: Function }> = new Map();

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: '127.0.0.1',
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = new LogParser('/var/log/mail.log');
    this.logParser.startMonitoring();

    // Listen to log events
    this.logParser.on('log', this.handleLogEntry.bind(this));
  }

  private handleLogEntry(logEntry: { queueId: string; recipient: string; status: string; messageId: string; dsn: string }) {
    for (const [messageId, sendData] of this.pendingSends.entries()) {
      if (logEntry.messageId === messageId) {
        const success = logEntry.dsn.startsWith('2');

        sendData.results.push({
          recipient: logEntry.recipient,
          success,
        });

        logger.info(`Updated status for ${logEntry.recipient}: ${success ? 'Sent' : 'Failed'}`);

        if (sendData.results.length === sendData.recipients.length) {
          sendData.resolve(sendData.results);
          this.pendingSends.delete(messageId);
        }
      }
    }
  }

  async sendEmail(params: SendEmailParams): Promise<{ mailId: string; queueId: string; recipients: RecipientStatus[] }> {
    const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    const recipients: string[] = Array.isArray(to) ? [...to, ...bcc] : [to, ...bcc];

    const messageId = `${uuid}@${emailDomain}`;

    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject,
        html,
        headers: {
          'Message-ID': `<${messageId}>`,
        },
      };

      const info = await this.transporter.sendMail(mailOptions);

      logger.info(`Email sent: ${JSON.stringify(mailOptions)}`);
      logger.debug(`SMTP server response: ${info.response}`);

      const sendPromise = new Promise<RecipientStatus[]>((resolve, reject) => {
        this.pendingSends.set(messageId, {
          uuid,
          recipients,
          results: [],
          resolve,
          reject,
        });

        setTimeout(() => {
          if (this.pendingSends.has(messageId)) {
            const sendData = this.pendingSends.get(messageId)!;
            sendData.reject(new Error('Timeout ao capturar status para todos os destinatários.'));
            this.pendingSends.delete(messageId);
          }
        }, 20000); // 20 seconds
      });

      const results = await sendPromise;

      const allSuccess = results.every((r) => r.success);

      logger.info(`Send results: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`);

      return {
        mailId: uuid,
        queueId: '', // Adjust as needed
        recipients: results,
      };
    } catch (error) {
      logger.error(`Error sending email: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
      throw error;
    }
  }
}

export default new EmailService();
