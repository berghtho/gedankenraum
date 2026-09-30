// Gemeinsame Helfer für Browser und Server: keine node:-Importe, kein DOM.

export const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
export const lower = (value) => String(value ?? '').toLocaleLowerCase('de-DE');
export const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
export const tagsOf = (idea) => Array.isArray(idea.tags) ? idea.tags : [];

// Als Link gilt nur http(s); alles andere bleibt Text.
export const webUrl = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
};
export const isWebUrl = (value) => !!webUrl(String(value ?? '').trim());
// Eine Eingabe ist ein Link, wenn sie allein aus einer lesbaren http(s)-Adresse besteht – im Browser wie im Server.
export const isLinkInput = (value) => /^https?:\/\/\S+$/i.test(String(value ?? '').trim()) && isWebUrl(value);

// Häufigkeit je Tag in Reihenfolge des ersten Auftretens; welche Gedanken zählen, entscheidet der Aufrufer.
export const tagCounts = (ideas) => {
  const counts = new Map();
  for (const idea of ideas) for (const tag of tagsOf(idea)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return counts;
};
// Häufig genutzte Tags zuerst; bei Gleichstand bleibt die Reihenfolge des ersten Auftretens.
export const byUse = (counts) => [...counts].sort(([, left], [, right]) => right - left);

export const REFLECTION_KINDS = {
  commonalities: 'Gemeinsamkeiten',
  contradictions: 'Widersprüche',
  questions: 'Offene Fragen',
};
