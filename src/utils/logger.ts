// src/utils/logger.ts
import { createLogger, format, transports } from 'winston';

const customFormat = format.combine(
  format.timestamp(),
  format.printf(({ timestamp, level, message, ...meta }) => {
    let metaString = '';
    if (Object.keys(meta).length > 0) {
      metaString = JSON.stringify(meta);
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaString}`;
  })
);

const logger = createLogger({
  level: 'info',
  format: customFormat,
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' }),
  ],
});

export default logger;
