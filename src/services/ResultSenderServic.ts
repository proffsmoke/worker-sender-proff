import axios, { AxiosInstance, AxiosError } from 'axios';
import { z, ZodError } from 'zod';
import EmailQueueModel from '../models/EmailQueueModel';
import logger from '../utils/logger';

// Interfaces e tipos
type QueueStatus = 'pending' | 'success' | 'failed';

interface QueueItem {
  queueId: string;
  email: string;
  status: QueueStatus;
  data?: unknown;
  lastAttempt?: Date;
}

interface EmailQueue {
  uuid: string;
  queueIds: QueueItem[];
  resultSent: boolean;
  retryCount?: number;
  lastError?: string;
}

interface ResultItem {
  queueId: string;
  email: string;
  success: boolean;
  data?: unknown;
}

// Esquemas de validação
const ResultItemSchema = z.object({
  queueId: z.string().uuid(),
  email: z.string().email(),
  success: z.boolean(),
  data: z.unknown().optional(),
});

const PayloadSchema = z.object({
  fullPayload: z.object({
    uuid: z.string().uuid(),
    results: z.array(ResultItemSchema),
  }),
});

type ValidatedPayload = z.infer<typeof PayloadSchema>;

// Configurações
const DOMAINS = ['http://localhost:4008'];
const MAX_RETRIES = 3;
const LOG_TRUNCATE_LIMIT = 500;

class DomainStrategy {
  private domains: string[];
  private currentIndex: number;

  constructor(domains: string[]) {
    this.domains = domains;
    this.currentIndex = 0;
    logger.debug(`DomainStrategy initialized with ${domains.length} domains`);
  }

  public getNextDomain(): string {
    const domain = this.domains[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.domains.length;
    logger.debug(`Selected next domain: ${domain}`);
    return domain;
  }
}

export class ResultSenderService {
  private interval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private domainStrategy: DomainStrategy;
  private axiosInstance: AxiosInstance;

  constructor() {
    this.domainStrategy = new DomainStrategy(DOMAINS);
    this.axiosInstance = this.createAxiosInstance();
    logger.info('ResultSenderService instance created');
  }

  private createAxiosInstance(): AxiosInstance {
    logger.debug('Creating axios instance with timeout: 8000ms');
    return axios.create({
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Name': 'ResultSenderService',
      },
    });
  }

  public start(intervalMs: number = 10000): void {
    if (this.interval) {
      logger.warn('Service already running. Start request ignored');
      return;
    }

    logger.info(`Starting service with interval: ${intervalMs}ms`);
    this.interval = setInterval(() => this.processResults(), intervalMs);
  }

