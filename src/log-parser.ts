import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';
import path from 'path';
import EmailLog from './models/EmailLog';
import EmailStats from './models/EmailStats'; // Modelo para atualizar estatísticas
import StateManager from './services/StateManager';
import EmailQueueModel from './models/EmailQueueModel';

/**
 * Expressão regular simples para validar email.
 */
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface LogEntry {
  timestamp: string;
  queueId: string;
  email: string;
  result: string;
  success: boolean;
  mailId?: string;
}

class LogParser extends EventEmitter {
  private logFilePath: string;
  private tail: Tail | null = null;
  private recentLogs: LogEntry[] = [];
  private logHashes: Set<string> = new Set();
  private readonly MAX_CACHE_SIZE = 1000;
  private isMonitoringStarted: boolean = false;
  private stateManager: StateManager;

  constructor(logFilePath: string = '/var/log/mail.log') {
    super();
    this.logFilePath = logFilePath;
    this.stateManager = new StateManager();

    if (!fs.existsSync(this.logFilePath)) {
      logger.error(`Log file not found at path: ${this.logFilePath}`);
      throw new Error(`Log file not found: ${this.logFilePath}`);
    }

    this.tail = new Tail(this.logFilePath, { useWatchFile: true });
  }

  public startMonitoring(): void {
    if (this.isMonitoringStarted) {
      const stackTrace = new Error().stack;
      const callerInfo = this.getCallerInfo(stackTrace);
      logger.warn(`Monitoramento de logs já iniciado. Chamado por: ${callerInfo}`);
      return;
    }

    if (!this.tail) {
      logger.error('Attempting to monitor logs without initializing Tail.');
      return;
    }

    this.tail.on('line', this.handleLogLine.bind(this));
    this.tail.on('error', (error) => {
      logger.error('Error monitoring logs:', error);
    });

    this.isMonitoringStarted = true;
    logger.info(`Monitoring log file: ${this.logFilePath}`);
  }

  private getCallerInfo(stackTrace: string | undefined): string {
    if (!stackTrace) return 'Desconhecido';

    const stackLines = stackTrace.split('\n');
    if (stackLines.length >= 4) {
      const callerLine = stackLines[3].trim();
      const match = callerLine.match(/at (.+) \((.+):(\d+):(\d+)\)/);
      if (match) {
        const [, functionName, filePath, line, column] = match;
        const fileName = path.basename(filePath);
        return `${functionName} (${fileName}:${line}:${column})`;
      }
    }

    return 'Desconhecido';
  }

  private isValidEmail(email: string): boolean {
    return EMAIL_REGEX.test(email);
  }

  private parseLogLine(line: string): LogEntry | null {
    const match = line.match(/postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<([^>]+)>, .*, status=(\w+)/);
    if (!match) return null;

    const [, queueId, email, result] = match;

    if (!this.isValidEmail(email)) {
      logger.warn(`Email inválido detectado: ${email}`);
      return null;
    }

    const mailIdMatch = line.match(/message-id=<(.*)>/);
    const mailId = mailIdMatch ? mailIdMatch[1] : undefined;

    logger.info(`Dados extraídos do log:`);
    logger.info(`queueId: ${queueId}`);
    logger.info(`email: ${email}`);
    logger.info(`result: ${result}`);
    logger.info(`mailId: ${mailId}`);

    return {
      timestamp: new Date().toISOString(),
      queueId,
      email: email.trim(),
      result,
      success: result.startsWith('sent'),
      mailId,
    };
  }

