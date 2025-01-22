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
import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';

// Definir e exportar a interface LogEntry
export interface LogEntry {
  queueId: string;
  recipient: string;
  status: string;
  messageId: string;
  dsn: string;
  message: string;
}

class LogParser extends EventEmitter {
  private logFilePath: string;
  private tail: Tail | null = null;
  private queueIdToMessageId: Map<string, string> = new Map();
  private startTime: Date;

  constructor(logFilePath: string = '/var/log/mail.log') {
    super();
    this.logFilePath = logFilePath;
    this.startTime = new Date();

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
    const logTimestamp = this.extractTimestamp(line);
    if (logTimestamp && logTimestamp < this.startTime) {
      return;
    }

    const smtpRegex = /postfix\/smtp\[\d+\]:\s+([A-Z0-9]+):\s+to=<([^>]+)>,.*dsn=(\d+\.\d+\.\d+),.*status=([a-z]+)/i;
    const cleanupRegex = /postfix\/cleanup\[\d+\]:\s+([A-Z0-9]+):\s+message-id=<([^>]+)>/i;

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

      const logEntry: LogEntry = {
        queueId,
        recipient,
        status,
        messageId,
        dsn,
        message: line,
      };

      logger.debug(`LogParser captured: ${JSON.stringify(logEntry)}`);

      this.emit('log', logEntry);
    }
  }

  private extractTimestamp(line: string): Date | null {
    const timestampRegex = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/;
    const match = line.match(timestampRegex);
    if (match) {
      return new Date(match[1]);
    }
    return null;
  }
}

export default LogParser;// src/config/index.ts
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
import BlockManagerService from './services/BlockManagerService'; 
import CleanlogsService from './services/CleanlogsService'; 

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
BlockManagerService;
CleanlogsService;

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
import logger from './logger'; // Certifique-se de que o logger está corretamente configurado

const randomWordsPath = path.join(__dirname, '../randomWords.json');
const sentencesPath = path.join(__dirname, '../sentences.json');
/**
 * Função genérica para carregar e parsear arquivos JSON.
 * Lança erro se o arquivo não existir, não for um array ou estiver vazio.
 */
