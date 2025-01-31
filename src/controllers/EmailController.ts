import { Request, Response, NextFunction } from 'express';
import EmailService from '../services/EmailService';
import logger from '../utils/logger';
import EmailQueueModel from '../models/EmailQueueModel';

interface EmailPayload {
    emailDomain: string;
    fromName: string;
    to: string;
    subject: string;
    html: string;
    clientName?: string;
    sender?: string;
}

class EmailController {
    constructor() {
        this.sendNormal = this.sendNormal.bind(this);
    }

    async sendNormal(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { emailDomain, emailList, fromName, uuid, subject, htmlContent, sender } = req.body;
    
        try {
            logger.info(`Iniciando envio de e-mails para UUID=${uuid}`);
    
            // Validação básica dos parâmetros
            const requiredParams = ['emailDomain', 'emailList', 'fromName', 'uuid', 'subject', 'htmlContent', 'sender'];
            const missingParams = requiredParams.filter(param => !(param in req.body));
    
            if (missingParams.length > 0) {
                throw new Error(`Parâmetros obrigatórios ausentes: ${missingParams.join(', ')}.`);
            }
    
            const emailService = EmailService.getInstance();
    
            // Cria ou atualiza o documento no banco de dados
            let emailQueue = await EmailQueueModel.findOne({ uuid });
    
            if (!emailQueue) {
                emailQueue = new EmailQueueModel({ uuid, queueIds: [] });
                logger.info(`Novo documento criado para UUID=${uuid}`);
            } else {
                logger.info(`Documento existente encontrado para UUID=${uuid}`);
            }
    
            // **1. Remover Duplicatas da `emailList` e garantir que todos os e-mails sejam processados:**
            const uniqueEmailList = [];
            const emailMap = new Map(); // Usar um Map para rastrear os e-mails únicos
    
            for (const emailData of emailList) {
                if (!emailMap.has(emailData.email)) {
                    emailMap.set(emailData.email, emailData); // Adiciona o emailData completo ao Map
                    uniqueEmailList.push(emailData);
                }
            }
    
            // **2. Usar um Map para Acompanhar os `queueIds`:**
            const queueIdMap = new Map(emailQueue.queueIds.map(item => [item.queueId, item]));
    
            for (const emailData of uniqueEmailList) {
                const { email, clientName } = emailData;
    
                const emailPayload: EmailPayload = {
                    emailDomain,
                    fromName,
                    to: email,
                    subject, // Passando o subject diretamente
                    html: htmlContent, // Passando o htmlContent diretamente
                    sender,
                };
    
                if (clientName) {
                    emailPayload.clientName = clientName;
                }
    
                const result = await emailService.sendEmail(emailPayload, uuid, emailQueue.queueIds);
    
                if (!queueIdMap.has(result.queueId)) {
                    const queueIdData = {
                        queueId: result.queueId,
                        email,
                        success: null,
                    };
                    emailQueue.queueIds.push(queueIdData);
                    queueIdMap.set(result.queueId, queueIdData);
    
                    logger.info(`E-mail enviado com sucesso:`, {
                        uuid,
                        queueId: result.queueId,
                        email,
                        subject,
                        clientName,
                    });
                } else {
                    logger.info(`O queueId ${result.queueId} já está presente para o UUID=${uuid}, não será duplicado.`);
                }
            }
    
            await this.saveEmailQueue(emailQueue, uuid);
            this.sendSuccessResponse(res, emailQueue);
    
        } catch (error) {
            this.handleError(res, error);
        }
    }

    // Método para salvar o EmailQueue no banco de dados
    private async saveEmailQueue(emailQueue: any, uuid: string): Promise<void> {
        try {
            await emailQueue.save();
            console.log('Dados salvos com sucesso:', emailQueue); // Confirmação no console
            logger.info(`Dados salvos com sucesso para UUID=${uuid}`, { emailQueue });
        } catch (saveError) {
            console.error('Erro ao salvar os dados:', saveError); // Log de erro no console
            logger.error(`Erro ao salvar os dados para UUID=${uuid}:`, saveError);
            throw new Error('Erro ao salvar os dados no banco de dados.');
        }
    }

    // Método para enviar resposta de sucesso
    private sendSuccessResponse(
        res: Response,
        emailQueue: { uuid: string; queueIds: Array<{ queueId: string; email: string; success: boolean | null }> }
    ): void {
        res.json({
            success: true,
            uuid: emailQueue.uuid,
            queueIds: emailQueue.queueIds.map(q => ({
                queueId: q.queueId,
                email: q.email,
                success: q.success, // Pode ser null
            })),
        });
    }

    // Método para tratar erros
    private handleError(res: Response, error: unknown): void {
        if (error instanceof Error) {
            logger.error(`Erro ao enviar e-mail:`, error);
            res.status(500).json({
                success: false,
                message: 'Erro ao enviar e-mail.',
                error: error.message,
            });
        } else {
            logger.error(`Erro desconhecido ao enviar e-mail:`, error);
            res.status(500).json({
                success: false,
                message: 'Erro desconhecido ao enviar e-mail.',
            });
        }
    }
}

export default new EmailController();