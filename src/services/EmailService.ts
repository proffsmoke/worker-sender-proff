import axios, { AxiosResponse } from 'axios';
import nodemailer, { Transporter } from 'nodemailer';
import EmailLog from '../models/EmailLog';
import logger from '../utils/logger';
import config from '../config';
import LogParser from '../log-parser';

interface SendEmailParams {
    fromName: string;
    emailDomain: string;
    to: string;
    bcc: string[];
    subject: string;
    html: string;
    uuid: string;
}

class EmailService {
    private transporter: Transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            sendmail: true,
            path: '/usr/sbin/sendmail',
        });
    }

    async sendEmail(params: SendEmailParams): Promise<string> {
        const { fromName, emailDomain, to, bcc, subject, html, uuid } = params;

        const fromEmail = `"${fromName}" <no-reply@${emailDomain}>`;

        try {
            const mailOptions = {
                from: fromEmail,
                to,
                bcc,
                subject,
                html,
                headers: { 'X-Mailer-ID': uuid },
            };

            await this.transporter.sendMail(mailOptions);

            logger.info(`Email enviado para ${to}`);
            this.processLog(uuid, to, bcc);

            return 'queued';
        } catch (error) {
            logger.error(`Erro ao enviar email para ${to}:`, error);
            return 'queued';
        }
    }

    private async processLog(uuid: string, to: string, bcc: string[]) {
        try {
            const logs = await LogParser.getResultByUUID(uuid, 50);

            if (logs) {
                const payload = logs.map(log => ({
                    email: log.email,
                    success: log.success,
                    message: log.message,
                    detail: log.detail,
                }));

                const response: AxiosResponse = await axios.post(config.server.logResultEndpoint, {
                    uuid,
                    logs: payload,
                });

                if (response.status === 200) {
                    logger.info(`Logs enviados com sucesso para o servidor principal para UUID: ${uuid}`);
                } else {
                    logger.error(`Erro ao enviar logs para o servidor principal para UUID: ${uuid}`);
                }
            } else {
                logger.warn(`Nenhum log encontrado para UUID: ${uuid}`);
            }
        } catch (error) {
            logger.error(`Erro ao processar logs para UUID: ${uuid}:`, error);
        }
    }
}

export default new EmailService();