function loadJsonFile<T>(filePath: string): T {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Arquivo não encontrado: ${filePath}`);
        }

        const data = fs.readFileSync(filePath, 'utf-8');
        const parsed: T = JSON.parse(data);

        if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error(`Arquivo ${filePath} deve conter um array não vazio.`);
        }

        logger.info(`Arquivo carregado com sucesso: ${filePath}`);
        return parsed;
    } catch (error) {
        logger.error(`Erro ao carregar ${filePath}: ${(error as Error).message}`);
        throw error; // Re-lança o erro para ser tratado externamente, se necessário
    }
}

// Carrega os dados dos arquivos JSON
let randomWords: string[] = [];
let sentencesArray: string[] = [];

try {
    randomWords = loadJsonFile<string[]>(randomWordsPath);
} catch (error) {
    logger.error(`Usando classes padrão devido ao erro: ${(error as Error).message}`);
    randomWords = ["defaultPrefix"]; // Classe padrão
}

try {
    sentencesArray = loadJsonFile<string[]>(sentencesPath);
} catch (error) {
    logger.error(`Usando frases padrão devido ao erro: ${(error as Error).message}`);
    sentencesArray = ["Default sentence."]; // Frase padrão
}

/**
 * Cria um span invisível com uma frase única e uma classe aleatória.
 * A inserção ocorre com uma probabilidade de 80%.
 */
function createInvisibleSpanWithUniqueSentence(): string {
    // Aumentar a probabilidade para 80% de inserção
    if (Math.random() > 0.2) return '';

    const sentence = sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
    const randomClass = randomWords[Math.floor(Math.random() * randomWords.length)];

    return `<span class="${randomClass}" style="visibility: hidden; position: absolute; font-size: 0;">${sentence}</span>`;
}

/**
 * Função principal de anti-spam que insere spans invisíveis no HTML fornecido.
 * @param html - Conteúdo HTML do email.
 * @returns HTML com spans de anti-spam inseridos.
 */
export default function antiSpam(html: string): string {
    if (!html) {
        throw new Error('HTML não pode ser vazio.');
    }

    const $ = cheerio.load(html);

    // Construir seletor dinâmico para classes aleatórias
    const randomClassesSelector = randomWords.map(word => `[class^="${word}"]`).join(', ');

    $('*')
        .not(`script, style, title, ${randomClassesSelector}`)
        .contents()
        .filter(function () {
            return this.type === 'text' && this.data.trim().length > 0;
        })
        .each(function () {
            const element = $(this);
            const text = element.text();

            const words = text.split(/(\s+)/).map((word) => {
                if (word.toLowerCase() === 'bradesco') {
                    // Inserir spans entre as letras de 'bradesco'
                    return word
                        .split('')
                        .map((letter) => createInvisibleSpanWithUniqueSentence() + letter)
                        .join('');
                } else {
                    // Inserir spans antes de cada palavra
                    return word
                        .split(' ')
                        .map((part) => part.trim() ? createInvisibleSpanWithUniqueSentence() + part : part)
                        .join(' ');
                }
            });

            element.replaceWith(words.join(''));
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
  detail: Record<string, any>; // Removido o '?'
  sentAt: Date;
  expireAt: Date; // Novo campo para expiração
}

const EmailLogSchema: Schema = new Schema(
  {
    mailId: { type: String, required: true, index: true },
    sendmailQueueId: { type: String, index: true },
    email: { type: String, required: true, index: true },
    message: { type: String, required: true },
    success: { type: Boolean, default: null },
    detail: { type: Schema.Types.Mixed, default: {} }, // Garante que detail nunca seja undefined
    sentAt: { type: Date, default: Date.now, index: true },
    expireAt: { type: Date, default: () => new Date(Date.now() + 30 * 60 * 1000), index: true }, // Expira em 30 minutos
  },
  {
    timestamps: true,
    collection: 'emailLogs', // Especifica explicitamente o nome da coleção
  }
);

// Criar índice TTL no campo expireAt
EmailLogSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IEmailLog>('EmailLog', EmailLogSchema);// src/models/Log.ts

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
import { Request, Response, NextFunction } from 'express';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import config from '../config';
import MailerService from '../services/MailerService'; // Import adicionado

class StatusController {
    async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            // Obter informações do MailerService
            const version = MailerService.getVersion(); // Obtém a versão do MailerService
            const createdAt = MailerService.getCreatedAt().getTime(); // Obtém o tempo de criação do MailerService
            const domain = config.mailer.noreplyEmail.split('@')[1] || 'unknown.com';
            const status = MailerService.getStatus(); // Obtém o status do MailerService
            const blockReason = MailerService.getBlockReason(); // Obtém a razão do bloqueio, se houver

            // Pipeline de agregação atualizado para separar testes e envios em massa
            const aggregationResult = await EmailLog.aggregate([
                {
                    $project: {
                        type: {
                            $cond: [
                                { $eq: [{ $size: { $objectToArray: { $ifNull: ["$detail", {}] } } }, 0] },
                                "test",
                                "mass"
                            ]
                        },
                        success: 1,
                        detail: 1
                    }
                },
                {
                    $facet: {
                        testEmails: [
                            { $match: { type: "test" } },
                            {
                                $group: {
                                    _id: null,
                                    sent: { $sum: 1 },
                                    successSent: { $sum: { $cond: ["$success", 1, 0] } },
                                    failSent: { $sum: { $cond: ["$success", 0, 1] } }
                                }
                            }
                        ],
                        massEmails: [
                            { $match: { type: "mass" } },
                            { $project: { detailArray: { $objectToArray: "$detail" } } },
                            { $unwind: "$detailArray" },
                            {
                                $group: {
                                    _id: null,
                                    sent: { $sum: 1 },
                                    successSent: { $sum: { $cond: ["$detailArray.v.success", 1, 0] } },
                                    failSent: { $sum: { $cond: ["$detailArray.v.success", 0, 1] } }
                                }
                            }
                        ]
                    }
                },
                {
                    $project: {
                        sent: {
                            $add: [
                                { $ifNull: [{ $arrayElemAt: ["$testEmails.sent", 0] }, 0] },
                                { $ifNull: [{ $arrayElemAt: ["$massEmails.sent", 0] }, 0] }
                            ]
                        },
                        successSent: {
                            $add: [
                                { $ifNull: [{ $arrayElemAt: ["$testEmails.successSent", 0] }, 0] },
                                { $ifNull: [{ $arrayElemAt: ["$massEmails.successSent", 0] }, 0] }
                            ]
                        },
                        failSent: {
                            $add: [
                                { $ifNull: [{ $arrayElemAt: ["$testEmails.failSent", 0] }, 0] },
                                { $ifNull: [{ $arrayElemAt: ["$massEmails.failSent", 0] }, 0] }
                            ]
                        }
                    }
                }
            ]);

            let sent = 0;
            let successSent = 0;
            let failSent = 0;

            if (aggregationResult.length > 0) {
                sent = aggregationResult[0].sent;
                successSent = aggregationResult[0].successSent;
                failSent = aggregationResult[0].failSent;
            }

            // Buscar os últimos 100 EmailLogs para exibição no status
            const emailLogs = await EmailLog.find()
                .sort({ sentAt: -1 })
                .limit(100)
                .lean();

            // Adicionar logs para depuração
            logger.debug(`Total emails enviados (sent): ${sent}`);
            logger.debug(`Emails enviados com sucesso (successSent): ${successSent}`);
            logger.debug(`Emails falhados (failSent): ${failSent}`);

            // Preparar a resposta JSON
            const response: any = {
                version,
                createdAt,
                sent,
                left: 0, // Se houver uma fila, ajuste este valor
                successSent,
                failSent,
                domain,
                status,
                emailLogs, // Adicionado
            };

            // Incluir a razão do bloqueio, se o Mailer estiver bloqueado
            if (status === 'blocked_permanently' || status === 'blocked_temporary') {
                response.blockReason = blockReason;
            }

            res.json(response);
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
import { v4 as uuidv4 } from 'uuid'; // Import necessário para gerar UUIDs únicos

class EmailController {
  // Envio normal permanece inalterado
  async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { fromName, emailDomain, to, subject, html, uuid } = req.body;

    if (!fromName || !emailDomain || !to || !subject || !html || !uuid) {
      res.status(400).json({
        success: false,
        message:
          'Dados inválidos. "fromName", "emailDomain", "to", "subject", "html" e "uuid" são obrigatórios.',
      });
      return;
    }

    try {
      const processedHtml = html;//antiSpam(html);
      const result = await EmailService.sendEmail({
        fromName,
        emailDomain,
        to,
        bcc: [],
        subject,
        html: processedHtml,
        uuid,
      });

      // Determina o sucesso geral baseado nos destinatários
      const overallSuccess = result.recipients.some((r) => r.success);

      res.json({
        success: overallSuccess,
        status: result,
      });
    } catch (error) {
      logger.error(`Erro ao enviar email normal:`, error);
      res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
    }
  }

  // Envio em massa modificado para enviar um email por BCC
  async sendBulk(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { fromName, emailDomain, to, bcc, subject, html } = req.body;

    // Validação dos dados de entrada
    if (
      !fromName ||
      !emailDomain ||
      !to ||
      !bcc ||
      !Array.isArray(bcc) ||
      bcc.length === 0 ||
      !subject ||
      !html
    ) {
      res.status(400).json({
        success: false,
        message:
          'Dados inválidos. "fromName", "emailDomain", "to", "bcc", "subject" e "html" são obrigatórios.',
      });
      return;
    }

    try {
      const processedHtml = html;//antiSpam(html);
      
      // Preparar um array de promessas para cada envio individual
      const sendPromises = bcc.map(async (bccEmail: string) => {
        const uuid = uuidv4(); // Gerar um UUID único para cada email
        const result = await EmailService.sendEmail({
          fromName,
          emailDomain,
          to,
          bcc: [bccEmail], // Enviar um email por BCC
          subject,
          html: processedHtml,
          uuid,
        });

        return result;
      });

      // Executar todas as promessas de envio em paralelo
      const results = await Promise.all(sendPromises);

      // Determinar o sucesso geral baseado nos resultados individuais
      const overallSuccess = results.some((result) => 
        result.recipients.some((r) => r.success)
      );

      res.json({
        success: overallSuccess,
        status: results,
      });
    } catch (error: any) {
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
import nodemailer from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser'; // Importar LogEntry
import { v4 as uuidv4 } from 'uuid';
import config from '../config';

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
  error?: string;
}

interface SendEmailResult {
  mailId: string;
  queueId: string;
  recipients: RecipientStatus[];
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private pendingSends: Map<
    string,
    {
      uuid: string;
      toRecipients: string[];
      bccRecipients: string[];
      results: RecipientStatus[];
      resolve: (value: RecipientStatus[]) => void;
      reject: (reason?: any) => void;
    }
  > = new Map();

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = new LogParser('/var/log/mail.log');
    this.logParser.startMonitoring();

    // Listen to log events
    this.logParser.on('log', this.handleLogEntry.bind(this));
  }

  private async handleLogEntry(logEntry: LogEntry) {
    logger.debug(`Processing Log Entry: ${JSON.stringify(logEntry)}`);

    const cleanMessageId = logEntry.messageId.replace(/[<>]/g, '');

    const sendData = this.pendingSends.get(cleanMessageId);
    if (!sendData) {
      logger.warn(`No pending send found for Message-ID: ${cleanMessageId}`);
      return;
    }

    const success = logEntry.dsn.startsWith('2');

    const recipient = logEntry.recipient.toLowerCase();
    const isToRecipient = sendData.toRecipients.includes(recipient);

    logger.debug(`Is to recipient: ${isToRecipient} for recipient: ${recipient}`);

    if (isToRecipient) {
      try {
        const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec();

        if (emailLog) {
          emailLog.success = success;
          await emailLog.save();
          logger.debug(`EmailLog 'success' atualizado para mailId=${sendData.uuid}`);
        } else {
          logger.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
        }
      } catch (err) {
        logger.error(
          `Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`
        );
      }

      sendData.results.push({
        recipient: recipient,
        success: success
      });
    } else {
      sendData.results.push({
        recipient: recipient,
        success,
      });

      try {
        const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec();

        if (emailLog) {
          const recipientStatus = {
            recipient: recipient,
            success,
            dsn: logEntry.dsn,
            status: logEntry.status,
          };
          emailLog.detail = {
            ...emailLog.detail,
            [recipient]: recipientStatus,
          };
          await emailLog.save();
          logger.debug(`EmailLog 'detail' atualizado para mailId=${sendData.uuid}`);
        } else {
          logger.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
        }
      } catch (err) {
        logger.error(
          `Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`
        );
      }
    }

    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length;

    logger.debug(`Total Recipients: ${totalRecipients}, Processed Recipients: ${processedRecipients}`);

    if (processedRecipients >= totalRecipients) {
      sendData.resolve(sendData.results);
      this.pendingSends.delete(cleanMessageId);
      logger.debug(`All recipients processed for mailId=${sendData.uuid}`);
    }
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    const toRecipients: string[] = Array.isArray(to) ? to.map(r => r.toLowerCase()) : [to.toLowerCase()];
    const bccRecipients: string[] = bcc.map(r => r.toLowerCase());
    const allRecipients: string[] = [...toRecipients, ...bccRecipients];

    const messageId = `${uuid}@${emailDomain}`;
    logger.debug(`Setting Message-ID: <${messageId}> for mailId=${uuid}`);

    const isTestEmail = fromName === 'Mailer Test' && subject === 'Email de Teste Inicial';

    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject,
        html,
        messageId: `<${messageId}>`,
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent: ${JSON.stringify(mailOptions)}`);
      logger.debug(`SMTP server response: ${info.response}`);

      const sendPromise = new Promise<RecipientStatus[]>((resolve, reject) => {
        this.pendingSends.set(messageId, {
          uuid,
          toRecipients,
          bccRecipients,
          results: [],
          resolve,
          reject,
        });

        setTimeout(() => {
          if (this.pendingSends.has(messageId)) {
            const sendData = this.pendingSends.get(messageId)!;
            sendData.reject(
              new Error('Timeout ao capturar status para todos os destinatários.')
            );
            this.pendingSends.delete(messageId);
            logger.warn(`Timeout: Failed to capture status for mailId=${uuid}`);
          }
        }, 10000); // 10 segundos
      });

      const results = await sendPromise;

      if (isTestEmail) {
        logger.info(`Send results for test email: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`);
      } else {
        const emailLog = new EmailLog({
          mailId: uuid,
          sendmailQueueId: '',
          email: Array.isArray(to) ? to.join(', ') : to,
          message: subject,
          success: null,
          sentAt: new Date(),
        });

        await emailLog.save();
        logger.debug(`EmailLog criado para mailId=${uuid}`);

        if (results.length > 0) {
          const emailLogUpdate = await EmailLog.findOne({ mailId: uuid }).exec();
          if (emailLogUpdate) {
            const allBccSuccess = results.every(r => r.success);
            emailLogUpdate.success = allBccSuccess;
            await emailLogUpdate.save();
            logger.debug(`EmailLog 'success' atualizado para mailId=${uuid} com valor ${allBccSuccess}`);
          }
        }

        logger.info(
          `Send results: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`
        );
      }

      return {
        mailId: uuid,
        queueId: '',
        recipients: results,
      };
    } catch (error: any) {
      logger.error(`Error sending email: ${error.message}`, error);

      let recipientsStatus: RecipientStatus[] = [];

      if (error.rejected && Array.isArray(error.rejected)) {
        const rejectedSet = new Set(error.rejected.map((r: string) => r.toLowerCase()));
        const acceptedSet = new Set((error.accepted || []).map((r: string) => r.toLowerCase()));

        recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
          recipient,
          success: acceptedSet.has(recipient),
          error: rejectedSet.has(recipient)
            ? 'Rejeitado pelo servidor SMTP.'
            : undefined,
        }));
      } else {
        recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
          recipient,
          success: false,
          error: 'Falha desconhecida ao enviar email.',
        }));
      }

      if (!isTestEmail) {
        try {
          const emailLog = await EmailLog.findOne({ mailId: uuid }).exec();

          if (emailLog) {
            const successAny = recipientsStatus.some((r) => r.success);
            emailLog.success = successAny;

            recipientsStatus.forEach((r) => {
              emailLog.detail[r.recipient] = {
                recipient: r.recipient,
                success: r.success,
                error: r.error,
                dsn: '',
                status: r.success ? 'sent' : 'failed',
              };
            });

            await emailLog.save();
            logger.debug(`EmailLog atualizado com erro para mailId=${uuid}`);
          } else {
            logger.warn(`EmailLog não encontrado para mailId=${uuid}`);
          }
        } catch (saveErr) {
          logger.error(
            `Erro ao registrar EmailLog para mailId=${uuid}: ${(saveErr as Error).message}`
          );
        }
      }

      return {
        mailId: uuid,
        queueId: '',
        recipients: recipientsStatus,
      };
    }
  }
}

