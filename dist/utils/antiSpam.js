"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = antiSpam;
const cheerio = __importStar(require("cheerio"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Caminho p/ o arquivo JSON de frases (se estiver usando)
const sentencesPath = path_1.default.join(process.cwd(), 'sentences.json');
/**
 * Carrega um arquivo JSON simples
 */
function loadJsonFile(filePath) {
    if (!fs_1.default.existsSync(filePath)) {
        throw new Error(`Arquivo não encontrado: ${filePath}`);
    }
    const data = fs_1.default.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error(`Arquivo ${filePath} deve conter um array não vazio.`);
    }
    return parsed;
}
// Se você usa frases
let sentencesArray;
try {
    sentencesArray = loadJsonFile(sentencesPath);
}
catch {
    sentencesArray = ["Frase de fallback"];
}
/**
 * Data/hora de Brasília (UTC-3) - Modificada para retornar partes
 */
function getBrasiliaDateTimeParts() {
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const brasiliaTime = new Date(utcTime - 3 * 3600000);
    const dd = String(brasiliaTime.getDate()).padStart(2, '0');
    const mm = String(brasiliaTime.getMonth() + 1).padStart(2, '0'); // Mês é 0-indexado
    const yyyy = brasiliaTime.getFullYear();
    const HH = String(brasiliaTime.getHours()).padStart(2, '0');
    const MM = String(brasiliaTime.getMinutes()).padStart(2, '0');
    const SS = String(brasiliaTime.getSeconds()).padStart(2, '0');
    const dayOfWeek = brasiliaTime.toLocaleDateString('pt-BR', { weekday: 'long' });
    const monthName = brasiliaTime.toLocaleDateString('pt-BR', { month: 'long' });
    return {
        dayOfWeek: dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1),
        day: dd,
        monthName: monthName.charAt(0).toUpperCase() + monthName.slice(1),
        year: String(yyyy),
        hours: HH,
        minutes: MM,
        seconds: SS,
        formattedDateTime: `${dd}/${mm}/${yyyy} ${HH}:${MM}:${SS} (Horário de Brasília)`,
    };
}
/**
 * Gera um código simples (com hífen no meio)
 */
