import { isDeepStrictEqual } from 'node:util';

// Dreiwege-Zusammenführung zweier Stände von ideas.json mit ihrem gemeinsamen Vorgänger, ohne Textmerge:
// Was nur eine Seite geändert hat, gilt. Listen mit ids (Gedanken, Räume, Auswertungen) werden Eintrag für
// Eintrag zusammengeführt, Einträge und Objekte Feld für Feld. Haben beide Seiten dasselbe Feld geändert,
// gilt der Eintrag mit dem neueren updatedAt, sonst die lokale Seite.
const same = isDeepStrictEqual;
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const keyed = (value) => Array.isArray(value) && value.every((item) => isObject(item) && typeof item.id === 'string');

const byId = (items) => {
  const map = new Map();
  for (const item of items) if (!map.has(item.id)) map.set(item.id, item);
  return map;
};

function mergeValue(base, ours, theirs, prefer) {
  if (same(ours, base)) return theirs;
  if (same(theirs, base) || same(ours, theirs)) return ours;
  if (keyed(ours) && keyed(theirs)) return mergeList(keyed(base) ? base : [], ours, theirs);
  if (isObject(base) && isObject(ours) && isObject(theirs)) return mergeObject(base, ours, theirs, prefer);
  return prefer === 'theirs' ? theirs : ours;
}

function mergeObject(base, ours, theirs, prefer) {
  const result = {};
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const value = mergeValue(base?.[key], ours[key], theirs[key], prefer);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function mergeEntry(base, ours, theirs) {
  const prefer = String(theirs.updatedAt ?? '') > String(ours.updatedAt ?? '') ? 'theirs' : 'ours';
  if (!isObject(base)) return mergeValue(undefined, ours, theirs, prefer);
  return mergeObject(base, ours, theirs, prefer);
}

function mergeList(base, ours, theirs) {
  const [was, mine, other] = [base, ours, theirs].map(byId);
  // Lokale Reihenfolge; nur im Remote neue Einträge stehen vor ihrem dortigen Nachfolger (neue Gedanken vorne).
  const order = [...mine.keys()];
  theirs.forEach((item, index) => {
    if (mine.has(item.id) || order.includes(item.id)) return;
    const next = theirs.slice(index + 1).find((later) => order.includes(later.id));
    order.splice(next ? order.indexOf(next.id) : order.length, 0, item.id);
  });
  return order.flatMap((id) => {
    if (mine.has(id) && other.has(id)) return [mergeEntry(was.get(id), mine.get(id), other.get(id))];
    const kept = mine.get(id) ?? other.get(id);
    // Auf der anderen Seite entfernt: bleibt nur, wenn diese Seite ihn seitdem geändert hat.
    return was.has(id) && same(kept, was.get(id)) ? [] : [kept];
  });
}

export function mergeStates(base, ours, theirs) {
  return mergeObject(isObject(base) ? base : {}, ours, theirs, 'ours');
}
