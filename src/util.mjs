// Gemeinsame Helfer für Browser und Server: keine node:-Importe, kein DOM.

export const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
export const lower = (value) => String(value ?? '').toLocaleLowerCase('de-DE');
export const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
export const tagsOf = (idea) => Array.isArray(idea.tags) ? idea.tags : [];

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
