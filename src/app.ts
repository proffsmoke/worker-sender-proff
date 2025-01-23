import express from 'express';
import routes from './routes';
import logger from './utils/logger';
import mongoose from 'mongoose';
import config from './config';
import MailerService from './services/MailerService';


const app = express();

// Conectar ao MongoDB
mongoose
  .connect(config.mongodbUri)
  .then(() => logger.info('Conectado ao MongoDB'))
  .catch((err: Error) => {
    logger.error('Falha ao conectar ao MongoDB', err);
    process.exit(1);
  });

// Inicializar MailerService

// logParser.startMonitoring();
MailerService;

// CleanlogsService;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', routes);

// Middleware para erro 404
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ success: false, message: 'Rota não encontrada.' });
});

// Middleware de erro
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Erro: ${err.message}`);
  res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
});

export default app;