  private async handleLogLine(line: string): Promise<void> {
    try {
      logger.info(`Processando linha do log: ${line}`);
      const logEntry = this.parseLogLine(line);
      if (logEntry) {
        const logHash = `${logEntry.timestamp}-${logEntry.queueId}-${logEntry.result}`;
        logger.info(`logEntry extraído: ${JSON.stringify(logEntry)}`);

        if (this.logHashes.has(logHash)) {
          logger.info(`Log duplicado ignorado: ${logHash}`);
          return;
        }

        // Adicionando o log ao cache, com verificações para remoção de logs antigos
        this.recentLogs.push(logEntry);
        this.logHashes.add(logHash);

        if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
          const oldestLog = this.recentLogs.shift();
          if (oldestLog) {
            const oldestHash = `${oldestLog.timestamp}-${oldestLog.queueId}-${oldestLog.result}`;
            this.logHashes.delete(oldestHash);
          }
        }

        logger.info(`Log processado e adicionado ao cache: ${JSON.stringify(logEntry)}`);
        this.emit('log', logEntry);

        // Atualizar estatísticas (sucesso ou falha)
        if (logEntry.success) {
          logger.info(`Email enviado com sucesso: ${logEntry.email}`);
          await EmailStats.incrementSuccess();
        } else {
          logger.info(`Falha no envio do email: ${logEntry.email}`);
          await EmailStats.incrementFail();
        }

        // Salvar log no banco e atualizar o modelo EmailQueue
        if (logEntry.success) {
          await this.processLogEntry(logEntry);
        } else {
          logger.info(`Log não será salvo, email com status: ${logEntry.result}`);
        }
      }
    } catch (error) {
      logger.error(`Erro ao processar a linha do log: ${line}`, error);
    }
  }

  private async processLogEntry(logEntry: LogEntry): Promise<void> {
    const { queueId, success } = logEntry;

    logger.info(`Iniciando o processamento do log: ${JSON.stringify(logEntry)}`);

    try {
      const mailId = await this.getMailIdByQueueId(queueId);
      logger.info(`mailId obtido para queueId=${queueId}: ${mailId}`);

      if (mailId) {
        // Atualizar campo de sucesso no EmailQueueModel
        await EmailQueueModel.updateOne(
          { 'queueIds.queueId': queueId },
          { $set: { 'queueIds.$.success': success } }
        );
        logger.info(`Campo success atualizado no EmailQueueModel para queueId=${queueId}: success=${success}`);

        // Salvar log no EmailLog
        await this.saveLogToEmailLog(logEntry, mailId);
      } else {
        logger.warn(`mailId não encontrado para queueId=${queueId}. Log não será salvo.`);
      }
    } catch (error) {
      logger.error(`Erro ao processar logEntry para queueId=${queueId}:`, error);
    }
  }

  private async getMailIdByQueueId(queueId: string): Promise<string | null> {
    try {
      const emailQueue = await EmailQueueModel.findOne({ 'queueIds.queueId': queueId });
      logger.info(`EmailQueue encontrado para queueId=${queueId}: ${JSON.stringify(emailQueue)}`);
      return emailQueue ? emailQueue.uuid : null;
    } catch (error) {
      logger.error(`Erro ao buscar mailId para queueId=${queueId}:`, error);
      return null;
    }
  }

  private async saveLogToEmailLog(logEntry: LogEntry, mailId: string): Promise<void> {
    const { queueId, email, success } = logEntry;

    logger.info(`Salvando log no EmailLog para queueId=${queueId}:`);
    logger.info(`email: ${email}, success: ${success}, mailId: ${mailId}`);

    try {
      const existingLog = await EmailLog.findOne({ queueId });
      if (!existingLog) {
        const emailLog = new EmailLog({
          mailId,
          queueId,
          email,
          success,
          sentAt: new Date(),
        });

        await emailLog.save();
        logger.info(`Log salvo no EmailLog: queueId=${queueId}, email=${email}, success=${success}, mailId=${mailId}`);
      } else {
        logger.info(`Log já existe no EmailLog para queueId=${queueId}`);
      }
    } catch (error) {
      logger.error(`Erro ao salvar log no EmailLog:`, error);
    }
  }

  public getRecentLogs(): LogEntry[] {
    return this.recentLogs;
  }
}

export default LogParser;
