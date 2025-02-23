import express from 'express';
import routes from './routes';
import logger from './utils/logger';
import mongoose from 'mongoose';
import config from './config';
import MailerService from './services/MailerService';
import ResultSenderService from './services/ResultSenderServic';
import RpaService from './services/RpaService';

const app = express();

/**
 * Tentativa de conexão ao MongoDB com até 50 retries.
 * Cada falha aguarda 2s antes de nova tentativa.
 */
let attempts = 0;
async function connectWithRetry() {
  try {
    await mongoose.connect(config.mongodbUri);
    logger.info('Conectado ao MongoDB');
  } catch (err) {
    attempts++;
    logger.error(`Falha ao conectar ao MongoDB (tentativa ${attempts}/50):`, err);
    if (attempts < 50) {
      setTimeout(connectWithRetry, 2000);
    } else {
      logger.error('Não foi possível conectar ao MongoDB após 50 tentativas. Encerrando.');
      process.exit(1);
    }
  }
}
connectWithRetry();

/**
 * Garante que o MailerService seja instanciado imediatamente
 * e força o log a iniciar (caso ainda não tenha iniciado)
 */
const mailer = MailerService.getInstance();
// Chama a função que dispara o startMonitoring() se não estiver rodando.
mailer.forceLogInitialization();

// Inicia service result
const resultSenderService = new ResultSenderService();
resultSenderService.start();

// ***** Inicia o serviço RPA (troca de hostname a cada 1 min) *****
const rpaService = RpaService.getInstance();
rpaService.start();
// ***************************************************************

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', routes);

app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ success: false, message: 'Rota não encontrada.' });
});

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error(`Erro: ${err.message}`);
  res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
});

export default app;
