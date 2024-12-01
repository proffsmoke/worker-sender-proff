// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import config from '../config';

export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="401"');
    res.status(401).send('Autenticação necessária.');
    return;
  }

  const [type, credentials] = authHeader.split(' ');
  if (type !== 'Basic' || !credentials) {
    res.status(401).send('Autenticação inválida.');
    return;
  }

  const decoded = Buffer.from(credentials, 'base64').toString('utf-8');
  const [login, password] = decoded.split(':');

  if (login === config.auth.login && password === config.auth.password) {
    next();
    return;
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="401"');
  res.status(401).send('Autenticação necessária.');
  return;
}
