import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

// Caminho para os arquivos JSON na raiz do projeto
const randomWordsPath = path.join(process.cwd(), 'randomWords.json');
const sentencesPath = path.join(process.cwd(), 'sentences.json');

// Variável de controle para inserir <br> apenas na primeira vez
let isFirstInsertion = true;

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

        console.log(`Arquivo carregado com sucesso: ${filePath}`);
        return parsed;
    } catch (error) {
        console.error(`Erro ao carregar ${filePath}: ${(error as Error).message}`);
        throw error; // Re-lança o erro para ser tratado externamente, se necessário
    }
}

// Carrega os dados dos arquivos JSON
let randomWords: string[] = [];
let sentencesArray: string[] = [];

try {
    randomWords = loadJsonFile<string[]>(randomWordsPath);
} catch (error) {
    console.error(`Usando classes padrão devido ao erro: ${(error as Error).message}`);
    randomWords = ["defaultPrefix"]; // Classe padrão
}

try {
    sentencesArray = loadJsonFile<string[]>(sentencesPath);
} catch (error) {
    console.error(`Usando frases padrão devido ao erro: ${(error as Error).message}`);
    sentencesArray = ["Default sentence."]; // Frase padrão
}

/**
 * Cria um span invisível com uma frase única e uma classe aleatória.
 * A inserção ocorre com uma probabilidade de 80%.
 * Caso seja a primeira vez que vamos inserir algo, adicionamos entre 5 e 10 <br> antes.
 */
function createInvisibleSpanWithUniqueSentence(): string {
    // Aumentar a probabilidade para 80% de inserção
    if (Math.random() > 0.2) return '';

    const sentence = sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
    const randomClass = randomWords[Math.floor(Math.random() * randomWords.length)];

    // Insere de 5 a 10 <br> apenas na primeira vez
    let lineBreaks = '';
    if (isFirstInsertion) {
        const count = Math.floor(Math.random() * 6) + 5; // 5 a 10
        lineBreaks = Array(count).fill('<br>').join('');
        isFirstInsertion = false;
    }

    return `${lineBreaks}<span class="${randomClass}" style="visibility: hidden; position: absolute; font-size: 0;">${sentence}</span>`;
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
                const lowerWord = word.toLowerCase();
                const targetWords = ['bradesco', 'correios', 'correio', 'alfândega', 'pagamento', 'pagar', 'retido'];

                if (targetWords.includes(lowerWord)) {
                    // Quebrar a palavra em letras e inserir spans
                    const letters = word.split('');
                    const spans = letters.map((letter) => {
                        // Definir o número mínimo de spans com base no tamanho da palavra
                        const minSpans = Math.ceil(lowerWord.length / 3); // Exemplo: 1 span a cada 3 letras
                        const spansToInsert = Array(minSpans)
                            .fill(null)
                            .map(() => createInvisibleSpanWithUniqueSentence())
                            .join('');
                        return spansToInsert + letter;
                    });
                    return spans.join('');
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
