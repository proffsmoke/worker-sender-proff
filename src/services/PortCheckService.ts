import net from 'net';
import logger from '../utils/logger';

class PortCheckService {
  async checkPort(ip: string, port: number): Promise<boolean> {
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
      }).connect(port, ip);
    });
  }

  async verifyPort(ip: string = '0.0.0.0', ports: number[]): Promise<number | null> {
    for (const port of ports) {
      if (await this.checkPort(ip, port)) {
        logger.info(`Verificação de porta ${port} para IP ${ip}: ABERTA`);
        return port;
      }
    }
    logger.warn(`Nenhuma porta disponível para IP ${ip}`);
    return null;
  }
}

export default new PortCheckService();
