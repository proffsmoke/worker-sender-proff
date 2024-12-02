// src/services/EmailService.ts

import nodemailer, { Transporter } from 'nodemailer';
import Log from '../models/Log';
import logger from '../utils/logger';
import config from '../config';
import BlockService from './BlockService';
import MailerService from './MailerService';
import { v4 as uuidv4 } from 'uuid';

// Função auxiliar para selecionar um elemento aleatório de um array
function randomOne<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
}

interface SendEmailParams {
    fromName: string;
    emailDomain: string;
    to: string;
    bcc: string[];
    subject: string;
    html: string;
}

interface SendMailResult {
    to: string;
    success: boolean;
    message: string;
}

class EmailService {
    private transporter: Transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            sendmail: true,
            path: '/usr/sbin/sendmail', // Caminho padrão do sendmail no Ubuntu
        });

        // Removido transporter.verify() conforme solicitado
    }

    /**
     * Envia emails individuais ou em massa.
     * @param params Objeto contendo os parâmetros do email.
     * @returns Array de resultados de envio.
     */
    async sendEmail(params: SendEmailParams): Promise<SendMailResult[]> {
        const { fromName, emailDomain, to, bcc, subject, html } = params;
        const results: SendMailResult[] = [];
        const mailId = uuidv4();

        // Lista de prefixos para o email de remetente
        const prefixes = ['contato', 'naoresponder', 'noreply', 'notifica', 'notificacoes'];

        // Construir o email de remetente dinamicamente
        const fromEmail = `"${fromName}" <${randomOne(prefixes)}@${emailDomain}>`;

        if (MailerService.isMailerBlocked()) {
            const message = 'Mailer está bloqueado. Não é possível enviar emails no momento.';
            logger.warn(`Tentativa de envio bloqueada para ${to}: ${message}`, { to, subject });
            console.log(`Email enviado para ${to}`, { subject, html, message });

            // Log para envio individual bloqueado
            await Log.create({
                to,
                bcc,
                success: false,
                message,
            });
            results.push({ to, success: false, message });

            // Log para cada recipient no BCC bloqueado
            for (const recipient of bcc) {
                await Log.create({
                    to: recipient,
                    bcc,
                    success: false,
                    message,
                });
                results.push({ to: recipient, success: false, message });
                console.log(`Email enviado para ${recipient}`, { subject, html, message });
            }

            return results;
        }

        try {
            const mailOptions = {
                from: fromEmail,
                to,
                bcc,
                subject,
                html, // Já processado pelo antiSpam antes de chamar sendEmail
                headers: { 'X-Mailer-ID': mailId },
            };

            const info = await this.transporter.sendMail(mailOptions);
            console.log(`Email enviado para ${to}`, { subject, html, response: info.response });

            // Log para envio individual
            await Log.create({
                to,
                bcc,
                success: true,
                message: info.response,
            });
            results.push({ to, success: true, message: info.response });

            // Log para cada recipient no BCC
            for (const recipient of bcc) {
                await Log.create({
                    to: recipient,
                    bcc,
                    success: true,
                    message: info.response,
                });
                results.push({ to: recipient, success: true, message: info.response });
                console.log(`Email enviado para ${recipient}`, { subject, html, response: info.response });
            }

            logger.info(`Email enviado para ${to}`, { subject, html, response: info.response });
        }
        catch (error: unknown) {
            if (error instanceof Error) {
                // Log para envio individual falho
                await Log.create({
                    to,
                    bcc,
                    success: false,
                    message: error.message,
                });
                results.push({ to, success: false, message: error.message });
                console.log(`Erro ao enviar email para ${to}`, { subject, html, message: error.message });

                // Log para cada recipient no BCC falho
                for (const recipient of bcc) {
                    await Log.create({
                        to: recipient,
                        bcc,
                        success: false,
                        message: error.message,
                    });
                    results.push({ to: recipient, success: false, message: error.message });
                    console.log(`Erro ao enviar email para ${recipient}`, { subject, html, message: error.message });
                }

                logger.error(`Erro ao enviar email para ${to}: ${error.message}`, { subject, html, stack: error.stack });

                const isPermanent = BlockService.isPermanentError(error.message);
                const isTemporary = BlockService.isTemporaryError(error.message);
                if (isPermanent && !MailerService.isMailerPermanentlyBlocked()) {
                    MailerService.blockMailer('blocked_permanently');
                    logger.warn(`Mailer bloqueado permanentemente devido ao erro: ${error.message}`);
                }
                else if (isTemporary && !MailerService.isMailerBlocked()) {
                    MailerService.blockMailer('blocked_temporary');
                    logger.warn(`Mailer bloqueado temporariamente devido ao erro: ${error.message}`);
                }
            }
            else {
                // Caso o erro não seja uma instância de Error
                logger.error(`Erro desconhecido ao enviar email para ${to}`, { subject, html, error });
                console.log(`Erro desconhecido ao enviar email para ${to}`, { subject, html, error });
            }
        }

        return results;
    }

    async sendTestEmail(): Promise<boolean> {
        const testEmail = {
            from: 'no-reply@yourdomain.com', // Atualize para seu domínio
            to: config.mailer.noreplyEmail,
            subject: 'Mailer Test',
            text: `Testing mailer.`,
        };
        try {
            const info = await this.transporter.sendMail(testEmail);
            console.log(`Email de teste enviado para ${config.mailer.noreplyEmail}`, { subject: testEmail.subject, html: testEmail.text, response: "Messages queued for delivery" });
            logger.info(`Email de teste enviado para ${config.mailer.noreplyEmail}`);
            return true;
        }
        catch (error: unknown) {
            if (error instanceof Error) {
                console.log(`Erro ao enviar email de teste`, { message: error.message });
                logger.error(`Erro ao enviar email de teste: ${error.message}`, { stack: error.stack });
            }
            else {
                console.log(`Erro ao enviar email de teste`, { message: 'Erro desconhecido' });
                logger.error(`Erro ao enviar email de teste: Erro desconhecido`, { error });
            }
            return false;
        }
    }
}

export default new EmailService();
