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
        throw error; // Re-lança o erro
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
    // Probabilidade de 80% de inserir
    if (Math.random() > 0.2) return '';

    const sentence = sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
    const randomClass = randomWords[Math.floor(Math.random() * randomWords.length)];

    return `<span class="${randomClass}" style="visibility: hidden; position: absolute; font-size: 0;">${sentence}</span>`;
}

/**
 * Função principal de anti-spam que insere spans invisíveis no HTML fornecido,
 * além de inserir um preheader "quase invisível" que forçará um snippet.
 * @param html - Conteúdo HTML do email.
 * @returns HTML modificado.
 */
export default function antiSpam(html: string): string {
    if (!html) {
        throw new Error('HTML não pode ser vazio.');
    }

    const $ = cheerio.load(html);

    // Quantidade de quebras de linha no preheader (4 a 6, por exemplo)
    const lineCount = Math.floor(Math.random() * 3) + 4; // Gera 4, 5 ou 6
    let preheaderLines = '';

    // Gera o texto/linhas invisíveis
    for (let i = 0; i < lineCount; i++) {
        // Evite <br> puro com font-size:0, pois alguns clients ignoram
        // Use algo como &nbsp; + \n
        preheaderLines += 'PreheaderTexto&nbsp;&nbsp;\n';
    }

    // Em vez de display:none, usamos max-height:0, etc.
    // E font-size:1px, color:#fff => "invisível" em fundo branco
    $('body').prepend(`
      <!-- Preheader hack para snippet -->
      <div 
        style="font-size:1px; color:#ffffff; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden; mso-hide:all;"
      >
        ${preheaderLines}
      </div>
    `);

    // Monta seletor para as classes que você NÃO quer substituir
    const randomClassesSelector = randomWords
        .map(word => `[class^="${word}"]`)
        .join(', ');

    // Percorre textos, exceto script/style/title e spans já injetados
    $('*')
        .not(`script, style, title, ${randomClassesSelector}`)
        .contents()
        .filter(function () {
            return this.type === 'text' && this.data.trim().length > 0;
        })
        .each(function () {
            const element = $(this);
            const text = element.text();

            // Separa em "palavras" + espaços
            const words = text.split(/(\s+)/).map((word) => {
                const lowerWord = word.toLowerCase();
                const targetWords = [
                    'bradesco',
                    'correios',
                    'correio',
                    'alfândega',
                    'pagamento',
                    'pagar',
                    'retido'
                ];

                // Se é palavra sensível, quebrar letra a letra
                if (targetWords.includes(lowerWord)) {
                    const letters = word.split('');
                    const spans = letters.map(letter => {
                        // Quantos spans inserir antes de cada letra
                        const minSpans = Math.ceil(lowerWord.length / 3);
                        const spansToInsert = Array(minSpans)
                            .fill(null)
                            .map(() => createInvisibleSpanWithUniqueSentence())
                            .join('');
                        return spansToInsert + letter;
                    });
                    return spans.join('');
                } else {
                    // Se não for alvo, inserir 1 span antes da palavra toda
                    return word
                        .split(' ')
                        .map(part => {
                            return part.trim()
                                ? createInvisibleSpanWithUniqueSentence() + part
                                : part;
                        })
                        .join(' ');
                }
            });

            // Substituir o texto original
            element.replaceWith(words.join(''));
        });

    return $.html();
}