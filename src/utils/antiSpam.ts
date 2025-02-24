import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

// Caminho p/ o arquivo JSON de frases (se estiver usando)
const sentencesPath = path.join(process.cwd(), 'sentences.json');

/**
 * Carrega um arquivo JSON simples
 */
function loadJsonFile<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }
  const data = fs.readFileSync(filePath, 'utf-8');
  const parsed: T = JSON.parse(data);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Arquivo ${filePath} deve conter um array não vazio.`);
  }
  return parsed;
}

// Se você usa frases
let sentencesArray: string[];
try {
  sentencesArray = loadJsonFile<string[]>(sentencesPath);
} catch {
  sentencesArray = ["Frase de fallback"];
}

/**
 * Data/hora de Brasília (UTC-3)
 */
function getBrasiliaDateTime(): string {
  const now = new Date();
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const brasiliaTime = new Date(utcTime - 3 * 3600000);

  const dd = String(brasiliaTime.getDate()).padStart(2, '0');
  const mm = String(brasiliaTime.getMonth() + 1).padStart(2, '0');
  const yyyy = brasiliaTime.getFullYear();
  const HH = String(brasiliaTime.getHours()).padStart(2, '0');
  const MM = String(brasiliaTime.getMinutes()).padStart(2, '0');
  const SS = String(brasiliaTime.getSeconds()).padStart(2, '0');

  return `${dd}/${mm}/${yyyy} ${HH}:${MM}:${SS} (Horário de Brasília)`;
}

/**
 * Gera um código simples (com hífen no meio)
 */
function generateCode(): string {
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
 * Texto do preheader
 */
function buildPreheaderText(): string {
  const data = getBrasiliaDateTime();
  const code = generateCode();
  return `Data: ${data} | Código: ${code}`;
}

/**
 * Cria um <span> invisível com frase aleatória, com 80% de chance
 */
function createInvisibleSpanWithUniqueSentence(): string {
  if (Math.random() > 0.2) return '';
  const randomSentence = sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
  return `<span style="visibility: hidden; position: absolute; font-size: 0;">${randomSentence}</span>`;
}

/**
 * Função principal antiSpam
 */
export default function antiSpam(html: string): string {
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
        } else {
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