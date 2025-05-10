import { Tail } from 'tail';
import logger from './utils/logger';
import fs from 'fs';
import EventEmitter from 'events';
import EmailLog from './models/EmailLog';
import EmailStats from './models/EmailStats';
import EmailRetryStatus from './models/EmailRetryStatus';

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

  private parseLogLine(line: string): LogEntry | null {
    // Extrai informações completas do log
    const queueMatch = line.match(/postfix\/smtp\[\d+\]: (\w+): .* status=\w+ \((.*)\)/);
    const emailMatch = line.match(/to=<([^>]+)>/);
    const messageIdMatch = line.match(/message-id=<([^>]+)>/);

    if (!queueMatch) return null;

    const [, queueId, errorDetails] = queueMatch;
    const email = emailMatch ? emailMatch[1] : 'unknown';
    const mailId = messageIdMatch ? messageIdMatch[1] : undefined;

    return {
      timestamp: new Date().toISOString(),
      queueId,
      email,
      result: errorDetails,
      success: line.includes('status=sent'),
      mailId,
    };
  }

  private async handleLogLine(line: string): Promise<void> {
    try {
      logger.info(`Processing log line: ${line}`);
      const logEntry = this.parseLogLine(line);
      if (!logEntry) return;

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
