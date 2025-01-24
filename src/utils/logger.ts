import { createLogger, format, transports } from 'winston';

// Formato personalizado para os logs
const customFormat = format.combine(
  format.timestamp(), // Adiciona um timestamp ao log
  format.printf(({ timestamp, level, message, ...meta }) => {
    let metaString = '';
    if (Object.keys(meta).length > 0) {
      metaString = JSON.stringify(meta); // Converte metadados em string JSON
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaString}`;
  })
);

// Configuração do logger
const logger = createLogger({
  level: 'info', // Nível mínimo de log (info, error, etc.)
  format: customFormat, // Usa o formato personalizado
  transports: [
    new transports.Console(), // Saída para o console
    new transports.File({ filename: 'logs/error.log', level: 'error' }), // Arquivo para logs de erro
    new transports.File({ filename: 'logs/combined.log' }), // Arquivo para todos os logs
  ],
});

export default logger;