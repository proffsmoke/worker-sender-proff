// src/middleware/auth.ts
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
  .catch((err) => {
    logger.error('Falha ao conectar ao MongoDB', err);
    process.exit(1);
  });

// Inicializar MailerService
MailerService;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', routes);

// Middleware para erro 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Rota não encontrada.' });
});

// Middleware de erro
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Erro: ${err.message}`);
  res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
});

export default app;
// src/utils/antiSpam.ts
import * as cheerio from 'cheerio'; // Ajuste de importação
import fs from 'fs';
import path from 'path';

const randomWordsPath = path.join(__dirname, 'randomWords.json');
const sentencesPath = path.join(__dirname, 'sentences.json');

const randomWords: string[] = fs.existsSync(randomWordsPath)
  ? JSON.parse(fs.readFileSync(randomWordsPath, 'utf-8'))
  : [];
const sentencesArray: string[] = fs.existsSync(sentencesPath)
  ? JSON.parse(fs.readFileSync(sentencesPath, 'utf-8'))
  : [];

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

  const $ = cheerio.load(html); // Cheerio está corretamente importado

  $('*')
    .not('script, style, title, [class^="randomClass"]')
    .contents()
    .filter(function () {
      return this.type === 'text' && this.data.trim().length > 0; // Garantir retorno boolean
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
    } catch (error: any) {
      logger.error(`Erro ao obter status: ${error.message}`, { stack: error.stack });
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
    const { to, subject, html } = req.body;

    if (!to || !subject || !html) {
      res.status(400).json({ success: false, message: 'Dados inválidos.' });
      return;
    }

    try {
      const processedHtml = antiSpam(html);
      const results = await EmailService.sendEmail(to, [], subject, processedHtml);
      res.json({ success: true, results });
    } catch (error: any) {
      logger.error(`Erro ao enviar email normal para ${to}: ${error.message}`, { subject, html, stack: error.stack });
      res.status(500).json({ success: false, message: 'Erro ao enviar email.' });
    }
  }

  // Rota para envio em massa
  async sendBulk(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { to, bcc, subject, html } = req.body;

    if (!to || !bcc || !Array.isArray(bcc) || bcc.length === 0 || !subject || !html) {
      res.status(400).json({ success: false, message: 'Dados inválidos.' });
      return;
    }

    try {
      const processedHtml = antiSpam(html);
      const results = await EmailService.sendEmail(to, bcc, subject, processedHtml);
      res.json({ success: true, results });
    } catch (error: any) {
      logger.error(`Erro ao enviar email em massa para ${to} e BCC: ${error.message}`, { bcc, subject, html, stack: error.stack });
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
import Log from '../models/Log';
import logger from '../utils/logger';
import config from '../config';
import BlockService from './BlockService';
import MailerService from './MailerService';
import { v4 as uuidv4 } from 'uuid';

class EmailService {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: '127.0.0.1', // Alterado para localhost
      port: 25, // Alterado para 25
      secure: false,
      auth: {
        user: config.auth.login,
        pass: config.auth.password,
      },
    });

    this.transporter.verify()
      .then(() => {
        logger.info('Transportador SMTP está pronto para enviar emails.');
      })
      .catch((error) => {
        logger.error('Erro ao verificar transportador SMTP:', { error });
      });
  }

  async sendEmail(
    to: string,
    bcc: string[],
    subject: string,
    html: string
  ): Promise<{ to: string; success: boolean; message: string }[]> {
    const results: { to: string; success: boolean; message: string }[] = [];
    const mailId = uuidv4();

    if (MailerService.isMailerBlocked()) {
      const message = 'Mailer está bloqueado. Não é possível enviar emails no momento.';
      logger.warn(`Tentativa de envio bloqueada para ${to}: ${message}`, { to, subject });

      await Log.create({
        to,
        bcc,
        success: false,
        message,
      });
      results.push({ to, success: false, message });

      for (const recipient of bcc) {
        await Log.create({
          to: recipient,
          bcc,
          success: false,
          message,
        });
        results.push({ to: recipient, success: false, message });
      }

      return results;
    }

    try {
      const mailOptions = {
        from: 'no-reply@yourdomain.com',
        to,
        bcc,
        subject,
        html,
        headers: { 'X-Mailer-ID': mailId },
      };

      const info = await this.transporter.sendMail(mailOptions);

      await Log.create({
        to,
        bcc,
        success: true,
        message: info.response,
      });
      results.push({ to, success: true, message: info.response });

      for (const recipient of bcc) {
        await Log.create({
          to: recipient,
          bcc,
          success: true,
          message: info.response,
        });
        results.push({ to: recipient, success: true, message: info.response });
      }

      logger.info(`Email enviado para ${to}`, { subject, html, response: info.response });
    } catch (error: any) {
      await Log.create({
        to,
        bcc,
        success: false,
        message: error.message,
      });
      results.push({ to, success: false, message: error.message });

      for (const recipient of bcc) {
        await Log.create({
          to: recipient,
          bcc,
          success: false,
          message: error.message,
        });
        results.push({ to: recipient, success: false, message: error.message });
      }

      logger.error(`Erro ao enviar email para ${to}: ${error.message}`, { subject, html, stack: error.stack });
      
      const isPermanent = BlockService.isPermanentError(error.message);
      const isTemporary = BlockService.isTemporaryError(error.message);

      if (isPermanent && !MailerService.isMailerPermanentlyBlocked()) {
        MailerService.blockMailer('blocked_permanently');
        logger.warn(`Mailer bloqueado permanentemente devido ao erro: ${error.message}`);
      } else if (isTemporary && !MailerService.isMailerBlocked()) {
        MailerService.blockMailer('blocked_temporary');
        logger.warn(`Mailer bloqueado temporariamente devido ao erro: ${error.message}`);
      }
    }

    return results;
  }

  async sendTestEmail(): Promise<boolean> {
    const testEmail = {
      from: 'no-reply@yourdomain.com',
      to: config.mailer.noreplyEmail,
      subject: 'Mailer Test',
      text: `Testing mailer.`,
    };

    try {
      await this.transporter.sendMail(testEmail);
      logger.info(`Email de teste enviado para ${config.mailer.noreplyEmail}`);
      return true;
    } catch (error: any) {
      logger.error(`Erro ao enviar email de teste: ${error.message}`, { stack: error.stack });
      return false;
    }
  }
}

export default new EmailService();
