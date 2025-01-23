import { LogEntry } from '../log-parser'; // Importa a interface LogEntry

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
  logs: LogEntry[]; // Usa a interface LogEntry
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
  private logGroups: Map<string, LogGroup> = new Map(); // Agrupa logs por messageId e queueId

  public addPendingSend(
    queueId: string,
    data: {
      toRecipients: string[];
      bccRecipients: string[];
      results: RecipientStatus[];
    }
  ): void {
    this.pendingSends.set(queueId, data);
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
    this.uuidQueueMap.get(uuid)?.push(queueId);
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
}

export default StateManager;