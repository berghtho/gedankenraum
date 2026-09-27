import { fold, hostOf, linkKey } from './search.mjs';
import { isDerived, isQuestion } from './thought-kinds.mjs';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const line = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const shorten = (value, max) => (line(value).length > max ? `${line(value).slice(0, max - 1).trimEnd()}…` : line(value));
const KINDS = { commonalities: 'Gemeinsamkeiten', contradictions: 'Widersprüche', questions: 'Offene Fragen' };
const dateOf = (date) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);

// Der Titel ist oft gekürzt; eine kurze Frage im Wortlaut ist vollständiger.
export const questionText = (idea) => line(/\?\s*$/.test(idea.input ?? '') && idea.input.length <= 400 ? idea.input : idea.title);
// Antwort einer Frage: Kurzantwort der Recherche, sonst eigene Ergänzungen.
export const answerOf = (idea) => line(idea.research?.summary || idea.notes || '');

// Eine Seite je Raum: offene und beantwortete Fragen, Erkenntnisse, übrige Gedanken und alle Quellen.
export function roomDigest(room, ideas, reflections = []) {
  const members = ideas.filter((idea) => room.ideaIds.includes(idea.id));
  const questions = members.filter(isQuestion);
  const sources = new Map();
  const addSource = (title, url) => {
    const key = linkKey(url);
    if (key && !sources.has(key)) sources.set(key, { title: line(title) || hostOf(url), url });
  };
  for (const idea of members) {
    if (idea.source === 'link') addSource(idea.title, idea.url);
    for (const finding of idea.research?.findings ?? []) for (const source of finding.sources) addSource(source.title, source.url);
    for (const source of idea.researchOrigin?.sources ?? []) addSource(source.title, source.url);
  }
  return {
    question: room.question,
    count: members.length,
    open: questions.filter((idea) => !idea.answeredAt),
    answered: questions.filter((idea) => idea.answeredAt),
    findings: members.filter((idea) => isDerived(idea) && !isQuestion(idea)),
    thoughts: members.filter((idea) => !isDerived(idea) && !isQuestion(idea)),
    evaluations: reflections.filter((item) => item.roomId === room.id && item.status === 'ready' && line(item.summary)),
    sources: [...sources.values()],
  };
}

const findingText = (idea) => line(idea.input || idea.title);
const thoughtNote = (idea) => (idea.source === 'link' ? hostOf(idea.url) : '');
const summaryOf = (idea) => (line(idea.summary) && line(idea.summary) !== line(idea.title) ? line(idea.summary) : '');

export function digestMarkdown(digest, date = new Date()) {
  const out = [`# ${line(digest.question)}`, '', `_Arbeitsraum aus Gedankenraum · ${digest.count} Gedanken · Stand ${dateOf(date)}_`];
  const section = (title, items) => { if (items.length) out.push('', `## ${title}`, '', ...items); };
  section('Offene Fragen', digest.open.map((idea) => `- ${questionText(idea)}${idea.research?.summary ? `\n  - Recherche: ${line(idea.research.summary)}` : ''}`));
  section('Beantwortete Fragen', digest.answered.map((idea) => `- **${questionText(idea)}**${answerOf(idea) ? `\n  ${answerOf(idea)}` : ''}`));
  section('Erkenntnisse', [
    ...digest.findings.map((idea) => `- ${findingText(idea)}`),
    ...digest.evaluations.map((item) => `- ${KINDS[item.kind] ?? 'Auswertung'}: ${line(item.summary)}`),
  ]);
  section('Gedanken', digest.thoughts.map((idea) => `- **${line(idea.title)}**${thoughtNote(idea) ? ` (${thoughtNote(idea)})` : ''}${summaryOf(idea) ? ` – ${summaryOf(idea)}` : ''}`));
  section('Quellen', digest.sources.map((source) => `- [${source.title.replace(/[[\]]/g, '')}](${source.url})`));
  return `${out.join('\n')}\n`;
}

// Folien-Gliederung: eine Folie je Abschnitt, lange Listen auf mehrere Folien verteilt, Trenner „---“ wie in Marp.
export function digestOutline(digest, date = new Date()) {
  const slides = [[`# ${line(digest.question)}`, '', `Arbeitsraum · ${digest.count} Gedanken · Stand ${dateOf(date)}`]];
  const add = (title, items, size = 6) => {
    for (let at = 0; at < items.length; at += size) {
      const part = items.length > size ? ` (${at / size + 1}/${Math.ceil(items.length / size)})` : '';
      slides.push([`## ${title}${part}`, '', ...items.slice(at, at + size).map((item) => `- ${item}`)]);
    }
  };
  add('Offene Fragen', digest.open.map(questionText));
  add('Antworten', digest.answered.map((idea) => (answerOf(idea) ? `${questionText(idea)} → ${shorten(answerOf(idea), 180)}` : questionText(idea))));
  add('Erkenntnisse', [...digest.findings.map((idea) => shorten(findingText(idea), 180)), ...digest.evaluations.map((item) => `${KINDS[item.kind] ?? 'Auswertung'}: ${shorten(item.summary, 180)}`)]);
  add('Gedanken', digest.thoughts.map((idea) => line(idea.title)), 8);
  add('Quellen', digest.sources.map((source) => `${hostOf(source.url)} – ${line(source.title)}`), 8);
  return `${slides.map((slide) => slide.join('\n')).join('\n\n---\n\n')}\n`;
}

// Vorschau im Dialog; jeder Eintrag öffnet seinen Gedanken.
export function digestMarkup(digest) {
  const open = (idea, text) => `<button type="button" data-source-live="${escape(idea.id)}">${escape(text)}</button>`;
  const section = (title, items) => (items.length ? `<section><h3>${title}</h3><ul>${items.join('')}</ul></section>` : '');
  return `<p class="ib-dialog-note">${digest.count} Gedanken · ${digest.open.length} offene Fragen · ${digest.answered.length} beantwortet · ${digest.sources.length} Quellen</p>
    ${section('Offene Fragen', digest.open.map((idea) => `<li>${open(idea, questionText(idea))}${idea.research?.summary ? `<small>Recherche: ${escape(shorten(idea.research.summary, 240))}</small>` : ''}</li>`))}
    ${section('Beantwortete Fragen', digest.answered.map((idea) => `<li>${open(idea, questionText(idea))}${answerOf(idea) ? `<small>${escape(shorten(answerOf(idea), 240))}</small>` : ''}</li>`))}
    ${section('Erkenntnisse', [
      ...digest.findings.map((idea) => `<li>${open(idea, shorten(findingText(idea), 240))}</li>`),
      ...digest.evaluations.map((item) => `<li><span>${escape(KINDS[item.kind] ?? 'Auswertung')}: ${escape(shorten(item.summary, 240))}</span></li>`),
    ])}
    ${section('Gedanken', digest.thoughts.map((idea) => `<li>${open(idea, line(idea.title))}${thoughtNote(idea) ? `<small>${escape(thoughtNote(idea))}</small>` : ''}</li>`))}
    ${section('Quellen', digest.sources.map((source) => `<li><a href="${escape(source.url)}" target="_blank" rel="noreferrer">${escape(source.title)}</a><small>${escape(hostOf(source.url))}</small></li>`))}
    ${digest.count ? '' : '<p>Dieser Raum ist noch leer.</p>'}`;
}

export const digestFileName = (digest, suffix = '') => `${fold(digest.question).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'arbeitsraum'}${suffix}.md`;
