import { LogEntry } from '../log-parser';
import logger from '../utils/logger';

interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
  queueId?: string;
  mailId?: string;
}

interface LogGroup {
  queueId: string;
  mailId: string;
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

  private uuidQueueMap: Map<string, string[]> = new Map();
  private uuidResultsMap: Map<string, RecipientStatus[]> = new Map();
  private logGroups: Map<string, LogGroup> = new Map();
  private mailIdQueueMap: Map<string, string[]> = new Map();

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
      this.uuidQueueMap.set(uuid, []);
    }
  
    // Verifique se o queueId já está associado ao uuid
    if (!this.uuidQueueMap.get(uuid)?.includes(queueId)) {
      this.uuidQueueMap.get(uuid)?.push(queueId);
      logger.info(`Associado queueId ${queueId} ao uuid ${uuid}`);
    } else {
      logger.info(`queueId ${queueId} já está associado ao uuid ${uuid}, não será associado novamente.`);
    }
  }
  

  public getQueueIdsByUuid(uuid: string): string[] | undefined {
    return this.uuidQueueMap.get(uuid);
  }

  public getUuidQueueMap(): Map<string, string[]> {
    return this.uuidQueueMap;
  }

  public addResultsToUuid(uuid: string, results: RecipientStatus[]): void {
    this.uuidResultsMap.set(uuid, results);
  }

  public getResultsByUuid(uuid: string): RecipientStatus[] | undefined {
    return this.uuidResultsMap.get(uuid);
  }

  public deleteResultsByUuid(uuid: string): void {
    this.uuidResultsMap.delete(uuid);
  }

  public addLogToGroup(queueId: string, logEntry: LogEntry): void {
    const mailId = logEntry.mailId || 'unknown';
    const logGroup = this.logGroups.get(mailId) || { queueId, mailId, logs: [] };
    logGroup.logs.push(logEntry);
    this.logGroups.set(mailId, logGroup);
  }

  public getLogGroup(mailId: string): LogGroup | undefined {
    return this.logGroups.get(mailId);
  }

  public addQueueIdToMailId(mailId: string, queueId: string): void {
    if (!this.mailIdQueueMap.has(mailId)) {
      this.mailIdQueueMap.set(mailId, []);
    }
    this.mailIdQueueMap.get(mailId)?.push(queueId);
    logger.info(`Associado queueId ${queueId} ao mailId ${mailId}`);
  }

  public getQueueIdsByMailId(mailId: string): string[] | undefined {
    return this.mailIdQueueMap.get(mailId);
  }

  public isMailIdProcessed(mailId: string): boolean {
    const queueIds = this.mailIdQueueMap.get(mailId);
    if (!queueIds) return false;

    return queueIds.every((queueId) => !this.pendingSends.has(queueId));
  }

  public getResultsByMailId(mailId: string): RecipientStatus[] | undefined {
    const queueIds = this.mailIdQueueMap.get(mailId);
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

    return queueIds.every((queueId) => !this.pendingSends.has(queueId));
  }

  public getUuidByQueueId(queueId: string): string | undefined {
    for (const [uuid, queueIds] of this.uuidQueueMap.entries()) {
      if (queueIds.includes(queueId)) {
        return uuid;
      }
    }
    return undefined;
  }
}

export default StateManager;