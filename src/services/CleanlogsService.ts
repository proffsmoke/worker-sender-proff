import { exec } from 'child_process';
import logger from '../utils/logger';

class CleanlogsService {
  private interval: number = 12 * 60 * 60 * 1000; // 12 horas em milissegundos

  constructor() {
    this.runCleanup();
    setInterval(() => this.runCleanup(), this.interval);
  }

  private runCleanup(): void {
    logger.info('Iniciando limpeza de logs...');

    // Comando para limpar logs do journalctl
    exec('sudo journalctl --vacuum-size=100M', (error, stdout, stderr) => {
      if (error) {
        logger.error(`Erro ao limpar logs do journalctl: ${error.message}`);
        return;
      }
      if (stderr) {
        logger.warn(`Stderr ao limpar logs do journalctl: ${stderr}`);
        return;
      }
      logger.info(`Logs do journalctl limpos: ${stdout}`);
    });

    // Comando para truncar o arquivo syslog
    exec('sudo truncate -s 0 /var/log/syslog', (error, stdout, stderr) => {
      if (error) {
        logger.error(`Erro ao truncar /var/log/syslog: ${error.message}`);
        return;
      }
      if (stderr) {
        logger.warn(`Stderr ao truncar /var/log/syslog: ${stderr}`);
        return;
      }
      logger.info(`/var/log/syslog truncado com sucesso.`);
    });

    // Comando para truncar o arquivo mail.log
    exec('sudo truncate -s 0 /var/log/mail.log', (error, stdout, stderr) => {
      if (error) {
        logger.error(`Erro ao truncar /var/log/mail.log: ${error.message}`);
        return;
      }
      if (stderr) {
        logger.warn(`Stderr ao truncar /var/log/mail.log: ${stderr}`);
        return;
      }
      logger.info(`/var/log/mail.log truncado com sucesso.`);
    });
  }
}

export default new CleanlogsService();