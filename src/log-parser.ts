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
        console.log(`Linha de log recebida: ${line}`); // Log para debug

        /**
         * Exemplos de linhas de log:
         * sendmail[34063]: 4B20po7G034063: to=recipient@example.com, ctladdr=naoresponder@seu-dominio.com (0/0), delay=00:00:00, xdelay=00:00:00, mailer=relay, pri=31004, relay=[127.0.0.1] [127.0.0.1], dsn=2.0.0, stat=Sent (4B20pogp034064 Message accepted for delivery)
         * sm-mta[35942]: 4B24QxX9035940: to=<prasmatic@outlook.comm>, delay=00:00:00, xdelay=00:00:00, mailer=esmtp, pri=31235, relay=outlook.com., dsn=5.1.2, stat=Host unknown (Name server: outlook.comm: host not found)
         */

        // Atualize a expressão regular para capturar diferentes formatos e status
        const regex = /(?:sendmail|sm-mta)\[[0-9]+\]: ([A-Z0-9]+): to=<?([^>,]+(?:, *[^>,]+)*)>?, .*dsn=(\d+\.\d+\.\d+), stat=([^ ]+)(?: \((.+)\))?/i;
        const match = line.match(regex);

        if (match) {
            const [, mailId, emails, dsn, status, statusMessage] = match;
            const success = status.toLowerCase().startsWith('sent') || status.toLowerCase().startsWith('queued');
            let detail: Record<string, any> = {};

            if (!success && statusMessage) {
                detail = this.parseStatusMessage(statusMessage);
            }

            const emailList = emails.split(',').map(email => email.trim());

            console.log(`MailId: ${mailId}, Emails: ${emailList.join(', ')}, Status: ${status}, DSN: ${dsn}, Message: ${statusMessage}`); // Log para debug

            for (const email of emailList) {
                try {
                    const logEntry: IEmailLog = new EmailLog({
                        mailId,
                        email,
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
        } else {
            console.log(`Linha de log não correspondida pelo regex: ${line}`); // Log para debug
        }
    }

    private parseStatusMessage(message: string): Record<string, any> {
        const detail: Record<string, any> = {};

        if (message.toLowerCase().includes('blocked')) {
            detail['blocked'] = true;
        }
        if (message.toLowerCase().includes('timeout')) {
            detail['timeout'] = true;
        }
        if (message.toLowerCase().includes('rejected')) {
            detail['rejected'] = true;
        }
        if (message.toLowerCase().includes('host unknown')) {
            detail['hostUnknown'] = true;
        }
        // Adicione mais condições conforme necessário

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
                    console.log(`Logs encontrados para mailId: ${mailId}`); // Log para debug
                    return logs;
                }
            } catch (error) {
                logger.error(`Erro ao recuperar logs para mailId: ${mailId}:`, error);
                return null;
            }
        }
        console.log(`Nenhum log encontrado para mailId: ${mailId} após ${timeout} segundos`); // Log para debug
        return null;
    }

    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default LogParser;
