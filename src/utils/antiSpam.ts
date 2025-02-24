import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

// Caminho para os arquivos JSON na raiz do projeto
const randomWordsPath = path.join(process.cwd(), 'randomWords.json');
const sentencesPath = path.join(process.cwd(), 'sentences.json');

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
 */
function createInvisibleSpanWithUniqueSentence(): string {
    // Probabilidade de 80% de inserir o span
    if (Math.random() > 0.2) return '';

    const sentence = sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
    const randomClass = randomWords[Math.floor(Math.random() * randomWords.length)];

    return `<span class="${randomClass}" style="visibility: hidden; position: absolute; font-size: 0;">${sentence}</span>`;
}

/**
 * Função principal de anti-spam que insere spans invisíveis no HTML fornecido,
 * além de inserir um preheader invisível de 4 a 6 quebras de linha.
 * @param html - Conteúdo HTML do email.
 * @returns HTML modificado.
 */
export default function antiSpam(html: string): string {
    if (!html) {
        throw new Error('HTML não pode ser vazio.');
    }

    const $ = cheerio.load(html);

    // 1. Inserir preheader invisível (4 a 6 linhas aleatórias)
    const lineCount = Math.floor(Math.random() * 3) + 4; // Entre 4 e 6
    let preheaderContent = '';
    for (let i = 0; i < lineCount; i++) {
        preheaderContent += '&nbsp;<br/>';
    }

    // Prepend no <body> para “enganar” o preview do email
    $('body').prepend(`
      <div style="
        display:none;
        max-height:0;
        overflow:hidden;
        font-size:0;
        line-height:0;
        mso-hide:all;
      ">
        ${preheaderContent}
      </div>
    `);

    // 2. Construir seletor dinâmico para classes aleatórias
    const randomClassesSelector = randomWords
        .map(word => `[class^="${word}"]`)
        .join(', ');

    // 3. Percorrer o conteúdo de todo elemento, exceto script/style/title/e spans já inseridos
    $('*')
        .not(`script, style, title, ${randomClassesSelector}`)
        .contents()
        .filter(function () {
            return this.type === 'text' && this.data.trim().length > 0;
        })
        .each(function () {
            const element = $(this);
            const text = element.text();

            // Dividir em "palavras" e espaços
            const words = text.split(/(\s+)/).map((word) => {
                const lowerWord = word.toLowerCase();
                // Palavras-alvo que queremos inserir spans entre as letras
                const targetWords = ['bradesco', 'correios', 'correio', 'alfândega', 'pagamento', 'pagar', 'retido'];

                if (targetWords.includes(lowerWord)) {
                    // “Quebrar” a palavra em letras e inserir spans invisíveis
                    const letters = word.split('');
                    const spans = letters.map((letter) => {
                        // Definir quantos spans inserir antes de cada letra
                        const minSpans = Math.ceil(lowerWord.length / 3);
                        const spansToInsert = Array(minSpans)
                            .fill(null)
                            .map(() => createInvisibleSpanWithUniqueSentence())
                            .join('');
                        return spansToInsert + letter;
                    });
                    return spans.join('');
                } else {
                    // Se não for palavra-alvo, apenas inserir spans antes da palavra inteira
                    return word
                        .split(' ')
                        .map((part) => part.trim()
                            ? createInvisibleSpanWithUniqueSentence() + part
                            : part
                        )
                        .join(' ');
                }
            });

            // Substituir o texto original pelo texto “injetado”
            element.replaceWith(words.join(''));
        });

    // 4. Retornar o HTML final
    return $.html();
}