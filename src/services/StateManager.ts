import { LogEntry } from '../log-parser';
import logger from '../utils/logger';
import EmailLog from '../models/EmailLog';

interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
  queueId?: string;
}

interface LogGroup {
  queueId: string;
  logs: LogEntry[];
}

class StateManager {
  private pendingSends: Map<
    string,
    {
      toRecipients: string[];
      bccRecipients: string[];
      results: RecipientStatus[];
    }
  > = new Map();

  private uuidQueueMap: Map<string, Set<string>> = new Map();
  private uuidResultsMap: Map<string, RecipientStatus[]> = new Map();
  private logGroups: Map<string, LogGroup> = new Map();

  public addPendingSend(
    queueId: string,
    data: {
      toRecipients: string[];
      bccRecipients: string[];
      results: RecipientStatus[];
    }
  ): void {
    this.pendingSends.set(queueId, data);
    logger.info(`Dados de envio associados com sucesso para queueId=${queueId}.`);
  }

  public getPendingSend(
    queueId: string
  ): { toRecipients: string[]; bccRecipients: string[]; results: RecipientStatus[] } | undefined {
    return this.pendingSends.get(queueId);
  }

  public deletePendingSend(queueId: string): void {
    this.pendingSends.delete(queueId);
  }

  public addQueueIdToUuid(uuid: string, queueId: string): void {
    if (!this.uuidQueueMap.has(uuid)) {
      this.uuidQueueMap.set(uuid, new Set());
    }
  
    const queueIds = this.uuidQueueMap.get(uuid);
    if (queueIds && !queueIds.has(queueId)) {
      queueIds.add(queueId);
      logger.info(`Associado queueId ${queueId} ao UUID ${uuid}`);
    } else {
      logger.warn(`queueId ${queueId} já está associado ao UUID ${uuid}. Ignorando duplicação.`);
    }
  }

  public isQueueIdAssociated(queueId: string): boolean {
    for (const queueIds of this.uuidQueueMap.values()) {
      if (queueIds.has(queueId)) {
        return true;
      }
    }
    return false;
  }

  public getQueueIdsByUuid(uuid: string): string[] | undefined {
    const queueIds = this.uuidQueueMap.get(uuid);
    return queueIds ? Array.from(queueIds) : undefined;
  }

  public consolidateResultsByUuid(uuid: string): RecipientStatus[] | undefined {
    const queueIds = this.uuidQueueMap.get(uuid);
    if (!queueIds) return undefined;

    const allResults: RecipientStatus[] = [];
    queueIds.forEach((queueId) => {
      const sendData = this.pendingSends.get(queueId);
      if (sendData) {
        allResults.push(...sendData.results);
      }
    });

    return allResults;
  }

  public isUuidProcessed(uuid: string): boolean {
    const queueIds = this.uuidQueueMap.get(uuid);
    if (!queueIds) return false;

    return [...queueIds].every((queueId: string) => !this.pendingSends.has(queueId));
  }

  public async updateQueueIdStatus(queueId: string, success: boolean, mailId: string): Promise<void> {
    try {
      let emailLog = await EmailLog.findOne({ queueId });
  
      if (!emailLog) {
        const sendData = this.getPendingSend(queueId);
        if (!sendData) {
          logger.warn(`Nenhum dado encontrado no pendingSends para queueId=${queueId}`);
          return;
        }
  
        const email = sendData.toRecipients[0] || 'no-reply@unknown.com';
  
        emailLog = new EmailLog({
          mailId,
          queueId,
          email,
          success,
          updated: true,
          sentAt: new Date(),
          expireAt: new Date(Date.now() + 30 * 60 * 1000),
        });
      } else {
        emailLog.success = success;
        emailLog.updated = true;
      }
  
      await emailLog.save();
      logger.info(`Status do queueId=${queueId} atualizado para success=${success}`);
    } catch (error) {
      logger.error(`Erro ao atualizar status do queueId=${queueId}:`, error);
    }
  }

  public addLogToGroup(queueId: string, logEntry: LogEntry): void {
    const logGroup = this.logGroups.get(queueId) || { queueId, logs: [] };
    logGroup.logs.push(logEntry);
    this.logGroups.set(queueId, logGroup);
  }

  public getLogGroup(queueId: string): LogGroup | undefined {
    return this.logGroups.get(queueId);
  }

  public getUuidByQueueId(queueId: string): string | undefined {
    for (const [uuid, queueIds] of this.uuidQueueMap.entries()) {
      if (queueIds.has(queueId)) {
        return uuid;
      }
    }
    return undefined;
  }
}

export default StateManager;