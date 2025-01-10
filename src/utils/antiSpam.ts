// src/utils/antiSpam.ts

import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import logger from './logger'; // Certifique-se de que o logger está corretamente configurado

const randomWordsPath = path.join(__dirname, '../randomWords.json');
const sentencesPath = path.join(__dirname, '../sentences.json');
/**
 * Função genérica para carregar e parsear arquivos JSON.
 * Lança erro se o arquivo não existir, não for um array ou estiver vazio.
 */
function loadJsonFile<T>(filePath: string): T {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Arquivo não encontrado: ${filePath}`);
        }

        const data = fs.readFileSync(filePath, 'utf-8');
        const parsed: T = JSON.parse(data);

        if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error(`Arquivo ${filePath} deve conter um array não vazio.`);
        }

        logger.info(`Arquivo carregado com sucesso: ${filePath}`);
        return parsed;
    } catch (error) {
        logger.error(`Erro ao carregar ${filePath}: ${(error as Error).message}`);
        throw error; // Re-lança o erro para ser tratado externamente, se necessário
    }
}

// Carrega os dados dos arquivos JSON
let randomWords: string[] = [];
let sentencesArray: string[] = [];

try {
    randomWords = loadJsonFile<string[]>(randomWordsPath);
} catch (error) {
    logger.error(`Usando classes padrão devido ao erro: ${(error as Error).message}`);
    randomWords = ["defaultPrefix"]; // Classe padrão
}

try {
    sentencesArray = loadJsonFile<string[]>(sentencesPath);
} catch (error) {
    logger.error(`Usando frases padrão devido ao erro: ${(error as Error).message}`);
    sentencesArray = ["Default sentence."]; // Frase padrão
}

/**
 * Cria um span invisível com uma frase única e uma classe aleatória.
 * A inserção ocorre com uma probabilidade de 80%.
 */
function createInvisibleSpanWithUniqueSentence(): string {
    // Aumentar a probabilidade para 80% de inserção
    if (Math.random() > 0.2) return '';

    const sentence = sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
    const randomClass = randomWords[Math.floor(Math.random() * randomWords.length)];

    return `<span class="${randomClass}" style="visibility: hidden; position: absolute; font-size: 0;">${sentence}</span>`;
}

/**
 * Função principal de anti-spam que insere spans invisíveis no HTML fornecido.
 * @param html - Conteúdo HTML do email.
 * @returns HTML com spans de anti-spam inseridos.
 */
export default function antiSpam(html: string): string {
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
                if (word.toLowerCase() === 'bradesco') {
                    // Inserir spans entre as letras de 'bradesco'
                    return word
                        .split('')
                        .map((letter) => createInvisibleSpanWithUniqueSentence() + letter)
                        .join('');
                } else {
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
