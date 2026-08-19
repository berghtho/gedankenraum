const STOP_WORDS = new Set([
  'aber', 'alle', 'auch', 'auf', 'aus', 'bei', 'das', 'dass', 'dem', 'den', 'der', 'des', 'die',
  'ein', 'eine', 'einer', 'eines', 'für', 'hat', 'hier', 'ist', 'mit', 'nicht', 'oder', 'sich',
  'sind', 'und', 'vom', 'von', 'was', 'werden', 'wie', 'wird', 'zum', 'zur', 'the', 'and', 'for',
  'from', 'that', 'this', 'with', 'you', 'your',
]);

const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const words = (value, minimumLength = 3) => (compact(value).toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? [])
  .filter((word) => word.length >= minimumLength);

function sentences(value) {
  const text = compact(value).slice(0, 24_000);
  const parts = text.match(/[^.!?]+(?:[.!?]+|$)/g)?.map(compact).filter((part) => part.length > 20) ?? [];
  return [...new Set(parts)];
}

function keywordsFor(value) {
  const frequency = new Map();
  for (const word of words(value)) {
    if (STOP_WORDS.has(word) || /^\d+$/.test(word)) continue;
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }
  return [...frequency]
    .sort(([leftWord, leftCount], [rightWord, rightCount]) => rightCount - leftCount || rightWord.length - leftWord.length)
    .slice(0, 6)
    .map(([word]) => word);
}

function topicFor(text, existingTopics) {
  const sourceWords = new Set(words(text, 2));
  let best = null;
  for (const topic of existingTopics) {
    const score = words(topic, 2).filter((word) => sourceWords.has(word)).length;
    if (score && (!best || score > best.score)) best = { topic, score };
  }
  return best?.topic ?? 'Unsortiert';
}

export function createLocalAnalyzer() {
  return {
    async status() {
      return { available: true, engine: 'Lokale Analyse' };
    },
    async analyze({ input, source, existingTopics }) {
      const text = compact(source.text || input);
      const parts = sentences(text);
      const title = compact(source.pageTitle) || parts[0]?.replace(/[.!?]+$/, '').slice(0, 90) || text.slice(0, 90);
      const summary = parts.slice(0, 3).join(' ').slice(0, 1_200) || text.slice(0, 1_200);
      const keyPoints = parts.slice(1, 5).map((part) => part.slice(0, 240));
      return {
        analysis: {
          title,
          summary,
          keyPoints,
          keywords: keywordsFor(`${title} ${text}`),
          topic: topicFor(`${title} ${text}`, existingTopics),
        },
        engine: 'Lokale Analyse',
      };
    },
  };
}
