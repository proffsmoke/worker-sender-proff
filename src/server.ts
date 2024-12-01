import app from './app';
import config from './config';
import logger from './utils/logger';

const startServer = async () => {
  const host = process.env.HOST || '0.0.0.0'; // Adiciona suporte para configuração via variável de ambiente
  app.listen(config.port, host, () => {
    logger.info(`Servidor rodando no endereço ${host}:${config.port}`);
  });
};

startServer();
