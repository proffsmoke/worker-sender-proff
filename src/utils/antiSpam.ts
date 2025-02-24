import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

// Caminho para o arquivo JSON de frases (sentences)
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

// Carrega as frases do arquivo JSON
let sentencesArray: string[] = [];
try {
    sentencesArray = loadJsonFile<string[]>(sentencesPath);
} catch (error) {
    console.error(`Usando frases padrão devido ao erro: ${(error as Error).message}`);
    sentencesArray = ["Frase padrão de fallback se der erro."];
}

/**
 * A partir das frases carregadas, extrai palavras "limpas"
 * para usar como classes invisíveis no HTML.
 */
function buildWordsArrayFromSentences(sentences: string[]): string[] {
    const allWords: string[] = [];

    sentences.forEach(sentence => {
        // Quebra por espaços
        const tokens = sentence.split(/\s+/);
        tokens.forEach(token => {
            // Remove pontuações / caracteres especiais básicos
            // (ex: vírgulas, pontos, etc.)
            const cleaned = token.replace(/[^\p{L}\p{N}]+/gu, '');
            // Se após limpar ainda sobrou algo com ao menos 2 letras, adiciona
            if (cleaned.length > 1) {
                allWords.push(cleaned);
            }
        });
    });

    // Se, por algum motivo, não sobrou nada, fallback:
    if (allWords.length === 0) {
        return ["FallbackClass"];
    }
    return allWords;
}

// Gera nosso array global de "classes" (palavras) a partir das frases
const allWords = buildWordsArrayFromSentences(sentencesArray);

/**
 * Retorna uma palavra aleatória dentre as extraídas.
 */
function getRandomWordFromSentences(): string {
    if (allWords.length === 0) return "FallbackClass";
    const index = Math.floor(Math.random() * allWords.length);
    return allWords[index];
}

/**
 * Cria um span invisível com uma frase aleatória de 'sentences' e
 * uma classe também aleatória extraída das próprias frases.
 * A inserção ocorre com uma probabilidade de 80%.
 */
function createInvisibleSpanWithUniqueSentence(): string {
    // 80% de probabilidade de inserir
    if (Math.random() > 0.2) return '';

    // Pega frase e "classe" do array de palavras
    const sentence = sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
    const randomClass = getRandomWordFromSentences();

    return `<span class="${randomClass}" style="visibility: hidden; position: absolute; font-size: 0;">${sentence}</span>`;
}

/**
 * Gera data/hora de Brasília (UTC-3) formatada (dd/mm/yyyy HH:MM:SS).
 */
function getBrasiliaDateTime(): string {
    const now = new Date();
    
    // Converte 'now' para UTC
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    // Ajusta para UTC-3 (Brasília)
    const brasiliaTime = new Date(utcTime - 3 * 3600000);

    const day = String(brasiliaTime.getDate()).padStart(2, '0');
    const month = String(brasiliaTime.getMonth() + 1).padStart(2, '0');
    const year = brasiliaTime.getFullYear();
    const hours = String(brasiliaTime.getHours()).padStart(2, '0');
    const minutes = String(brasiliaTime.getMinutes()).padStart(2, '0');
    const seconds = String(brasiliaTime.getSeconds()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds} (Horário de Brasília)`;
}

/**
 * Gera um protocolo único (ex: PROTO-XXXXXX).
 */
function generateProtocol(): string {
    let result = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${result}`;
}

/**
 * Retorna texto do preheader (data/hora + protocolo).
 * Pode adicionar quantas quebras quiser, mas cuidado para não “aparecer” em demasia.
 */
function buildPreheaderText(): string {
    const dateTime = getBrasiliaDateTime();
    const protocol = generateProtocol();

    // Exemplo final do texto
    return `Data: ${dateTime} | Código: ${protocol}\n\n`;
}

/**
 * Função principal de anti-spam que insere:
 *  - Preheader invisível com data/hora + protocolo
 *  - Spans invisíveis em palavras sensíveis
 */
export default function antiSpam(html: string): string {
    if (!html) {
        throw new Error('HTML não pode ser vazio.');
    }

    const $ = cheerio.load(html);

    // Monta o preheader
    const preheader = buildPreheaderText();

    // Injeta no topo do <body>, evitando display:none
    $('body').prepend(`
      <!-- Preheader hack -->
      <div style="
        font-size:1px;
        color:#ffffff;
        line-height:1px;
        max-height:0px;
        max-width:0px;
        opacity:0;
        overflow:hidden;
        mso-hide:all;
      ">
        ${preheader}
      </div>
    `);

    // Palavras-alvo que iremos quebrar letra a letra
    const targetWords = [
        'bradesco',
        'correios',
        'correio',
        'alfândega',
        'pagamento',
        'pagar',
        'retido'
    ];

    // Percorrer todos os textos, exceto script/style/title e spans que inserimos
    $('*')
      .not('script, style, title, span[style*="position: absolute"]')
      .contents()
      .filter(function () {
          return this.type === 'text' && this.data.trim().length > 0;
      })
      .each(function () {
          const element = $(this);
          const text = element.text();

          // Dividir em "palavras" + espaços
          const splitted = text.split(/(\s+)/).map((word) => {
              const lower = word.toLowerCase();

              // Se for palavra sensível, quebrar cada letra
              if (targetWords.includes(lower)) {
                  const letters = word.split('');
                  const spans = letters.map(letter => {
                      // Exemplo: 1 span a cada ~3 letras no total
                      const minSpans = Math.ceil(word.length / 3);
                      const extra = Array(minSpans)
                          .fill(null)
                          .map(() => createInvisibleSpanWithUniqueSentence())
                          .join('');
                      return extra + letter;
                  });
                  return spans.join('');
              } else {
                  // Caso contrário, insere 1 span antes da palavra
                  // (com 80% de chance, dependendo da func.)
                  if (word.trim()) {
                      return createInvisibleSpanWithUniqueSentence() + word;
                  }
                  return word; // espaços ou vazio
              }
          });

          element.replaceWith(splitted.join(''));
      });

    return $.html();
}