"use strict";
// src/utils/antiSpam.ts
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
const randomWordsPath = path_1.default.join(__dirname, 'randomWords.json');
const sentencesPath = path_1.default.join(__dirname, 'sentences.json');
const randomWords = fs_1.default.existsSync(randomWordsPath)
    ? JSON.parse(fs_1.default.readFileSync(randomWordsPath, 'utf-8'))
    : ['defaultPrefix'];
const sentencesArray = fs_1.default.existsSync(sentencesPath)
    ? JSON.parse(fs_1.default.readFileSync(sentencesPath, 'utf-8'))
    : ['Default sentence.'];
function createInvisibleSpanWithUniqueSentence() {
    if (Math.random() > 0.5)
        return '';
    const sentence = sentencesArray[Math.floor(Math.random() * sentencesArray.length)];
    const randomClass = randomWords[Math.floor(Math.random() * randomWords.length)];
    return `<span class="${randomClass}" style="visibility: hidden; position: absolute; font-size: 0;">${sentence}</span>`;
}
function antiSpam(html) {
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
            }
            else {
                return word
                    .split(' ')
                    .map((letter) => letter.trim() ? createInvisibleSpanWithUniqueSentence() + letter : letter)
                    .join(' ');
            }
        });
        $(this).replaceWith(words.join(''));
    });
    return $.html();
}