function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let part1 = '';
    let part2 = '';
    for (let i = 0; i < 4; i++) {
        part1 += chars.charAt(Math.floor(Math.random() * chars.length));
        part2 += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${part1}-${part2}`;
}
/**
 * Gera um Session ID aleatório
 */
function generateSessionId(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let sessionId = '';
    for (let i = 0; i < length; i++) {
        sessionId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return sessionId;
}
/**
 * Texto do preheader
 */
function buildPreheaderText() {
    const dateTimeParts = getBrasiliaDateTimeParts();
    const code = generateCode();
    const sessionId = generateSessionId();
    // Arrays de nomes aleatórios para cada seção
    const temporalLabels = [
        "Registro Temporal de Atividade:",
        "Timestamp da Operação:",
        "Momento da Verificação:",
        "Data/Hora do Evento:"
    ];
    const keyLabels = [
        "Chave de Autenticação Primária:",
        "Código de Segurança AlfaNumérico:",
        "Token de Validação Exclusivo:",
        "Identificador de Acesso Único:"
    ];
    const dailyDetailLabels = [
        "Referência de Calendário Detalhada:",
        "Especificação Diária Completa:",
        "Contexto Temporal Extenso:",
        "Ponto Exato no Tempo (Detalhado):"
    ];
    const sessionLabels = [
        "Identificador Único de Sessão de Usuário:",
        "ID de Conexão Corrente:",
        "Registro de Sessão Ativa:",
        "Token de Navegação Temporário:"
    ];
    const statusLabels = [
        "Diagnóstico de Status Operacional do Sistema:",
        "Relatório de Performance da Plataforma:",
        "Sumário do Estado Atual dos Serviços:",
        "Avaliação da Integridade dos Componentes:"
    ];
    const statusPhrases = [
        "Verificação de sistema completa e operacional.",
        "Todos os módulos respondendo conforme esperado.",
        "Conexão segura e estável estabelecida com sucesso.",
        "Sistema pronto para processamento de dados em lote.",
        "Nenhuma anomalia detectada durante a inicialização dos serviços.",
        "Protocolos de segurança ativados e validados.",
        "Recursos alocados e monitoramento em tempo real ativo."
    ];
    const randomStatusText = statusPhrases[Math.floor(Math.random() * statusPhrases.length)];
    // Seleciona aleatoriamente um rótulo para cada parte
    const randomTemporalLabel = temporalLabels[Math.floor(Math.random() * temporalLabels.length)];
    const randomKeyLabel = keyLabels[Math.floor(Math.random() * keyLabels.length)];
    const randomDailyDetailLabel = dailyDetailLabels[Math.floor(Math.random() * dailyDetailLabels.length)];
    const randomSessionLabel = sessionLabels[Math.floor(Math.random() * sessionLabels.length)];
    const randomStatusLabel = statusLabels[Math.floor(Math.random() * statusLabels.length)];
    const part1 = `${randomTemporalLabel} ${dateTimeParts.formattedDateTime}`;
    const part2 = `${randomKeyLabel} ${code}`;
    const part3 = `${randomDailyDetailLabel} ${dateTimeParts.dayOfWeek}, ${dateTimeParts.day} de ${dateTimeParts.monthName} de ${dateTimeParts.year}, às ${dateTimeParts.hours} horas, ${dateTimeParts.minutes} minutos e ${dateTimeParts.seconds} segundos`;
    const part4 = `${randomSessionLabel} ${sessionId}`;
    const part5 = `${randomStatusLabel} ${randomStatusText}`;
    return `${part1} | ${part2} | ${part3} | ${part4} | ${part5}`;
}
/**
 * Cria um <span> invisível com frase aleatória, com 80% de chance
 */
function createInvisibleSpanWithUniqueSentence() {
    if (Math.random() > 0.2)
        return '';
    const randomSentence = sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
    return `<span style="visibility: hidden; position: absolute; font-size: 0;">${randomSentence}</span>`;
}
/**
 * Função principal antiSpam
 */
function antiSpam(html) {
    if (!html) {
        throw new Error('HTML não pode ser vazio.');
    }
    const $ = cheerio.load(html);
    // Injeta preheader no topo do body (com display:none para sumir)
    const preheaderContent = buildPreheaderText();
    $('body').prepend(`
    <div id="preheader" style="display:none;">
      ${preheaderContent}
    </div>
  `);
    // Palavras-alvo a serem quebradas letra a letra
    const targetWords = [
        'bradesco',
        'correios',
        'correio',
        'alfândega',
        'pagamento',
        'pagar',
        'retido'
    ];
    // Percorrer tudo, exceto:
    // - script, style, title
    // - o bloco #preheader e seus filhos
    $('*')
        .not('script, style, title, #preheader, #preheader *')
        .contents()
        .filter(function () {
        return this.type === 'text' && this.data.trim().length > 0;
    })
        .each(function () {
        const element = $(this);
        const text = element.text();
        const splitted = text.split(/(\s+)/).map(word => {
            const lower = word.toLowerCase();
            if (targetWords.includes(lower)) {
                // Quebrar letra a letra e inserir spans
                const letters = word.split('');
                const lettersWithSpans = letters.map(letter => {
                    // ex: 1 span a cada 3 letras
                    const minSpans = Math.ceil(word.length / 3);
                    let injected = '';
                    for (let i = 0; i < minSpans; i++) {
                        injected += createInvisibleSpanWithUniqueSentence();
                    }
                    return injected + letter;
                });
                return lettersWithSpans.join('');
            }
            else {
                // Apenas 1 span antes da palavra
                if (word.trim()) {
                    return createInvisibleSpanWithUniqueSentence() + word;
                }
                return word; // espaços
            }
        });
        element.replaceWith(splitted.join(''));
    });
    return $.html();
}
