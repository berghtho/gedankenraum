// Reine Textsuche für den Gedankenraum: Umlaute und ß werden gefaltet, jeder Suchbegriff
// muss vorkommen (Reihenfolge egal), Treffer lassen sich im Originaltext markieren.

const stripMarks = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');

export const fold = (value) => stripMarks(String(value ?? '').toLocaleLowerCase('de-DE'));

// "huette" soll "Hütte" treffen, obwohl die Faltung "hutte" ergibt.
export const variantsOf = (term) => [...new Set([term, term.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')])];

export const termsOf = (query) => [...new Set(fold(query).split(/\s+/).filter(Boolean))].map(variantsOf);

export const matches = (folded, terms) => terms.every((variants) => variants.some((variant) => folded.includes(variant)));

// Gefalteter Text plus Abbildung jeder gefalteten Position auf den Originalindex.
export function foldMap(text) {
  const raw = String(text ?? '');
  const idx = [];
  let folded = '';
  for (let i = 0; i < raw.length;) {
    const length = raw.codePointAt(i) > 0xffff ? 2 : 1;
    const part = fold(raw.slice(i, i + length));
    for (let k = 0; k < part.length; k += 1) idx.push(i);
    folded += part;
    i += length;
  }
  idx.push(raw.length);
  return { folded, idx };
}

// Zusammengefasste Trefferbereiche [start, end) im Originaltext, nach Position sortiert.
export const hitsIn = (text, terms, limit = 40) => hitsInMap(foldMap(text), terms, limit);

// Dasselbe auf einer bereits gefalteten Abbildung, damit lange Texte nicht bei jedem Tastendruck neu gefaltet werden.
export function hitsInMap({ folded, idx }, terms, limit = 40) {
  if (!terms.length) return [];
  const ranges = [];
  for (const variants of terms) for (const variant of variants) {
    if (!variant) continue;
    let at = folded.indexOf(variant);
    let found = 0;
    while (at !== -1 && found < limit) {
      const foldedEnd = at + variant.length;
      let j = foldedEnd;
      while (j < idx.length - 1 && idx[j] <= idx[foldedEnd - 1]) j += 1;
      ranges.push({ start: idx[at], end: idx[j] });
      found += 1;
      at = folded.indexOf(variant, at + 1);
    }
  }
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function markText(text, terms, escape, className = 'ib-hit') {
  const raw = String(text ?? '');
  const hits = hitsIn(raw, terms);
  if (!hits.length) return escape(raw);
  let out = '';
  let cursor = 0;
  for (const { start, end } of hits) {
    out += `${escape(raw.slice(cursor, start))}<mark class="${className}">${escape(raw.slice(start, end))}</mark>`;
    cursor = end;
  }
  return out + escape(raw.slice(cursor));
}

// Ausschnitt um einen Treffer: beginnt an einer Wortgrenze, endet an einer Wortgrenze.
export function windowAround(text, hit, { before = 60, length = 220 } = {}) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!hit) return { text: raw.length > length ? `${raw.slice(0, raw.lastIndexOf(' ', length) > 0 ? raw.lastIndexOf(' ', length) : length)} …` : raw, start: 0 };
  let start = hit.start <= before ? 0 : raw.lastIndexOf(' ', hit.start - before) + 1;
  if (start < 0) start = 0;
  let end = Math.min(raw.length, Math.max(start + length, hit.end));
  if (end < raw.length) {
    const boundary = raw.lastIndexOf(' ', end);
    if (boundary > hit.end) end = boundary;
  }
  return { text: `${start > 0 ? '… ' : ''}${raw.slice(start, end)}${end < raw.length ? ' …' : ''}`, start };
}

// Titel > Tags/Schlagwörter > Zusammenfassung; jeder Begriff zählt einmal mit seinem besten Feld.
export function scoreOf({ title = '', tags = '', summary = '' }, terms) {
  let score = 0;
  for (const variants of terms) {
    const inField = (field) => variants.some((variant) => field.includes(variant));
    if (inField(title)) score += 3;
    else if (inField(tags)) score += 2;
    else if (inField(summary)) score += 1;
  }
  return score;
}

// Entfernt einen Titel, der den Text einleitet, ohne mitten im Wort abzuschneiden.
export function stripTitle(text, title) {
  const raw = String(text ?? '');
  const clean = fold(String(title ?? '').replace(/[.!?…:]+$/, '').trim());
  if (!clean) return raw;
  const { folded, idx } = foldMap(raw);
  if (!folded.startsWith(clean)) return raw;
  let cut = idx[clean.length];
  if (cut < raw.length && !/[\s.!?…:;,]/.test(raw[cut])) cut = raw.lastIndexOf(' ', cut) + 1;
  return raw.slice(cut).replace(/^[\s.!?:;…]+/, '');
}

export const startsWithTitle = (text, title) => {
  const clean = fold(String(title ?? '').replace(/[.!?…:]+$/, '').trim());
  return !!clean && fold(text).startsWith(clean);
};

export const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url ?? ''); }
};

export const pathOf = (url) => {
  try { const parsed = new URL(url); const path = `${parsed.pathname}${parsed.search}`; return path === '/' ? '' : path; } catch { return ''; }
};