export default new EmailService();// src/services/PortCheckService.ts

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
import logger from "../utils/logger";

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
  private isActive: boolean = false;

  // Método para iniciar o serviço
  start() {
    if (this.isActive) return;
    this.isActive = true;
    logger.info('BlockService iniciado.');
    // Aqui você pode adicionar a lógica para monitorar o mail.log
  }

  // Método para parar o serviço
  stop() {
    if (!this.isActive) return;
    this.isActive = false;
    logger.info('BlockService parado.');
  }

  isPermanentError(message?: string): boolean {
    if (typeof message !== 'string') return false;
    return blockedErrors.permanent.some((err) => message.includes(err));
  }

  isTemporaryError(message?: string): boolean {
    if (typeof message !== 'string') return false;
    return blockedErrors.temporary.some((err) => message.includes(err));
  }
}

export default new BlockService();
import { exec } from 'child_process';
import logger from '../utils/logger';

class CleanlogsService {
  private interval: number = 12 * 60 * 60 * 1000; // 12 horas em milissegundos

  constructor() {
    this.runCleanup();
    setInterval(() => this.runCleanup(), this.interval);
  }

  private runCleanup(): void {
    logger.info('Iniciando limpeza de logs...');

    // Comando para limpar logs do journalctl
    exec('sudo journalctl --vacuum-size=100M', (error, stdout, stderr) => {
      if (error) {
        logger.error(`Erro ao limpar logs do journalctl: ${error.message}`);
        return;
      }
      if (stderr) {
        logger.warn(`Stderr ao limpar logs do journalctl: ${stderr}`);
        return;
      }
      logger.info(`Logs do journalctl limpos: ${stdout}`);
    });

    // Comando para truncar o arquivo syslog
    exec('sudo truncate -s 0 /var/log/syslog', (error, stdout, stderr) => {
      if (error) {
        logger.error(`Erro ao truncar /var/log/syslog: ${error.message}`);
        return;
      }
      if (stderr) {
        logger.warn(`Stderr ao truncar /var/log/syslog: ${stderr}`);
        return;
      }
      logger.info(`/var/log/syslog truncado com sucesso.`);
    });

    // Comando para truncar o arquivo mail.log
    exec('sudo truncate -s 0 /var/log/mail.log', (error, stdout, stderr) => {
      if (error) {
        logger.error(`Erro ao truncar /var/log/mail.log: ${error.message}`);
        return;
      }
      if (stderr) {
        logger.warn(`Stderr ao truncar /var/log/mail.log: ${stderr}`);
        return;
      }
      logger.info(`/var/log/mail.log truncado com sucesso.`);
    });
  }
}

