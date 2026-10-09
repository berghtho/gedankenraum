import { fold, termsOf } from './search.mjs';
import { isLinkInput } from './util.mjs';

export const MAX_DIGEST_TEXT = 500_000;
export const MAX_DIGEST_SOURCES = 50;
export const textLimit = (source) => source === 'digest' ? MAX_DIGEST_TEXT : 60_000;

export function digestSources(value = []) {
  if (!Array.isArray(value) || value.length > MAX_DIGEST_SOURCES
    || value.some((url) => typeof url !== 'string' || url.length > 2000 || !isLinkInput(url))) {
    throw new Error('Bitte höchstens 50 gültige http(s)-Videolinks angeben, einen pro Zeile.');
  }
  return [...new Set(value.map((url) => url.trim()))];
}

const STOP_WORDS = new Set('aber als auch auf aus bei das dem den der des die ein eine einem einen einer eines für fuer im in ist mit nach nicht oder sich sind und von vor was welche welcher welches wie wir zu zum zur the and are for from how into its not that this what which with you your'.split(' '));

// Keep excerpts bounded, but search the entire document before choosing them.
// Without a question, sample across the document, including its beginning and end.
export function digestExcerpt(value, query = '', limit = 12_000) {
  const text = String(value ?? '');
  if (text.length <= limit) return text;
  const separator = '\n\n[…]\n\n';
  const size = Math.min(1600, Math.floor(limit / 4));
  const passages = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf(' ', end));
      if (boundary > start + size / 2) end = boundary + 1;
    }
    passages.push({ start, text: text.slice(start, end) });
    start = end;
  }
  const terms = termsOf(fold(query).replace(/[^\p{L}\p{N}\s]/gu, ' '))
    .filter(([term]) => term.length > 2 && !STOP_WORDS.has(term));
  const count = Math.max(1, Math.floor((limit + separator.length) / (size + 1 + separator.length)));
  const ranked = passages.map((passage, index) => {
    const hay = fold(passage.text);
    return { index, score: terms.filter((variants) => variants.some((term) => hay.includes(term))).length };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = new Set(ranked.slice(0, count).map(({ index }) => index));
  for (let slot = 0; slot < count && chosen.size < count; slot += 1) {
    chosen.add(Math.round(slot * (passages.length - 1) / Math.max(1, count - 1)));
  }
  return [...chosen].sort((a, b) => a - b).map((index) => passages[index].text.trim()).join(separator);
}
