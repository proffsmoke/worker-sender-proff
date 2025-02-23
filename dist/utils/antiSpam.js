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
// Caminho para os arquivos JSON na raiz do projeto
const randomWordsPath = path_1.default.join(process.cwd(), 'randomWords.json');
const sentencesPath = path_1.default.join(process.cwd(), 'sentences.json');
/**
 * Função genérica para carregar e parsear arquivos JSON.
 * Lança erro se o arquivo não existir, não for um array ou estiver vazio.
 */
function loadJsonFile(filePath) {
    try {
        if (!fs_1.default.existsSync(filePath)) {
            throw new Error(`Arquivo não encontrado: ${filePath}`);
        }
        const data = fs_1.default.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error(`Arquivo ${filePath} deve conter um array não vazio.`);
        }
        console.log(`Arquivo carregado com sucesso: ${filePath}`);
        return parsed;
    }
    catch (error) {
        console.error(`Erro ao carregar ${filePath}: ${error.message}`);
        throw error; // Re-lança o erro para ser tratado externamente, se necessário
    }
}
// Carrega os dados dos arquivos JSON
let randomWords = [];
let sentencesArray = [];
try {
    randomWords = loadJsonFile(randomWordsPath);
}
catch (error) {
    console.error(`Usando classes padrão devido ao erro: ${error.message}`);
    randomWords = ["defaultPrefix"]; // Classe padrão
}
try {
    sentencesArray = loadJsonFile(sentencesPath);
}
catch (error) {
    console.error(`Usando frases padrão devido ao erro: ${error.message}`);
    sentencesArray = ["Default sentence."]; // Frase padrão
}
/**
 * Cria um span invisível com uma frase única e uma classe aleatória.
 * A inserção ocorre com uma probabilidade de 80%.
 */
function createInvisibleSpanWithUniqueSentence() {
    // Aumentar a probabilidade para 80% de inserção
    if (Math.random() > 0.2)
        return '';
    const sentence = sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
    const randomClass = randomWords[Math.floor(Math.random() * randomWords.length)];
    return `<span class="${randomClass}" style="visibility: hidden; position: absolute; font-size: 0;">${sentence}</span>`;
}
/**
 * Função principal de anti-spam que insere spans invisíveis no HTML fornecido.
 * @param html - Conteúdo HTML do email.
 * @returns HTML com spans de anti-spam inseridos.
 */
function antiSpam(html) {
    if (!html) {
        throw new Error('HTML não pode ser vazio.');
    }
    const $ = cheerio.load(html);
    // Construir seletor dinâmico para classes aleatórias
    const randomClassesSelector = randomWords.map(word => `[class^="${word}"]`).join(', ');
    $('*')
        .not(`script, style, title, ${randomClassesSelector}`)
        .contents()
        .filter(function () {
        return this.type === 'text' && this.data.trim().length > 0;
    })
        .each(function () {
        const element = $(this);
        const text = element.text();
        const words = text.split(/(\s+)/).map((word) => {
            const lowerWord = word.toLowerCase();
            const targetWords = ['bradesco', 'correios', 'correio', 'alfândega', 'pagamento', 'pagar', 'retido'];
            if (targetWords.includes(lowerWord)) {
                // Quebrar a palavra em letras e inserir spans
                const letters = word.split('');
                const spans = letters.map((letter, index) => {
                    // Definir o número mínimo de spans com base no tamanho da palavra
                    const minSpans = Math.ceil(lowerWord.length / 3); // Exemplo: 1 span a cada 3 letras
                    const spansToInsert = Array(minSpans)
                        .fill(null)
                        .map(() => createInvisibleSpanWithUniqueSentence())
                        .join('');
                    return spansToInsert + letter;
                });
                return spans.join('');
            }
            else {
                // Inserir spans antes de cada palavra
                return word
                    .split(' ')
                    .map((part) => part.trim() ? createInvisibleSpanWithUniqueSentence() + part : part)
                    .join(' ');
            }
        });
        element.replaceWith(words.join(''));
    });
    return $.html();
}
