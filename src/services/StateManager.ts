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

public async addQueueIdToUuid(uuid: string, queueId: string): Promise<void> {
  logger.info(`Tentando associar queueId=${queueId} ao UUID=${uuid}`);

  if (!this.uuidQueueMap.has(uuid)) {
    logger.info(`UUID ${uuid} não encontrado no uuidQueueMap. Criando novo Set.`);
    this.uuidQueueMap.set(uuid, new Set());
  }

  const queueIds = this.uuidQueueMap.get(uuid);
  if (queueIds && !queueIds.has(queueId)) {
    queueIds.add(queueId);
    logger.info(`Associado queueId ${queueId} ao UUID ${uuid}`);

    // Salvar a associação no EmailLog
    await this.saveQueueIdToEmailLog(queueId, uuid);
  } else {
    logger.warn(`queueId ${queueId} já está associado ao UUID ${uuid}. Ignorando duplicação.`);
  }
}

private async saveQueueIdToEmailLog(queueId: string, mailId: string): Promise<void> {
  try {
    logger.info(`Tentando salvar queueId=${queueId} e mailId=${mailId} no EmailLog.`);

    const existingLog = await EmailLog.findOne({ queueId });

    if (!existingLog) {
      const emailLog = new EmailLog({
        mailId, // UUID
        queueId,
        email: 'no-reply@unknown.com', // E-mail padrão
        success: null, // Inicialmente null
        updated: false,
        sentAt: new Date(),
        expireAt: new Date(Date.now() + 30 * 60 * 1000), // Expira em 30 minutos
      });

      await emailLog.save();
      logger.info(`Log salvo no EmailLog: queueId=${queueId}, mailId=${mailId}`);
    } else {
      logger.info(`Log já existe no EmailLog: queueId=${queueId}`);
    }
  } catch (error) {
    logger.error(`Erro ao salvar log no EmailLog:`, error);
  }
}

public getUuidByQueueId(queueId: string): string | undefined {
  logger.info(`Tentando obter UUID para queueId=${queueId}`);

  for (const [uuid, queueIds] of this.uuidQueueMap.entries()) {
    if (queueIds.has(queueId)) {
      logger.info(`UUID encontrado para queueId=${queueId}: ${uuid}`);
      return uuid;
    }
  }

  logger.warn(`UUID não encontrado para queueId=${queueId}`);
  return undefined;
}

}

export default StateManager;