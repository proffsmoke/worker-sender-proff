// src/routes/index.ts
import { Router } from 'express';
import EmailController from '../controllers/EmailController';
import StatusController from '../controllers/StatusController';
import { basicAuth } from '../middleware/auth';
import asyncHandler from '../utils/asyncHandler';

const router = Router();

// Middleware de autenticação para todas as rotas abaixo
router.use(basicAuth);

// Rotas de envio
router.post('/send', asyncHandler(EmailController.sendNormal));

// Rota de status
router.get('/status', asyncHandler(StatusController.getStatus));

export default router;