export default new CleanlogsService();import LogParser from '../log-parser';
import BlockService from './BlockService';
import MailerService from './MailerService';
import config from '../config';
import logger from '../utils/logger';

class BlockManagerService {
  private logParser: LogParser;
  private blockService: typeof BlockService;
  private mailerService: typeof MailerService;

  constructor() {
    this.logParser = new LogParser('/var/log/mail.log');
    this.blockService = BlockService;
    this.mailerService = MailerService;

    this.logParser.on('log', this.handleLogEntry.bind(this));
    this.logParser.startMonitoring();
  }

  private handleLogEntry(logEntry: any) {
    const { message } = logEntry;

    if (typeof message !== 'string') {
      logger.warn('Log entry missing or invalid message:', logEntry);
      return;
    }

    if (this.blockService.isPermanentError(message)) {
      this.applyBlock('permanent', message); // Passa a mensagem como razão
      logger.info(`Bloqueio permanente aplicado devido à linha de log: "${message}"`);
    } else if (this.blockService.isTemporaryError(message)) {
      this.applyBlock('temporary', message); // Passa a mensagem como razão
      logger.info(`Bloqueio temporário aplicado devido à linha de log: "${message}"`);
    }
  }

  private applyBlock(type: 'permanent' | 'temporary', reason: string) { // Adiciona o parâmetro reason
    if (type === 'permanent') {
      this.mailerService.blockMailer('blocked_permanently', reason);
    } else {
      this.mailerService.blockMailer('blocked_temporary', reason);
      // Agendar a remoção do bloqueio temporário após a duração configurada
      setTimeout(() => {
        this.checkAndUnblock();
      }, config.mailer.temporaryBlockDuration);
    }
  }

