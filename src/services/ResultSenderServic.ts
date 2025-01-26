import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';
import axios from 'axios';

// Interfaces
interface QueueItem {
  queueId: string;
  email: string;
  success: boolean | null;
}

interface EmailQueue {
  uuid: string;
  queueIds: QueueItem[];
  resultSent: boolean;
}

interface ResultItem {
  queueId: string;
  email: string;
  success: boolean;
}

// Payload Builder
class PayloadBuilder {
  private uuid: string;
  private results: ResultItem[];

  constructor(uuid: string) {
    this.uuid = uuid;
    this.results = [];
  }

  addResult(queueId: string, email: string, success: boolean): PayloadBuilder {
    this.results.push({ queueId, email, success });
    return this;
  }

  build(): { uuid: string; results: ResultItem[] } {
    return { uuid: this.uuid, results: this.results };
  }
}

// Command Pattern: Define a Command Interface
interface Command {
  execute(): Promise<void>;
}

// SendResultsCommand: Implements Command
class SendResultsCommand implements Command {
  private emailQueue: EmailQueue;

  constructor(emailQueue: EmailQueue) {
    this.emailQueue = emailQueue;
  }

  async execute(): Promise<void> {
    const { uuid, queueIds } = this.emailQueue;

    // Filtrar resultados válidos
    const filteredQueueIds = queueIds.filter((q) => q.success !== null);
    if (filteredQueueIds.length === 0) {
      logger.warn(`Nenhum resultado válido encontrado para enviar: uuid=${uuid}`);
      return;
    }

    // Construir Payload
    const builder = new PayloadBuilder(uuid);
    filteredQueueIds.forEach((q) =>
      builder.addResult(q.queueId, q.email, q.success!)
    );
    const payload = builder.build();

    logger.info(
      `Preparando para enviar resultados: uuid=${uuid}, total=${payload.results.length}`
    );

    // Enviar resultados
    try {
      const response = await axios.post(
        'http://localhost:4008/api/results',
        payload
      );
      if (response.status === 200) {
        logger.info(`Resultados enviados com sucesso: uuid=${uuid}`);
        // Atualizar o banco de dados
        await EmailQueueModel.updateOne({ uuid }, { $set: { resultSent: true } });
        logger.info(`Resultados marcados como enviados: uuid=${uuid}`);
      } else {
        logger.error(
          `Falha ao enviar resultados: uuid=${uuid}, status=${response.status}`
        );
      }
    } catch (error) {
      logger.error(`Erro ao enviar resultados: uuid=${uuid}`, error);
    }
  }
}

// Command Manager
class CommandManager {
  private commands: Command[] = [];

  addCommand(command: Command): void {
    this.commands.push(command);
  }

  async executeCommands(): Promise<void> {
    for (const command of this.commands) {
      await command.execute();
    }
    this.commands = [];
  }
}

// ResultSenderService: Orquestra tudo
class ResultSenderService {
  private interval: NodeJS.Timeout | null = null;
  private isSending: boolean = false;
  private commandManager: CommandManager = new CommandManager();

  public start(): void {
    if (this.interval) {
      logger.warn('O serviço ResultSenderService já está em execução.');
      return;
    }

    this.interval = setInterval(() => this.processResults(), 10000);
    logger.info('ResultSenderService iniciado.');
  }

  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('ResultSenderService parado.');
    }
  }

  private async processResults(): Promise<void> {
    if (this.isSending) {
      logger.info('Já está processando resultados. Aguardando...');
      return;
    }

    this.isSending = true;

    try {
      // Buscar registros no banco de dados
      const emailQueues = await EmailQueueModel.find({
        'queueIds.success': { $exists: true, $ne: null },
        resultSent: false,
      });

      logger.info(`Encontrados ${emailQueues.length} registros para processar.`);

      // Criar e adicionar comandos para cada registro
      for (const emailQueue of emailQueues) {
        this.commandManager.addCommand(new SendResultsCommand(emailQueue));
      }

      // Executar comandos
      await this.commandManager.executeCommands();
    } catch (error) {
      logger.error('Erro ao processar resultados:', error);
    } finally {
      this.isSending = false;
    }
  }
}

export default ResultSenderService;
