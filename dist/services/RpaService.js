"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
/**
 * RpaService
 *
 * - Carrega sentenças de um arquivo JSON (singleton).
 * - Gera domínios aleatórios a partir de 4 frases e 4 palavras.
 * - Verifica e ajusta /etc/hosts (primeira linha = 127.0.0.1 correios).
 * - Altera o hostname do sistema a cada 1 minuto.
 */
class RpaService {
    /**
     * Construtor privado (Singleton). Carrega as sentenças uma única vez.
     */
    constructor() {
        // Memória de frases carregadas
        this.sentences = [];
        // Interval ID no Node.js pode ser do tipo NodeJS.Timeout
        // ou mais genericamente ReturnType<typeof setInterval>
        this.intervalId = null;
        // Ajuste conforme o caminho real do seu JSON
        this.SENTENCES_PATH = '/root/worker-sender-proff/sentences.json';
        this.tlds = ['com', 'net', 'org', 'io', 'tech', 'biz', 'info'];
        this.letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
        this.loadSentences();
    }
    /**
     * Obtém a instância única do RpaService (Singleton).
     */
    static getInstance() {
        if (!RpaService.instance) {
            RpaService.instance = new RpaService();
        }
        return RpaService.instance;
    }
    /**
     * Lê o arquivo JSON de sentenças e as carrega em memória.
     */
    loadSentences() {
        try {
            const fileData = fs_1.default.readFileSync(this.SENTENCES_PATH, 'utf-8');
            const parsed = JSON.parse(fileData);
            if (!Array.isArray(parsed)) {
                throw new Error('Formato inválido em sentences.json: não é um array de strings');
            }
            this.sentences = parsed;
            console.log(`[RpaService] Sentenças carregadas na memória: ${this.sentences.length} linhas.`);
        }
        catch (err) {
            console.error('[RpaService] Erro ao carregar sentences.json:', err);
            this.sentences = [];
        }
    }
    /**
     * Seleciona aleatoriamente "count" elementos de um array, embaralhando-o.
     */
    pickRandomElements(arr, count) {
        if (count <= 0)
            return [];
        const shuffled = [...arr];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled.slice(0, count);
    }
    /**
     * Retorna 1 elemento aleatório de um array.
     */
    pickRandom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }
    /**
     * Gera um domínio aleatório seguindo a lógica:
     * 1) Seleciona 4 frases aleatórias.
     * 2) Das frases, extrai todas as palavras >= 3 letras.
     * 3) Seleciona 4 palavras e intercala letras aleatórias entre elas.
     * 4) Escolhe TLD.
     */
    generateRandomDomain() {
        if (this.sentences.length === 0) {
            console.warn('[RpaService] Nenhuma sentença carregada. Domínio fallback.');
            return 'fallbackdomain.com';
        }
        // 1) Selecionar 4 frases
        const randomSentences = this.pickRandomElements(this.sentences, 4);
        // 2) Coletar palavras (>= 3 letras)
        let wordsPool = [];
        for (const sentence of randomSentences) {
            const filteredWords = sentence
                .split(/\s+/)
                .map(word => word.replace(/[^a-zA-ZÀ-úà-ú]/g, ''))
                .filter(word => word.length >= 3);
            wordsPool = wordsPool.concat(filteredWords);
        }
        if (wordsPool.length < 4) {
            console.warn('[RpaService] Menos de 4 palavras disponíveis. Domínio fallback.');
            return 'fallbackdomain.com';
        }
        // 3) Pegar 4 palavras e intercalar letras
        const chosenWords = this.pickRandomElements(wordsPool, 4).map(w => w.toLowerCase());
        let domainBase = '';
        chosenWords.forEach((word, idx) => {
            domainBase += word;
            // Intercala uma letra (exceto após a última palavra)
            if (idx < chosenWords.length - 1) {
                domainBase += this.pickRandom(this.letters);
            }
        });
        // 4) Escolher TLD
        const tld = this.pickRandom(this.tlds);
        return `${domainBase}.${tld}`;
    }
    /**
     * Verifica /etc/hosts para garantir que a PRIMEIRA linha seja "127.0.0.1 correios".
     * Se não for, adiciona no topo.
     */
    verifyHosts() {
        try {
            const hostsPath = '/etc/hosts';
            const content = fs_1.default.readFileSync(hostsPath, 'utf-8');
            const lines = content.split('\n');
            if (lines[0].trim() !== '127.0.0.1 correios') {
                console.log('[RpaService] Ajustando /etc/hosts para ter "127.0.0.1 correios" na primeira linha.');
                lines.unshift('127.0.0.1 correios');
                fs_1.default.writeFileSync(hostsPath, lines.join('\n'));
            }
        }
        catch (err) {
            console.error('[RpaService] Erro ao verificar/atualizar /etc/hosts:', err);
        }
    }
    /**
     * Gera um novo domínio e altera o hostname do sistema.
     */
    changeHostname() {
        try {
            this.verifyHosts();
            const newDomain = this.generateRandomDomain();
            console.log(`[RpaService] Alterando hostname para: ${newDomain}`);
            (0, child_process_1.execSync)(`hostnamectl set-hostname ${newDomain}`);
        }
        catch (error) {
            console.error('[RpaService] Erro ao alterar hostname:', error);
        }
    }
    /**
     * Inicia o serviço, trocando o hostname a cada 1 minuto.
     */
    start() {
        if (this.intervalId) {
            console.log('[RpaService] Serviço já está em execução.');
            return;
        }
        console.log('[RpaService] Iniciando serviço RPA de troca de hostname a cada 1 minuto.');
        this.changeHostname(); // Primeira troca imediata
        this.intervalId = setInterval(() => {
            this.changeHostname();
        }, 60000); // 60 segundos
    }
    /**
     * Para o serviço de troca de hostname.
     */
    stop() {
        if (!this.intervalId) {
            console.log('[RpaService] Serviço não está em execução.');
            return;
        }
        clearInterval(this.intervalId);
        this.intervalId = null;
        console.log('[RpaService] Serviço RPA interrompido.');
    }
}
exports.default = RpaService;
