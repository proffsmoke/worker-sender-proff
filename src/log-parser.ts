// src/log-parser.ts

import { Tail } from 'tail';
import EmailLog, { IEmailLog } from './models/EmailLog';
import logger from './utils/logger';
import path from 'path';
import fs from 'fs';

class LogParser {
    private logFilePath: string;
    private tail: Tail;

    constructor(logFilePath: string = '/var/log/mail.log') {
        this.logFilePath = logFilePath;

        if (!fs.existsSync(this.logFilePath)) {
            logger.error(`Arquivo de log não encontrado: ${this.logFilePath}`);
            throw new Error(`Arquivo de log não encontrado: ${this.logFilePath}`);
        }

        this.tail = new Tail(this.logFilePath, { useWatchFile: true });
        this.initialize();
    }

    private initialize() {
        this.tail.on('line', this.handleLogLine.bind(this));
        this.tail.on('error', (error: Error) => {
            logger.error('Erro ao monitorar o arquivo de log:', error);
        });

        logger.info(`Iniciando LogParser para monitorar: ${this.logFilePath}`);
    }

    private async handleLogLine(line: string) {
        /**
         * [Sample of Log line]
         * Jun 23 17:00:31 edgenhacks postfix/smtp[45301]: E3E4BBE9AE: to=<***>, relay=mail.protonmail.ch[185.205.70.128]:25, delay=8.5, delays=0.05/0.02/7.2/1.3, dsn=2.0.0, status=sent (250 2.0.0 Ok: queued as 4LTRMf3Klkz9vNp1)
         */

        const regex = /postfix\/smtp\[[0-9]+\]: ([A-Z0-9]+): to=<([^>]+)>, .*, status=(\w+)(?: \((.+)\))?/;
        const match = line.match(regex);

        if (match) {
            const [, mailId, email, status, statusMessage] = match;
            const success = status === 'sent';
            let detail: Record<string, any> = {};

            if (!success && statusMessage) {
                detail = this.parseStatusMessage(statusMessage);
            }

            try {
                const logEntry: IEmailLog = new EmailLog({
                    mailId,
                    email: email.trim(),
                    message: statusMessage || status,
                    success,
                    detail,
                    sentAt: new Date(),
                });

                await logEntry.save();
                logger.debug(`Log armazenado para mailId: ${mailId}, email: ${email}, sucesso: ${success}`);
            } catch (error) {
                logger.error(`Erro ao salvar log no MongoDB para mailId: ${mailId}, email: ${email}:`, error);
            }
        }
    }

    private parseStatusMessage(message: string): Record<string, any> {
        const detail: Record<string, any> = {};

        if (message.includes('blocked')) {
            detail['reason'] = 'blocked';
        } else if (message.includes('timeout')) {
            detail['reason'] = 'timeout';
        } else if (message.includes('rejected')) {
            detail['reason'] = 'rejected';
        }

        return detail;
    }

    /**
     * Recupera os logs associados a um mailId específico.
     * @param mailId O ID único do email enviado.
     * @param timeout Tempo máximo em segundos para aguardar os logs.
     * @returns Array de logs ou null se nenhum log encontrado.
     */
    static async getResult(mailId: string, timeout: number = 50): Promise<IEmailLog[] | null> {
        for (let i = 0; i < timeout; i++) {
            await LogParser.sleep(1000);
            try {
                const logs = await EmailLog.find({ mailId }).lean<IEmailLog[]>().exec();
                if (logs.length > 0) {
                    return logs;
                }
            } catch (error) {
                logger.error(`Erro ao recuperar logs para mailId: ${mailId}:`, error);
                return null;
            }
        }
        return null;
    }

    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default LogParser;
