import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';
import EmailLog from './models/EmailLog';
import EmailStats from './models/EmailStats';
import EmailRetryStatus from './models/EmailRetryStatus';
import {
  DeliveryParseResult,
  QueueMapping,
  normalizeMailId,
  parseDeliveryLine,
  parseQueueMappingLine,
} from './log-parser-utils';

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
  private isMonitoringStarted = false;
  private queueIdByMailId: Map<string, string> = new Map();
  private mailIdByQueueId: Map<string, string> = new Map();
  private pendingEntriesByQueueId: Map<string, LogEntry> = new Map();

  constructor(logFilePath: string = '/var/log/mail.log') {
    super();
    this.logFilePath = logFilePath;

    // Tenta inicializar o tail com até 50 tentativas
    this.initTail();
  }

  /**
   * Tenta criar o Tail no arquivo de log, repetindo até 50x se o arquivo não existir ainda.
   * Cada falha aguarda 2s antes de nova tentativa.
   */
  private initTail(retryCount = 0): void {
    if (!fs.existsSync(this.logFilePath)) {
      logger.error(
        `Log file not found at path: ${this.logFilePath}. Tentativa ${retryCount + 1}/50`
      );
      if (retryCount < 50) {
        setTimeout(() => this.initTail(retryCount + 1), 2000);
      } else {
        throw new Error(`Log file not found após 50 tentativas: ${this.logFilePath}`);
      }
      return;
    }

    // Se achou o arquivo, inicializa o tail normalmente
    this.tail = new Tail(this.logFilePath, { useWatchFile: true });
  }

  public startMonitoring(): void {
    if (this.isMonitoringStarted) {
      logger.warn('Log monitoring already started.');
      return;
    }

    if (!this.tail) {
      logger.error('Tail not initialized (log file ainda não encontrado).');
      return;
    }

    this.tail.on('line', this.handleLogLine.bind(this));
    this.tail.on('error', (error) => {
      logger.error('Error monitoring logs:', error);
    });

    this.isMonitoringStarted = true;
    logger.info(`Monitoring started for log file: ${this.logFilePath}`);
  }

  public getQueueIdByMailId(mailId: string): string | undefined {
    return this.queueIdByMailId.get(normalizeMailId(mailId));
  }

  public getMailIdByQueueId(queueId: string): string | undefined {
    return this.mailIdByQueueId.get(queueId.toUpperCase());
  }

  private handleQueueMapping(mapping: QueueMapping): void {
    const normalizedQueueId = mapping.queueId.toUpperCase();
    const normalizedMailId = normalizeMailId(mapping.mailId);

    const existingQueueId = this.queueIdByMailId.get(normalizedMailId);
    if (existingQueueId && existingQueueId !== normalizedQueueId) {
      logger.warn(
        `MailId ${normalizedMailId} já estava associado a queueId=${existingQueueId}. ` +
        `Novo queueId=${normalizedQueueId} será mantido para consistência.`
      );
    }

    this.queueIdByMailId.set(normalizedMailId, normalizedQueueId);
    this.mailIdByQueueId.set(normalizedQueueId, normalizedMailId);
    this.emit('queueIdResolved', { queueId: normalizedQueueId, mailId: normalizedMailId });

    const pendingEntry = this.pendingEntriesByQueueId.get(normalizedQueueId);
    if (pendingEntry) {
      pendingEntry.mailId = normalizedMailId;
      this.pendingEntriesByQueueId.delete(normalizedQueueId);
      void this.handleParsedLogEntry(pendingEntry).catch((error) => {
        logger.error(`Erro ao processar log pendente para queueId=${normalizedQueueId}`, error);
      });
    }
  }

  private async handleParsedLogEntry(logEntry: LogEntry): Promise<void> {
    const logHash = `${logEntry.queueId}-${logEntry.result}`;
    if (this.logHashes.has(logHash)) {
      logger.info(`Duplicate log ignored: ${logHash}`);
      return;
    }

    this.recentLogs.push(logEntry);
    this.logHashes.add(logHash);

    if (this.recentLogs.length > this.MAX_CACHE_SIZE) {
      const oldestLog = this.recentLogs.shift();
      if (oldestLog) {
        this.logHashes.delete(`${oldestLog.queueId}-${oldestLog.result}`);
      }
    }

    logger.info(`Parsed log entry: ${JSON.stringify(logEntry)}`);
    await this.processLogEntry(logEntry);

    // Emite o log para o EmailService (via evento 'log')
    this.emit('log', logEntry);
  }

  private buildLogEntry(delivery: DeliveryParseResult): LogEntry {
    const mailId = delivery.mailId
      ? normalizeMailId(delivery.mailId)
      : this.mailIdByQueueId.get(delivery.queueId.toUpperCase());

    return {
      timestamp: new Date().toISOString(),
      queueId: delivery.queueId.toUpperCase(),
      email: delivery.email || 'unknown',
      result: delivery.detail,
      success: delivery.status === 'sent',
      mailId,
    };
  }

  private async handleLogLine(line: string): Promise<void> {
    try {
      logger.info(`Processing log line: ${line}`);
      const mapping = parseQueueMappingLine(line);
      if (mapping) {
        this.handleQueueMapping(mapping);
      }

      const delivery = parseDeliveryLine(line);
      if (!delivery) {
        return;
      }

      if (delivery.mailId) {
        const normalizedMailId = normalizeMailId(delivery.mailId);
        if (!this.queueIdByMailId.has(normalizedMailId)) {
          this.queueIdByMailId.set(normalizedMailId, delivery.queueId.toUpperCase());
          this.mailIdByQueueId.set(delivery.queueId.toUpperCase(), normalizedMailId);
          this.emit('queueIdResolved', {
            queueId: delivery.queueId.toUpperCase(),
            mailId: normalizedMailId,
          });
        }
      }

      const logEntry = this.buildLogEntry(delivery);
      if (!logEntry.mailId) {
        logger.warn(`MailId não encontrado para queueId=${logEntry.queueId}. Guardando log pendente.`);
        this.pendingEntriesByQueueId.set(logEntry.queueId, logEntry);
        return;
      }

      await this.handleParsedLogEntry(logEntry);
    } catch (error) {
      logger.error(`Error processing log line: ${line}`, error);
    }
  }

  private async processLogEntry(logEntry: LogEntry): Promise<void> {
    try {
      const { queueId, success, mailId, email, result } = logEntry;

      // Incrementa as estatísticas de envio
      await EmailStats.incrementSent();
      if (success) {
        await EmailStats.incrementSuccess();
      } else {
        await EmailStats.incrementFail();
      }

      // Prepara o objeto de atualização para EmailLog
      const updateData: any = {
        success,
        email,
        mailId, // Atualiza o mailId se houver
        sentAt: new Date(),
      };

      if (!success && result) {
        updateData.errorMessage = result; // Adiciona a mensagem de erro
      }

      // Atualiza ou cria o registro de log no EmailLog com base no queueId
      await EmailLog.findOneAndUpdate(
        { queueId },
        { $set: updateData }, // Usa o objeto updateData
        { upsert: true, new: true }
      );
      logger.info(
        `Log atualizado/upserted para queueId=${queueId} com success=${success}` +
        `${!success && result ? ` error: ${result}` : ''}` // Log opcional do erro
      );

      // Lógica de Retry e Falha Permanente
      if (!success && email && email !== 'unknown') {
        try {
          const emailAddress = email.toLowerCase(); // Usar e-mail em minúsculas para consistência
          const updatedRetryStatus = await EmailRetryStatus.findOneAndUpdate(
            { email: emailAddress },
            {
              $inc: { failureCount: 1 },
              $set: { lastAttemptAt: new Date() },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );

          logger.info(`Status de tentativa atualizado para ${emailAddress}: falhas ${updatedRetryStatus.failureCount}`);

          if (updatedRetryStatus.failureCount >= 10 && !updatedRetryStatus.isPermanentlyFailed) {
            await EmailRetryStatus.updateOne(
              { email: emailAddress }, // Condição para encontrar o documento
              {
                $set: {
                  isPermanentlyFailed: true,
                  lastError: result, // Salva a última mensagem de erro que causou o bloqueio
                },
              }
            );
            logger.warn(`E-mail ${emailAddress} marcado como FALHA PERMANENTE após ${updatedRetryStatus.failureCount} tentativas. Último erro: ${result}`);
          }
        } catch (retryError) {
          logger.error(`Erro ao atualizar EmailRetryStatus para ${email}:`, retryError);
        }
      }

      if (mailId) {
        this.emit('testEmailLog', { mailId, success });
      }
    } catch (error) {
      logger.error(`Error processing log entry: ${JSON.stringify(logEntry)}`, error);
    }
  }

  public getRecentLogs(): LogEntry[] {
    return this.recentLogs;
  }
}

export default LogParser;
