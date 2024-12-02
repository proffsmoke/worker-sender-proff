// src/log-parser.ts

import { Tail } from 'tail';
import EmailLog, { IEmailLog } from './models/EmailLog';
import logger from './utils/logger';
import fs from 'fs';

class LogParser {
    private logFilePath: string;
    private tail: Tail;
  
    constructor(logFilePath: string = '/var/log/mail.log') {
      this.logFilePath = logFilePath;
  
      if (!fs.existsSync(this.logFilePath)) {
        throw new Error(`Arquivo de log não encontrado: ${this.logFilePath}`);
      }
  
      this.tail = new Tail(this.logFilePath, { useWatchFile: true });
    }
  
    startMonitoring() {
      this.tail.on('line', this.handleLogLine.bind(this));
      this.tail.on('error', (error) => {
        logger.error('Erro ao monitorar os logs:', error);
      });
  
      logger.info(`Monitorando o arquivo de log: ${this.logFilePath}`);
    }
  
    private async handleLogLine(line: string) {
      // Regex para capturar Queue ID e status
      const regex = /(?:sendmail|sm-mta)\[\d+\]: ([A-Za-z0-9]+): .*stat=(\w+)/;
      const match = line.match(regex);
  
      if (match) {
        const [_, queueId, status] = match;
  
        try {
          const emailLog = await EmailLog.findOne({
            $or: [
              { 'detail.queueId': queueId },
              { mailId: queueId }, // Fallback para UUID
            ],
          });
  
          if (emailLog) {
            emailLog.success = status === 'Sent';
            emailLog.message = `Status atualizado: ${status}`;
            await emailLog.save();
  
            logger.info(`Log atualizado: Queue ID ${queueId}, Status: ${status}`);
          } else {
            logger.warn(`Nenhum log encontrado para Queue ID ${queueId}`);
          }
        } catch (error) {
          logger.error(`Erro ao atualizar log para Queue ID ${queueId}:`, error);
        }
      }
    }
  }
  
  export default LogParser;
  