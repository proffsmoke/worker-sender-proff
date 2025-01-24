import { LogEntry } from '../log-parser';
import logger from '../utils/logger';
import EmailLog from '../models/EmailLog'; // Importe o modelo de EmailLog

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

  private uuidQueueMap: Map<string, Set<string>> = new Map(); // Mapeia UUID para queueIds (evita duplicação com Set)
  private uuidResultsMap: Map<string, RecipientStatus[]> = new Map(); // Mapeia UUID para resultados
  private logGroups: Map<string, LogGroup> = new Map(); // Agrupa logs por queueId

  // Adiciona um envio pendente
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

  // Obtém um envio pendente pelo queueId
  public getPendingSend(
    queueId: string
  ): { toRecipients: string[]; bccRecipients: string[]; results: RecipientStatus[] } | undefined {
    return this.pendingSends.get(queueId);
  }

  // Remove um envio pendente
  public deletePendingSend(queueId: string): void {
    this.pendingSends.delete(queueId);
  }

  // Adiciona um queueId ao UUID (Evita duplicação usando Set)
  public addQueueIdToUuid(uuid: string, queueId: string): void {
    if (!this.uuidQueueMap.has(uuid)) {
      this.uuidQueueMap.set(uuid, new Set());
    }
  
    const queueIds = this.uuidQueueMap.get(uuid);
    if (queueIds && !queueIds.has(queueId)) {
      queueIds.add(queueId);
      logger.info(`Associado queueId ${queueId} ao UUID ${uuid}`);
    } else {
      logger.info(`queueId ${queueId} já está associado ao UUID ${uuid}, não será associado novamente.`);
    }
  }

  // Obtém todos os queueIds associados a um UUID
  public getQueueIdsByUuid(uuid: string): string[] | undefined {
    const queueIds = this.uuidQueueMap.get(uuid);
    return queueIds ? Array.from(queueIds) : undefined;
  }

  // Consolida resultados associados a um UUID
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

  // Verifica se um UUID foi completamente processado
  public isUuidProcessed(uuid: string): boolean {
    const queueIds = this.uuidQueueMap.get(uuid);
    if (!queueIds) return false;

    // Convertendo o Set para Array e usando every para verificar todos os queueIds
    return [...queueIds].every((queueId: string) => !this.pendingSends.has(queueId));
  }

  // Atualiza o status de um queueId com base no log
  public async updateQueueIdStatus(queueId: string, success: boolean): Promise<void> {
    try {
      let emailLog = await EmailLog.findOne({ queueId }); // Buscando pelo queueId
  
      if (!emailLog) {
        // Se o EmailLog não existir, cria um novo
        emailLog = new EmailLog({
          queueId,
          success,
          updated: true,
          timestamp: new Date(),
        });
      } else {
        // Se existir, atualiza o status
        emailLog.success = success;
        emailLog.updated = true;
      }
  
      await emailLog.save();
      logger.info(`Status do queueId=${queueId} atualizado para success=${success}`);
    } catch (error) {
      logger.error(`Erro ao atualizar status do queueId=${queueId}:`, error);
    }
  }

  // Adiciona um log a um grupo de logs
  public addLogToGroup(queueId: string, logEntry: LogEntry): void {
    const logGroup = this.logGroups.get(queueId) || { queueId, logs: [] };
    logGroup.logs.push(logEntry);
    this.logGroups.set(queueId, logGroup);
  }

  // Obtém um grupo de logs pelo queueId
  public getLogGroup(queueId: string): LogGroup | undefined {
    return this.logGroups.get(queueId);
  }

  // Obtém o UUID associado a um queueId
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
