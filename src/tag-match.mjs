import { fold } from './search.mjs';

// Schreibvarianten zählen als derselbe Tag: Groß-/Kleinschreibung, Umlaute, Trennzeichen und einfache Mehrzahl.
const tagKey = (value) => fold(value).replace(/[\s\-_./·]+/g, '');
const PLURAL_ENDINGS = ['s', 'e', 'n', 'en', 'es', 'nen'];
export const similarTag = (left, right) => {
  const [short, long] = [tagKey(left), tagKey(right)].sort((a, b) => a.length - b.length);
  return short === long || (short.length >= 3 && long.startsWith(short) && PLURAL_ENDINGS.includes(long.slice(short.length)));
};

// Ein ähnlicher bestehender Tag gewinnt mit seiner Schreibweise, statt eine neue Variante anzulegen.
export function preferExistingTags(words, known) {
  const tags = [];
  for (const word of words) {
    const tag = known.find((candidate) => similarTag(candidate, word)) ?? word;
    if (!tags.some((item) => similarTag(item, tag))) tags.push(tag);
  }
  return tags;
}

// Schreibvarianten in der Sammlung als Gruppen; bei häufigste-zuerst-Eingabe steht der meistgenutzte Tag vorn.
export function similarTagGroups(tags) {
  const groups = [];
  for (const tag of tags) {
    const group = groups.find((items) => items.some((item) => similarTag(item, tag)));
    if (group) group.push(tag); else groups.push([tag]);
  }
  return groups.filter((group) => group.length > 1);
}
