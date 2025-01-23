interface RecipientStatus {
  recipient: string;
  success: boolean;
  error?: string;
  queueId?: string;
  mailId?: string;
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
}

export default StateManager;