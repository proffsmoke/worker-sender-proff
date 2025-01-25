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
  private mailerIdQueueMap: Map<string, Set<string>> = new Map(); // Novo mapa para mailerId
  private uuidResultsMap: Map<string, RecipientStatus[]> = new Map();
  private logGroups: Map<string, LogGroup> = new Map();

  // Adiciona dados de envio ao pendingSends
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

  // Obtém dados de envio do pendingSends
  public getPendingSend(
    queueId: string
  ): { toRecipients: string[]; bccRecipients: string[]; results: RecipientStatus[] } | undefined {
    return this.pendingSends.get(queueId);
  }

  // Remove dados de envio do pendingSends
  public deletePendingSend(queueId: string): void {
    this.pendingSends.delete(queueId);
  }


  // Verifica se um queueId já está associado a algum UUID
  public isQueueIdAssociated(queueId: string): boolean {
    for (const queueIds of this.uuidQueueMap.values()) {
      if (queueIds.has(queueId)) {
        return true;
      }
    }
    return false;
  }

  // Obtém todos os queueIds associados a um UUID
  public getQueueIdsByUuid(uuid: string): string[] | undefined {
    const queueIds = this.uuidQueueMap.get(uuid);
    return queueIds ? Array.from(queueIds) : undefined;
  }

  // Associa queueId a um mailerId
  public addQueueIdToMailerId(mailerId: string, queueId: string): void {
    if (!this.mailerIdQueueMap.has(mailerId)) {
      this.mailerIdQueueMap.set(mailerId, new Set());
    }

    const queueIds = this.mailerIdQueueMap.get(mailerId);
    if (queueIds && !queueIds.has(queueId)) {
      queueIds.add(queueId);
      logger.info(`Associado queueId ${queueId} ao mailerId ${mailerId}`);
    } else {
      logger.warn(`queueId ${queueId} já está associado ao mailerId ${mailerId}. Ignorando duplicação.`);
    }
  }

  // Consolida resultados de envio para um UUID
  public async consolidateResultsByUuid(uuid: string): Promise<RecipientStatus[] | undefined> {
    const queueIds = this.uuidQueueMap.get(uuid);
    if (!queueIds) return undefined;

    // Busca resultados do EmailLog
    const resultsFromEmailLog = await this.getResultsFromEmailLog(uuid);
    if (resultsFromEmailLog) {
      return resultsFromEmailLog;
    }

    // Caso não encontre no EmailLog, tenta buscar do pendingSends
    const allResults: RecipientStatus[] = [];
    queueIds.forEach((queueId) => {
      const sendData = this.pendingSends.get(queueId);
      if (sendData) {
        allResults.push(...sendData.results);
      }
    });

    return allResults.length > 0 ? allResults : undefined;
  }

  // Busca resultados do EmailLog para um UUID
  private async getResultsFromEmailLog(uuid: string): Promise<RecipientStatus[] | undefined> {
    try {
      const emailLogs = await EmailLog.find({ mailId: uuid });
      if (!emailLogs || emailLogs.length === 0) return undefined;

      const results: RecipientStatus[] = emailLogs.map((log) => ({
        recipient: log.email,
        success: log.success || false,
        queueId: log.queueId,
      }));

      return results;
    } catch (error) {
      logger.error(`Erro ao buscar resultados do EmailLog para UUID=${uuid}:`, error);
      return undefined;
    }
  }

  // Verifica se todos os queueIds de um UUID foram processados
  public isUuidProcessed(uuid: string): boolean {
    const queueIds = this.uuidQueueMap.get(uuid);
    if (!queueIds) return false;

    return [...queueIds].every((queueId: string) => !this.pendingSends.has(queueId));
  }

  // Atualiza o status de um queueId no EmailLog
  public async updateQueueIdStatus(queueId: string, success: boolean, mailId: string): Promise<void> {
    try {
      let emailLog = await EmailLog.findOne({ queueId });
  
      if (!emailLog) {
        const sendData = this.getPendingSend(queueId);
        if (!sendData) {
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
      logger.info(`Status do queueId=${queueId} atualizado para success=${success} com mailId=${mailId}`);
    } catch (error) {
      logger.error(`Erro ao atualizar status do queueId=${queueId}:`, error);
    }
  }

  // Adiciona uma entrada de log a um grupo de logs
  public addLogToGroup(queueId: string, logEntry: LogEntry): void {
    const logGroup = this.logGroups.get(queueId) || { queueId, logs: [] };
    logGroup.logs.push(logEntry);
    this.logGroups.set(queueId, logGroup);
  }

  // Obtém um grupo de logs por queueId
  public getLogGroup(queueId: string): LogGroup | undefined {
    return this.logGroups.get(queueId);
  }

// StateManager.ts

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