  private async checkAndUnblock() {
    try {
      const testResult = await this.mailerService.sendInitialTestEmail();
      if (testResult.success) {
        this.mailerService.unblockMailer();
        logger.info('Bloqueio temporário removido após sucesso no email de teste.');
      } else {
        logger.warn('Falha no email de teste. Bloqueio temporário permanece.');
      }
    } catch (error) {
      logger.error('Erro ao realizar o email de teste para desbloqueio:', error);
    }
  }
}

export default new BlockManagerService();
import nodemailer from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import LogParser, { LogEntry } from '../log-parser'; // Importar LogEntry
import { v4 as uuidv4 } from 'uuid';
import config from '../config';

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
  error?: string;
}

interface SendEmailResult {
  mailId: string;
  queueId: string;
  recipients: RecipientStatus[];
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private logParser: LogParser;
  private pendingSends: Map<
    string,
    {
      uuid: string;
      toRecipients: string[];
      bccRecipients: string[];
      results: RecipientStatus[];
      resolve: (value: RecipientStatus[]) => void;
      reject: (reason?: any) => void;
    }
  > = new Map();

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    this.logParser = new LogParser('/var/log/mail.log');
    this.logParser.startMonitoring();

    // Listen to log events
    this.logParser.on('log', this.handleLogEntry.bind(this));
  }

  private async handleLogEntry(logEntry: LogEntry) {
    logger.debug(`Processing Log Entry: ${JSON.stringify(logEntry)}`);

    const cleanMessageId = logEntry.messageId.replace(/[<>]/g, '');

    const sendData = this.pendingSends.get(cleanMessageId);
    if (!sendData) {
      logger.warn(`No pending send found for Message-ID: ${cleanMessageId}`);
      return;
    }

    const success = logEntry.dsn.startsWith('2');

    const recipient = logEntry.recipient.toLowerCase();
    const isToRecipient = sendData.toRecipients.includes(recipient);

    logger.debug(`Is to recipient: ${isToRecipient} for recipient: ${recipient}`);

    if (isToRecipient) {
      try {
        const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec();

        if (emailLog) {
          emailLog.success = success;
          await emailLog.save();
          logger.debug(`EmailLog 'success' atualizado para mailId=${sendData.uuid}`);
        } else {
          logger.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
        }
      } catch (err) {
        logger.error(
          `Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`
        );
      }

      sendData.results.push({
        recipient: recipient,
        success: success
      });
    } else {
      sendData.results.push({
        recipient: recipient,
        success,
      });

      try {
        const emailLog = await EmailLog.findOne({ mailId: sendData.uuid }).exec();

        if (emailLog) {
          const recipientStatus = {
            recipient: recipient,
            success,
            dsn: logEntry.dsn,
            status: logEntry.status,
          };
          emailLog.detail = {
            ...emailLog.detail,
            [recipient]: recipientStatus,
          };
          await emailLog.save();
          logger.debug(`EmailLog 'detail' atualizado para mailId=${sendData.uuid}`);
        } else {
          logger.warn(`EmailLog não encontrado para mailId=${sendData.uuid}`);
        }
      } catch (err) {
        logger.error(
          `Erro ao atualizar EmailLog para mailId=${sendData.uuid}: ${(err as Error).message}`
        );
      }
    }

    const totalRecipients = sendData.toRecipients.length + sendData.bccRecipients.length;
    const processedRecipients = sendData.results.length;

    logger.debug(`Total Recipients: ${totalRecipients}, Processed Recipients: ${processedRecipients}`);

    if (processedRecipients >= totalRecipients) {
      sendData.resolve(sendData.results);
      this.pendingSends.delete(cleanMessageId);
      logger.debug(`All recipients processed for mailId=${sendData.uuid}`);
    }
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { fromName, emailDomain, to, bcc = [], subject, html, uuid } = params;
    const from = `"${fromName}" <no-reply@${emailDomain}>`;

    const toRecipients: string[] = Array.isArray(to) ? to.map(r => r.toLowerCase()) : [to.toLowerCase()];
    const bccRecipients: string[] = bcc.map(r => r.toLowerCase());
    const allRecipients: string[] = [...toRecipients, ...bccRecipients];

    const messageId = `${uuid}@${emailDomain}`;
    logger.debug(`Setting Message-ID: <${messageId}> for mailId=${uuid}`);

    const isTestEmail = fromName === 'Mailer Test' && subject === 'Email de Teste Inicial';

    try {
      const mailOptions = {
        from,
        to: Array.isArray(to) ? to.join(', ') : to,
        bcc,
        subject,
        html,
        messageId: `<${messageId}>`,
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent: ${JSON.stringify(mailOptions)}`);
      logger.debug(`SMTP server response: ${info.response}`);

      const sendPromise = new Promise<RecipientStatus[]>((resolve, reject) => {
        this.pendingSends.set(messageId, {
          uuid,
          toRecipients,
          bccRecipients,
          results: [],
          resolve,
          reject,
        });

        setTimeout(() => {
          if (this.pendingSends.has(messageId)) {
            const sendData = this.pendingSends.get(messageId)!;
            sendData.reject(
              new Error('Timeout ao capturar status para todos os destinatários.')
            );
            this.pendingSends.delete(messageId);
            logger.warn(`Timeout: Failed to capture status for mailId=${uuid}`);
          }
        }, 10000); // 10 segundos
      });

      const results = await sendPromise;

      if (isTestEmail) {
        logger.info(`Send results for test email: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`);
      } else {
        const emailLog = new EmailLog({
          mailId: uuid,
          sendmailQueueId: '',
          email: Array.isArray(to) ? to.join(', ') : to,
          message: subject,
          success: null,
          sentAt: new Date(),
        });

        await emailLog.save();
        logger.debug(`EmailLog criado para mailId=${uuid}`);

        if (results.length > 0) {
          const emailLogUpdate = await EmailLog.findOne({ mailId: uuid }).exec();
          if (emailLogUpdate) {
            const allBccSuccess = results.every(r => r.success);
            emailLogUpdate.success = allBccSuccess;
            await emailLogUpdate.save();
            logger.debug(`EmailLog 'success' atualizado para mailId=${uuid} com valor ${allBccSuccess}`);
          }
        }

        logger.info(
          `Send results: MailID: ${uuid}, Message-ID: ${messageId}, Recipients: ${JSON.stringify(results)}`
        );
      }

      return {
        mailId: uuid,
        queueId: '',
        recipients: results,
      };
    } catch (error: any) {
      logger.error(`Error sending email: ${error.message}`, error);

      let recipientsStatus: RecipientStatus[] = [];

      if (error.rejected && Array.isArray(error.rejected)) {
        const rejectedSet = new Set(error.rejected.map((r: string) => r.toLowerCase()));
        const acceptedSet = new Set((error.accepted || []).map((r: string) => r.toLowerCase()));

        recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
          recipient,
          success: acceptedSet.has(recipient),
          error: rejectedSet.has(recipient)
            ? 'Rejeitado pelo servidor SMTP.'
            : undefined,
        }));
      } else {
        recipientsStatus = [...toRecipients, ...bccRecipients].map((recipient) => ({
          recipient,
          success: false,
          error: 'Falha desconhecida ao enviar email.',
        }));
      }

      if (!isTestEmail) {
        try {
          const emailLog = await EmailLog.findOne({ mailId: uuid }).exec();

          if (emailLog) {
            const successAny = recipientsStatus.some((r) => r.success);
            emailLog.success = successAny;

            recipientsStatus.forEach((r) => {
              emailLog.detail[r.recipient] = {
                recipient: r.recipient,
                success: r.success,
                error: r.error,
                dsn: '',
                status: r.success ? 'sent' : 'failed',
              };
            });

            await emailLog.save();
            logger.debug(`EmailLog atualizado com erro para mailId=${uuid}`);
          } else {
            logger.warn(`EmailLog não encontrado para mailId=${uuid}`);
          }
        } catch (saveErr) {
          logger.error(
            `Erro ao registrar EmailLog para mailId=${uuid}: ${(saveErr as Error).message}`
          );
        }
      }

      return {
        mailId: uuid,
        queueId: '',
        recipients: recipientsStatus,
      };
    }
  }
}

export default new EmailService();