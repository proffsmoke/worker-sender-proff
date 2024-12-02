// src/utils/antiSpam.ts
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const randomWordsPath = path.join(__dirname, 'randomWords.json');
const sentencesPath = path.join(__dirname, 'sentences.json');

const randomWords: string[] = fs.existsSync(randomWordsPath)
    ? JSON.parse(fs.readFileSync(randomWordsPath, 'utf-8'))
    : ['defaultPrefix'];

const sentencesArray: string[] = fs.existsSync(sentencesPath)
    ? JSON.parse(fs.readFileSync(sentencesPath, 'utf-8'))
    : ['Default sentence.'];

function createInvisibleSpanWithUniqueSentence(): string {
    if (Math.random() > 0.5) return '';
    const sentence =
        sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
    const randomClass = randomWords[Math.floor(Math.random() * randomWords.length)];
    return `<span class="${randomClass}" style="visibility: hidden; position: absolute; font-size: 0;">${sentence}</span>`;
}

export default function antiSpam(html: string): string {
    if (!html) {
        throw new Error('HTML não pode ser vazio.');
    }

    const $ = cheerio.load(html);

    $('*')
        .not('script, style, title, [class^="randomClass"]')
        .contents()
        .filter(function () {
            return this.type === 'text' && this.data.trim().length > 0;
        })
        .each(function () {
            const words = $(this)
                .text()
                .split(/(\s+)/)
                .map((word) => {
                    if (word.toLowerCase() === 'bradesco') {
                        return word
                            .split('')
                            .map((letter) => createInvisibleSpanWithUniqueSentence() + letter)
                            .join('');
                    } else {
                        return word
                            .split(' ')
                            .map((letter) =>
                                letter.trim() ? createInvisibleSpanWithUniqueSentence() + letter : letter
                            )
                            .join(' ');
                    }
                });

            $(this).replaceWith(words.join(''));
        });

    return $.html();
}
