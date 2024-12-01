// src/services/PortCheckService.ts
import net from 'net';
import logger from '../utils/logger';

class PortCheckService {
  async checkPort25(ip: string): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      }).on('timeout', () => {
        socket.destroy();
        resolve(false);
      }).on('error', () => {
        resolve(false);
      }).connect(25, ip);
    });
  }

  async verifyPort25(ip: string): Promise<boolean> {
    const isOpen = await this.checkPort25(ip);
    logger.info(`Verificação de porta 25 para IP ${ip}: ${isOpen ? 'ABERTA' : 'FECHADA'}`);
    return isOpen;
  }
}

export default new PortCheckService();