  public stop(): void {
    if (this.interval) {
      logger.info('Stopping service');
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async processResults(): Promise<void> {
    if (this.isProcessing) {
      logger.warn('Processing already in progress. Skipping this cycle');
      return;
    }

    this.isProcessing = true;
    logger.info('Starting processing cycle');

    try {
      const pendingQueues = await this.fetchPendingQueues();
      logger.info(`Found ${pendingQueues.length} queues to process`);

      const aggregatedResults = this.aggregateResults(pendingQueues);
      logger.debug(`Aggregated ${Object.keys(aggregatedResults).length} UUID groups`);

      await this.processAggregatedResults(aggregatedResults);
    } catch (error) {
      this.handleProcessingError(error);
    } finally {
      this.isProcessing = false;
      logger.info('Processing cycle completed');
    }
  }

  private async fetchPendingQueues(): Promise<EmailQueue[]> {
    logger.debug('Querying database for pending queues');
    try {
      return await EmailQueueModel.find({
        'queueIds.status': { $in: ['success', 'failed'] },
        resultSent: false,
        $or: [
          { retryCount: { $exists: false } },
          { retryCount: { $lt: MAX_RETRIES } }
        ]
      });
    } catch (error) {
      logger.error('Database query failed', this.formatError(error));
      throw error;
    }
  }

  private aggregateResults(queues: EmailQueue[]): Record<string, ResultItem[]> {
    logger.debug('Aggregating results by UUID');
    return queues.reduce((acc, queue) => {
      const results = queue.queueIds
        .filter(item => item.status !== 'pending')
        .map(item => ({
          queueId: item.queueId,
          email: item.email,
          success: item.status === 'success',
          data: item.data
        }));

      if (results.length > 0) {
        acc[queue.uuid] = [...(acc[queue.uuid] || []), ...results];
      }
      return acc;
    }, {} as Record<string, ResultItem[]>);
  }

  private async processAggregatedResults(resultsByUuid: Record<string, ResultItem[]>): Promise<void> {
    for (const [uuid, results] of Object.entries(resultsByUuid)) {
      try {
        logger.info(`Processing UUID: ${uuid} with ${results.length} results`);
        await this.validateAndSendResults(uuid, results);
      } catch (error) {
        logger.error(`Failed to process UUID: ${uuid}`, this.formatError(error));
      }
    }
  }

  private async validateAndSendResults(uuid: string, results: ResultItem[]): Promise<void> {
    let payload: ValidatedPayload;
    
    try {
      payload = this.buildAndValidatePayload(uuid, results);
    } catch (error) {
      await this.handleValidationError(uuid, error);
      return;
    }

    try {
      await this.sendPayload(payload);
      await this.markQueueAsSent(uuid);
      logger.info(`Successfully processed UUID: ${uuid}`);
    } catch (error) {
      await this.handleSendError(uuid, error);
    }
  }

  private buildAndValidatePayload(uuid: string, results: ResultItem[]): ValidatedPayload {
    logger.debug(`Building payload for UUID: ${uuid}`);
    const rawPayload = {
      fullPayload: {
        uuid,
        results: results.map(r => ({
          queueId: r.queueId,
          email: r.email,
          success: r.success,
          data: r.data
        }))
      }
    };

    logger.debug('Raw payload constructed', { 
      uuid,
      payloadSample: this.truncateForLog(rawPayload)
    });

    const validationResult = PayloadSchema.safeParse(rawPayload);
    
    if (!validationResult.success) {
      logger.error('Payload validation failed', {
        uuid,
        errors: validationResult.error.errors
      });
      throw new Error('Invalid payload structure');
    }

    logger.debug('Payload validated successfully', {
      uuid,
      resultsCount: validationResult.data.fullPayload.results.length
    });

    return validationResult.data;
  }

  private async sendPayload(payload: ValidatedPayload): Promise<void> {
    const domain = this.domainStrategy.getNextDomain();
    const url = `${domain}/api/results`;
    
    logger.info(`Attempting to send to: ${url}`, {
      endpoint: url,
      payloadUUID: payload.fullPayload.uuid
    });

    try {
      const response = await this.axiosInstance.post(url, payload);
      logger.debug('API response received', {
        status: response.status,
        data: this.truncateForLog(response.data)
      });

      if (response.status !== 200) {
        throw new Error(`Unexpected status code: ${response.status}`);
      }
    } catch (error) {
      logger.error('API request failed', {
        url,
        error: this.formatError(error)
      });
      throw error;
    }
  }

  private async markQueueAsSent(uuid: string): Promise<void> {
    logger.debug(`Marking UUID as sent: ${uuid}`);
    await EmailQueueModel.updateMany(
      { uuid },
      {
        $set: {
          resultSent: true,
          lastUpdated: new Date(),
          status: 'completed'
        },
        $unset: {
          lastError: 1,
          errorDetails: 1
        }
      }
    );
  }

  private async handleValidationError(uuid: string, error: unknown): Promise<void> {
    const errorDetails = this.formatError(error);
    logger.error(`Validation failed for UUID: ${uuid}`, errorDetails);

    await EmailQueueModel.updateMany(
      { uuid },
      {
        $set: {
          lastError: 'Payload validation failed',
          errorDetails: this.truncateError(errorDetails),
          lastUpdated: new Date()
        },
        $inc: { retryCount: 1 }
      }
    );
  }

  private async handleSendError(uuid: string, error: unknown): Promise<void> {
    const errorDetails = this.formatError(error);
    logger.error(`Send failed for UUID: ${uuid}`, errorDetails);

    await EmailQueueModel.updateMany(
      { uuid },
      {
        $set: {
          lastError: this.truncateError(errorDetails.message),
          errorDetails: this.truncateError(errorDetails),
          lastUpdated: new Date()
        },
        $inc: { retryCount: 1 }
      }
    );
  }

  private handleProcessingError(error: unknown): void {
    const errorDetails = this.formatError(error);
    logger.error('Critical processing error:', {
      message: errorDetails.message,
      stack: errorDetails.stack,
      additionalInfo: 'Global processing failure'
    });
  }

  private formatError(error: unknown): { 
    message: string; 
    stack?: string; 
    isAxiosError?: boolean;
    statusCode?: number;
  } {
    if (error instanceof ZodError) {
      return {
        message: 'Validation error',
        stack: JSON.stringify(error.errors)
      };
    }

    if (axios.isAxiosError(error)) {
      return {
        message: error.message,
        stack: error.stack,
        isAxiosError: true,
        statusCode: error.response?.status
      };
    }

    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack
      };
    }

    return {
      message: 'Unknown error type occurred'
    };
  }

  private truncateForLog(data: unknown): string {
    const str = JSON.stringify(data);
    return str.length > LOG_TRUNCATE_LIMIT 
      ? str.substring(0, LOG_TRUNCATE_LIMIT) + '... [TRUNCATED]' 
      : str;
  }

  private truncateError(error: any): string {
    return JSON.stringify(error).substring(0, 1000);
  }
}

export default ResultSenderService;