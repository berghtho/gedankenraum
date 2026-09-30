import { layoutMindmap, mindmapMarkup, relationLabels, topicColor } from './mindmap.mjs';
import { connectionsMarkup, initThinkingTools } from './thinking-tools.mjs';
import { initWorkspaces } from './workspace-ui.mjs';
import { initInlineThought } from './inline-thought.mjs';
import { initTagCleanup } from './tag-cleanup.mjs';
import { fold, foldMap, hitsIn, hitsInMap, hostOf, isWebUrl, linkKey, markText, matches, pathOf, scoreOf, startsWithTitle, stripTitle, termsOf, topicMatcher, variantsOf, windowAround } from './search.mjs';
import { isDerived, isQuestion } from './thought-kinds.mjs';
const VIEW_KEY = 'gedankenraum.view';
const RAIL_KEY = 'gedankenraum.rail';
const RAIL_SECTIONS = ['rooms', 'questions', 'tags', 'topics'];
const CAPTURE_PLACEHOLDER = 'Ein Gedanke, ein Link, ein Anfang … ( n )';

const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const lower = (value) => String(value ?? '').toLocaleLowerCase('de-DE');
const shorten = (value, max) => (String(value ?? '').length > max ? `${String(value).slice(0, max - 1).trimEnd()}…` : String(value ?? ''));

const relativeDate = (value) => {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  if (minutes < 1_440) return `vor ${Math.floor(minutes / 60)} Std.`;
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short' }).format(new Date(value));
};
const dayLabel = (value) => {
  const date = new Date(value);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.floor((today - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return 'HEUTE';
  if (days === 1) return 'GESTERN';
  const format = today.getFullYear() === date.getFullYear()
    ? { day: '2-digit', month: 'short' }
    : { day: '2-digit', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat('de-DE', format).format(date).toUpperCase();
};

const isLink = (value) => /^https?:\/\/\S+$/i.test(value.trim());
const sourceLabel = (source) => ({ link: 'LINK', text: 'TEXT' })[source] ?? 'NOTIZ';
const kindLabel = (source) => (source === 'link' ? 'LINK' : 'NOTIZ');
const tagsOf = (idea) => Array.isArray(idea.tags) ? idea.tags : [];
const questionLabel = (idea) => (isQuestion(idea) ? (idea.answeredAt ? 'Beantwortet' : 'Offene Frage') : null);
const suggestionsOf = (idea) => {
  const have = new Set(tagsOf(idea).map(lower));
  return (idea.keywords ?? []).filter((word) => !have.has(lower(word)));
};
const paragraphsOf = (idea) => (idea.input ?? '').split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
// Der Wortlaut ohne Titelzeile wird je Gedanke nur einmal gefaltet; jeder Snapshot bringt neue Objekte.
const bodyCache = new WeakMap();
const bodyInfoOf = (idea) => {
  let info = bodyCache.get(idea);
  if (!info) {
    const text = (idea.source === 'link' ? idea.summary ?? '' : stripTitle(idea.input ?? '', idea.title)).replace(/\s+/g, ' ').trim();
    info = { text, map: foldMap(text) };
    bodyCache.set(idea, info);
  }
  return info;
};
const excerptOf = (idea) => windowAround(bodyInfoOf(idea).text || idea.summary || '', null, { length: 200 }).text;
const anyHit = (text, terms) => terms.some((variants) => variants.some((variant) => fold(text).includes(variant)));
const focusKeyOf = (node) => [node.tagName, ...[...node.attributes].filter((attr) => attr.name.startsWith('data-') || attr.name === 'name').map((attr) => `${attr.name}=${attr.value}`), node.textContent.trim().slice(0, 40)].join('|');

// Bei einer Suche zeigt die Karte die Stelle, an der es passt, statt immer den Anfang.
function snippetOf(idea, terms) {
  if (!terms.length) return { text: excerptOf(idea), hint: '', hit: false };
  const body = bodyInfoOf(idea);
  const [bodyHit] = hitsInMap(body.map, terms, 1);
  if (bodyHit) return { text: windowAround(body.text, bodyHit).text, hint: '', hit: true };
  for (const [text, hint] of [[idea.notes, 'Treffer in Ergänzung'], [idea.summary, 'Treffer in Zusammenfassung']]) {
    if (!text) continue;
    const collapsed = text.replace(/\s+/g, ' ').trim();
    const [hit] = hitsIn(collapsed, terms, 1);
    if (hit) return { text: windowAround(collapsed, hit).text, hint, hit: true };
  }
  const tag = tagsOf(idea).find((candidate) => anyHit(candidate, terms));
  const keyword = tag ? null : (idea.keywords ?? []).find((candidate) => anyHit(candidate, terms));
  const hint = tag ? `Treffer in Tag #${tag}` : keyword ? `Treffer in Schlagwort „${keyword}“` : anyHit(idea.topic, terms) ? `Treffer in Thema „${idea.topic}“` : '';
  return { text: excerptOf(idea), hint, hit: false };
}

const rowTags = (idea) => {
  const tags = tagsOf(idea);
  if (!tags.length) return '';
  const rest = tags.length > 1 ? ` +${tags.length - 1}` : '';
  return `<span class="ib-row-meta" title="${html(tags.map((tag) => `#${tag}`).join(' '))}">#${html(tags[0])}${rest}</span>`;
};
const rowMarkup = (idea, selectedId, { color = null, meta = null, terms = [], tags = false } = {}) => {
  const snippet = snippetOf(idea, terms);
  const selected = idea.id === selectedId;
  return `<article class="ib-thought-card"><button class="ib-row${selected ? ' is-selected' : ''}${snippet.hit ? ' has-hit' : ''}${isDerived(idea) ? ' is-derived' : ''}" type="button" data-idea-id="${html(idea.id)}"${selected ? ' aria-current="true"' : ''}>
  ${color ? `<span class="ib-topic-dot" style="background:${color}"></span>` : ''}
  <span class="ib-row-title">${markText(idea.title, terms, html)}</span>
  ${snippet.text ? `<span class="ib-row-excerpt">${markText(snippet.text, terms, html)}</span>` : ''}
  ${snippet.hint ? `<span class="ib-row-hint">${html(snippet.hint)}</span>` : ''}
  ${idea.analysisState === 'pending' ? '<span class="ib-analysis-badge">Analyse läuft …</span>' : idea.analysisState === 'failed' ? '<span class="ib-analysis-badge is-error">Analyse fehlgeschlagen</span>' : ''}
  ${tags ? rowTags(idea) : ''}
  ${meta === null ? '' : `<span class="ib-row-meta">${html(meta)}</span>`}
</button></article>`;
};

function emptyMarkup(hasFilter, hasIdeas, room, query) {
  if (room && !hasFilter) return `<div class="ib-empty-map"><div><span>DEIN ARBEITSRAUM</span><h3>Welche Gedanken helfen bei dieser Frage?</h3><p>Unten losschreiben. Bestehende Gedanken findest du unter „Sammlung“.</p></div></div>`;
  if (!hasIdeas) return `<div class="ib-empty-map"><div><span>NOCH ZIEMLICH RUHIG HIER</span><h3>Der erste Gedanke macht den Anfang.</h3>
    <p>Ein Satz reicht. Unten losschreiben oder einen Link ablegen.</p></div></div>`;
  return `<div class="ib-empty-map"><div><span>NICHTS GEFUNDEN</span><h3>${query ? `Kein Gedanke passt zu „${html(query)}“.` : 'Kein Gedanke passt zu diesem Filter.'}</h3>
    <p>${query ? 'Titel, Wortlaut, Ergänzungen und Tags der ganzen Sammlung wurden durchsucht.' : 'Tag oder Thema abwählen.'}</p>
    <p><button class="ib-small-btn" type="button" data-idea-filter-clear="all">FILTER AUFHEBEN</button></p></div></div>`;
}

const outsideRoom = (idea, room) => !!room && !room.ideaIds.includes(idea.id);
function listMarkup(ideas, selectedId, terms, room) {
  return `<div class="ib-thought-cards">${ideas.map((idea) => rowMarkup(idea, selectedId, {
    terms,
    meta: [outsideRoom(idea, room) ? 'nicht im Raum' : null, isDerived(idea) ? 'KI-Vorschlag' : null, questionLabel(idea), idea.source === 'link' ? hostOf(idea.url) : null, relativeDate(idea.createdAt)].filter(Boolean).join(' · '),
  })).join('')}</div>`;
}

function timelineMarkup(ideas, selectedId, colorFor, terms, room) {
  const sorted = [...ideas].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const days = new Map();
  for (const idea of sorted) {
    const label = dayLabel(idea.createdAt);
    if (!days.has(label)) days.set(label, []);
    days.get(label).push(idea);
  }
  return [...days].map(([label, entries]) => `<div class="ib-day">
    <div class="ib-day-label">${html(label)}</div>
    <div class="ib-day-rows">${entries.map((idea) => rowMarkup(idea, selectedId, {
      color: colorFor(idea.topic), terms, tags: true,
      meta: [outsideRoom(idea, room) ? 'nicht im Raum' : null, idea.source === 'link' ? hostOf(idea.url) : isDerived(idea) ? 'KI-VORSCHLAG' : sourceLabel(idea.source), questionLabel(idea)?.toLocaleUpperCase('de-DE')].filter(Boolean).join(' · '),
    })).join('')}</div>
  </div>`).join('');
}

// Jede Gruppe der Sammlung lässt sich über ihre Überschrift einklappen, damit lange Tag-Listen nicht alles verdecken.
const railSection = (key, title, count, items, collapsed) => `<section class="ib-rail-section">
  <button class="ib-rail-head" type="button" data-rail-toggle="${key}" aria-expanded="${!collapsed}" aria-controls="rail-${key}"><span class="ib-rail-title">${title}</span><span class="ib-rail-count">${count}</span></button>
  <div class="ib-rail-items" id="rail-${key}"${collapsed ? ' hidden' : ''}>${items}</div>
</section>`;

function railMarkup(ideas, filter, colorFor, collapsed) {
  const tagCount = new Map();
  const topicCount = new Map();
  for (const idea of ideas) {
    topicCount.set(idea.topic, (topicCount.get(idea.topic) ?? 0) + 1);
    for (const tag of tagsOf(idea)) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
  }
  const tags = [...tagCount].sort(([leftTag, leftCount], [rightTag, rightCount]) => rightCount - leftCount || leftTag.localeCompare(rightTag, 'de'));
  const tagItems = tags.length ? tags.map(([tag, count]) => {
    const active = filter.tag === tag;
    return `<div class="ib-rail-item${active ? ' is-active' : ''}">
      <button type="button" data-idea-tag-filter="${html(tag)}"><span class="ib-rail-name">#${html(tag)}</span><span class="ib-rail-n">${count}</span></button>
      ${active ? `<button class="ib-rail-more" type="button" data-idea-tag-edit="${html(tag)}" title="Umbenennen oder zusammenlegen">⋯</button>` : ''}
    </div>`;
  }).join('') + (tags.length > 1 ? '<button class="ib-rail-action" type="button" data-tags-cleanup>Tags aufräumen …</button>' : '') : '<div class="ib-rail-empty">Noch keine Tags. Vorschläge erscheinen unter „Mehr“ in einem Gedanken.</div>';
  const topicItems = [...topicCount].map(([topic, count]) => `<div class="ib-rail-item${filter.topic === topic ? ' is-active' : ''}">
    <button type="button" data-idea-topic-filter="${html(topic)}"><span class="ib-topic-dot" style="background:${colorFor(topic)}"></span><span class="ib-rail-name">${html(topic)}</span><span class="ib-rail-n">${count}</span></button>
  </div>`).join('');
  // Offene Fragen im Blick behalten: im Raum zählen nur seine Fragen.
  const questions = ideas.filter(isQuestion);
  const open = questions.filter((idea) => !idea.answeredAt).length;
  const questionItems = [['open', 'Offen', open], ['answered', 'Beantwortet', questions.length - open]].map(([key, label, count]) => `<div class="ib-rail-item${filter.question === key ? ' is-active' : ''}">
    <button type="button" data-idea-question-filter="${key}"><span class="ib-rail-name">${label}</span><span class="ib-rail-n">${count}</span></button>
  </div>`).join('');
  return (questions.length ? railSection('questions', 'FRAGEN', open, questionItems, collapsed.has('questions')) : '')
    + railSection('tags', 'TAGS', tags.length, tagItems, collapsed.has('tags'))
    + railSection('topics', 'THEMEN', topicCount.size, topicItems, collapsed.has('topics'));
}

function filterMarkup(filter, visibleCount, outsideCount) {
  const chips = [];
  if (filter.tag) chips.push(`<button class="ib-filter-chip" type="button" data-idea-filter-clear="tag">#${html(filter.tag)} <span>✕</span></button>`);
  if (filter.topic) chips.push(`<button class="ib-filter-chip" type="button" data-idea-filter-clear="topic">${html(filter.topic)} <span>✕</span></button>`);
  if (filter.question) chips.push(`<button class="ib-filter-chip" type="button" data-idea-filter-clear="question">${filter.question === 'open' ? 'Offene Fragen' : 'Beantwortete Fragen'} <span>✕</span></button>`);
  if (filter.query) chips.push(`<button class="ib-filter-chip" type="button" data-idea-filter-clear="query">„${html(filter.query)}“ <span>✕</span></button>`);
  const note = `${visibleCount} Treffer${outsideCount ? ` · ${outsideCount} nicht im Raum` : ''}`;
  return `<div class="ib-filter"><span>FILTER</span>${chips.join('')}<span class="ib-filter-note">${html(note)}</span></div>`;
}

function tagEditorMarkup(idea) {
  const chips = tagsOf(idea).map((tag) => `<button class="ib-tag-chip" type="button" data-idea-tag-filter="${html(tag)}" title="Nach #${html(tag)} filtern">#${html(tag)}<i data-idea-tag-remove="${html(tag)}" title="Tag entfernen">✕</i></button>`);
  const suggestions = suggestionsOf(idea).map((word) => `<button class="ib-tag-suggest" type="button" data-idea-tag-accept="${html(word)}" title="Vorschlag der Analyse – zum Übernehmen klicken">+ ${html(word)}</button>`);
  const all = suggestions.length > 1 ? '<button class="ib-tag-add" type="button" data-idea-tag-accept-all>ALLE ÜBERNEHMEN</button>' : '';
  return `<span class="ib-meta-tags">${chips.join('')}${suggestions.join('')}${all}<button class="ib-tag-add" type="button" data-idea-tag-new>+ TAG</button></span>`;
}

function relatedMarkup(idea, ideas, colorFor) {
  const own = new Set(tagsOf(idea).map(lower));
  if (!own.size) return '';
  const related = ideas.filter((other) => other.id !== idea.id && tagsOf(other).some((tag) => own.has(lower(tag)))).slice(0, 4);
  if (!related.length) return '';
  return `<div class="ib-related"><span class="ib-detail-label">VERWANDT ÜBER TAGS</span><div class="ib-related-rows">${related.map((other) => {
    const via = tagsOf(other).find((tag) => own.has(lower(tag)));
    return `<button class="ib-related-row" type="button" data-related-open="${html(other.id)}"><span class="ib-topic-dot" style="background:${colorFor(other.topic)}"></span><span class="ib-rail-name">${html(other.title)}</span><span class="ib-rail-n">#${html(via)}</span></button>`;
  }).join('')}</div></div>`;
}

function connectionCount(idea, ideas) {
  let count = ideas.some((item) => item.id === idea.parentId) ? 1 : 0;
  for (const from of ideas) for (const edge of from.relations ?? []) {
    if (relationLabels[edge.type] && (from.id === idea.id || edge.targetId === idea.id) && ideas.some((item) => item.id === edge.targetId)) count += 1;
  }
  return count;
}

const researchButton = (label = 'RECHERCHIEREN') => `<button class="ib-small-btn" type="button" data-research title="Sendet den Gedanken an Codex und recherchiert im Web">${label}</button>`;
// Quellen sind beim Speichern geprüft; als Link erscheint trotzdem nur http(s).
const sourceLinks = (sources) => `<span class="ib-research-sources">${sources.filter((source) => isWebUrl(source.url)).map((source) => `<a href="${html(source.url)}" target="_blank" rel="noreferrer" title="${html(source.title)}">${html(hostOf(source.url))} ↗</a>`).join('')}</span>`;
const answerButton = (answered, label) => `<button class="ib-small-btn" type="button" data-question-answered="${answered}">${label}</button>`;

// Eine Frage ist offen, bis sie als beantwortet markiert wird – von Hand oder nach einer Recherche.
function questionMarkup(idea) {
  if (!isQuestion(idea)) return '';
  return idea.answeredAt
    ? `<div class="ib-question-bar is-answered"><span>✓ BEANTWORTET · ${html(relativeDate(idea.answeredAt))}</span>${answerButton(false, 'WIEDER ÖFFNEN')}</div>`
    : `<div class="ib-question-bar"><span>? OFFENE FRAGE</span>${answerButton(true, 'ALS BEANTWORTET MARKIEREN')}</div>`;
}

// Recherche ergänzt den Gedanken um Webquellen; der eigene Wortlaut bleibt unberührt.
// Bei Fragen steht der Knopf direkt im Gedanken, sonst unter „Mehr“. Befunde lassen sich als eigene Gedanken übernehmen.
function researchMarkup(idea, ideas) {
  const research = idea.research;
  if (!research) return isQuestion(idea) ? `<div class="ib-research-start">${researchButton()}</div>` : '';
  const pending = research.status === 'pending';
  const meta = [research.engine, research.completedAt ? relativeDate(research.completedAt) : null].filter(Boolean).join(' · ');
  const resultId = research.resultId ?? research.completedAt ?? research.requestedAt;
  const adopted = (index) => ideas.some((other) => other.researchOrigin?.ideaId === idea.id && (other.researchOrigin.resultId ?? other.researchOrigin.completedAt) === resultId && other.researchOrigin.index === index);
  const findings = research.findings.length ? `<ol class="ib-research-findings">${research.findings.map((finding, index) => `<li><b>0${index + 1}</b><div><p>${html(finding.text)}</p>${sourceLinks(finding.sources)}<button class="ib-finding-adopt" type="button" data-research-accept="${index}" data-research-result="${html(resultId)}"${adopted(index) ? ' disabled' : ''}>${adopted(index) ? 'ALS GEDANKE ÜBERNOMMEN' : 'ALS GEDANKEN ÜBERNEHMEN'}</button></div></li>`).join('')}</ol>` : '';
  const closes = research.status === 'ready' && isQuestion(idea) && !idea.answeredAt;
  return `<section class="ib-research">
    <span class="ib-detail-label">RECHERCHE${meta ? ` · ${html(meta)}` : ''}</span>
    ${pending ? '<p class="ib-analysis-note" role="status">Codex recherchiert im Web. Das kann einige Minuten dauern; du kannst weiterarbeiten.</p>' : ''}
    ${research.status === 'failed' ? `<p class="ib-analysis-note is-error">${html(research.error)}</p>` : ''}
    ${research.summary ? `<p class="ib-research-summary">${html(research.summary)}</p>` : ''}
    ${findings}
    ${pending ? '' : `<div class="ib-research-actions">${closes ? answerButton(true, 'FRAGE ALS BEANTWORTET MARKIEREN') : ''}${researchButton(research.status === 'failed' ? 'ERNEUT VERSUCHEN' : 'ERNEUT RECHERCHIEREN')}</div>`}
  </section>`;
}

function panelHeadMarkup(idea) {
  const kind = idea ? `${kindLabel(idea.source)} · ${html(relativeDate(idea.createdAt))}` : '';
  return `<div class="ib-panel-head"><span class="ib-detail-kind">${kind}</span><span class="ib-panel-actions">${idea ? '<button type="button" data-inline-edit>Weiterschreiben</button>' : ''}<button type="button" data-detail-close aria-label="Gedanken schließen">×</button></span></div>`;
}

// Der Gedanke steht zuerst in eigenen Worten; Einordnung und Werkzeuge liegen unter „Mehr“.
function detailMarkup(idea, ideas, colorFor, terms) {
  if (!idea) return '';
  const mark = (value) => markText(value, terms, html);
  const date = new Date(idea.createdAt).toLocaleDateString('de-DE');
  const link = idea.source === 'link';
  const paragraphs = link ? (idea.summary ? [idea.summary] : []) : paragraphsOf(idea);
  const showTitle = link || !startsWithTitle(idea.input ?? '', idea.title);
  const focusOnBody = showTitle ? '' : ` tabindex="-1" data-detail-focus aria-label="Gedanke: ${html(idea.title)}"`;
  const points = (idea.keyPoints ?? []).length ? `<div class="ib-points-block"><span class="ib-detail-label">WAS HÄNGEN BLEIBT</span><ul>${idea.keyPoints.map((point, index) => `<li><b>0${index + 1}</b><span>${mark(point)}</span></li>`).join('')}</ul></div>` : '';
  const notes = idea.notes ? `<section class="ib-own-notes"><span class="ib-detail-label">EIGENE ERGÄNZUNGEN</span><p>${mark(idea.notes)}</p></section>` : '';
  const squash = (value) => fold(value).replace(/\s+/g, ' ').trim();
  const showSummary = !link && idea.summary && idea.engine !== 'Lokale Analyse' && squash(idea.summary) !== squash(idea.title) && !squash(idea.input).startsWith(squash(idea.summary));
  const summary = showSummary ? `<div class="ib-summary-block"><span class="ib-detail-label">KURZ</span><p>${mark(idea.summary)}</p></div>` : '';
  const body = paragraphs.length
    ? paragraphs.map((part) => `<p>${mark(part)}</p>`).join('')
    : `<p class="ib-text-pending">${link && idea.analysisState === 'pending' ? 'Zusammenfassung folgt nach der Analyse.' : link ? 'Keine Zusammenfassung vorhanden.' : ''}</p>`;
  const url = !link || !idea.url ? ''
    : isWebUrl(idea.url) ? `<a class="ib-detail-url" href="${html(idea.url)}" target="_blank" rel="noreferrer"><b>${html(hostOf(idea.url))}</b><span>${html(pathOf(idea.url))}</span> ↗</a>`
      : `<p class="ib-detail-url">${html(idea.url)}</p>`;
  const copy = !link && (idea.input ?? '').trim() ? '<button class="ib-copy-btn" type="button" data-idea-copy>KOPIEREN</button>' : '';
  const connections = connectionCount(idea, ideas);
  return `${idea.analysisState === 'pending' ? '<p class="ib-analysis-note" role="status">Gespeichert. Analyse läuft im Hintergrund.</p>' : ''}
    ${idea.analysisWarning ? `<p class="ib-analysis-note is-error">${html(idea.analysisWarning)} ${idea.analysisState === 'failed' ? '<button class="ib-small-btn" type="button" data-analysis-retry>ERNEUT VERSUCHEN</button>' : ''}</p>` : ''}
    ${showTitle ? `<h3 class="ib-detail-title" tabindex="-1" data-detail-focus>${mark(idea.title)}</h3>` : ''}
    ${url}
    <div class="ib-detail-meta">
      <button class="ib-meta-topic" type="button" data-idea-topic-filter="${html(idea.topic)}" title="Nach Thema filtern"><span class="ib-topic-dot" style="background:${colorFor(idea.topic)}"></span>${html(idea.topic)}</button>
      ${tagsOf(idea).map((tag) => `<button class="ib-tag-chip" type="button" data-idea-tag-filter="${html(tag)}" title="Nach #${html(tag)} filtern">#${html(tag)}</button>`).join('')}
      ${copy}
    </div>
    ${questionMarkup(idea)}
    <article class="ib-text-body"${focusOnBody}>${body}</article>
    ${idea.researchOrigin ? `<div class="ib-origin-sources"><span class="ib-detail-label">QUELLEN</span>${sourceLinks(idea.researchOrigin.sources ?? [])}</div>` : ''}
    ${link ? points + notes : notes + points + summary}
    ${researchMarkup(idea, ideas)}
    ${relatedMarkup(idea, ideas, colorFor)}
    <details class="ib-organize"><summary>Mehr${connections ? ` · ${connections} Verbindung${connections === 1 ? '' : 'en'}` : ''}</summary>
      <div class="ib-meta-grid">
        <span class="ib-detail-label">THEMA</span><span class="ib-meta-topic"><span class="ib-topic-dot" style="background:${colorFor(idea.topic)}"></span>${html(idea.topic)}<button type="button" data-idea-topic>ÄNDERN</button></span>
        <span class="ib-detail-label">TAGS</span>${tagEditorMarkup(idea)}
        <span class="ib-detail-label">ANALYSE</span><span>${html(idea.engine)} · ${html(date)}</span>
      </div>
      ${connectionsMarkup(idea, ideas)}
      <div class="ib-organize-actions">${idea.research || isQuestion(idea) ? '' : researchButton()}<button class="ib-small-btn" type="button" data-edit-open>BEARBEITEN</button><button class="ib-small-btn is-danger" type="button" data-idea-delete>IN DEN PAPIERKORB</button></div>
    </details>`;
}

export function initGedankenraum({ root, getToken }) {
  let ideas = [];
  let trash = [];
  let rooms = [];
  let reflections = [];
  let canUndo = false;
  let mutationCount = 0;
  let epoch = 0;
  let pollTimer = null;
  let selectedId = null;
  let busy = false;
  let keep = false;
  let detailOpen = false;
  let libraryOpen = false;
  let resumePanel = false;
  let renderedId = null;
  let messageTimer = null;
  let lastCardClick = null;
  let view = ['list', 'time', 'tree'].includes(localStorage.getItem(VIEW_KEY)) ? localStorage.getItem(VIEW_KEY) : 'list';
  // Eingeklappte Gruppen der Sammlung bleiben im Browser gespeichert; ein unlesbarer Wert lässt alles aufgeklappt.
  const collapsedRail = new Set();
  try { for (const key of JSON.parse(localStorage.getItem(RAIL_KEY) ?? '[]')) if (RAIL_SECTIONS.includes(key)) collapsedRail.add(key); } catch { /* Alles bleibt aufgeklappt. */ }
  // filter.global: ein Tag- oder Themenfilter, der aus einem geöffneten Gedanken kommt, sucht in der ganzen Sammlung.
  const filter = { tag: null, topic: null, question: null, query: '', global: false };
  let editingTag = null;
  const foldCache = new Map();
  const coarse = window.matchMedia('(pointer:coarse)');
  const narrow = window.matchMedia('(max-width:900px)');

  const q = (selector) => root.querySelector(selector);
  const captureInput = q('[data-idea-input]');
  const captureButton = q('[data-idea-capture]');
  const keepToggle = q('[data-idea-keep]');
  const typeLabel = q('[data-idea-type]');
  const searchInput = q('[data-idea-search]');
  const searchStatus = q('[data-search-status]');
  const grid = q('[data-idea-grid]');
  const rail = q('[data-idea-rail]');
  const map = q('[data-idea-map]');
  const detail = q('[data-idea-detail]');
  const status = q('[data-idea-status]');
  const message = q('[data-idea-message]');
  const count = q('[data-idea-count]');
  const menuOpen = q('[data-menu-open]');
  const menuList = q('[data-menu-list]');
  const importOpen = q('[data-import-open]');
  const importFile = q('[data-import-file]');
  const storageOpen = q('[data-storage-open]');
  const storageDialog = q('[data-storage-dialog]');
  const storageDirectory = q('[data-storage-directory]');
  const storageFile = q('[data-storage-file]');
  const storageBrowse = q('[data-storage-browse]');
  const storageSave = q('[data-storage-save]');
  const storageMessage = q('[data-storage-message]');
  const storageDecision = q('[data-storage-decision]');
  const storageMerge = q('[data-storage-merge]');
  const storageReplace = q('[data-storage-replace]');
  const gitPush = q('[data-git-push]');
  const tagDialog = q('[data-tag-dialog]');
  const tagName = q('[data-tag-name]');
  const tagHint = q('[data-tag-hint]');
  const tagSave = q('[data-tag-save]');
  const tagHeading = q('[data-tag-heading]');

  const selected = () => ideas.find((idea) => idea.id === selectedId) ?? null;
  const showMessage = (text, error = false) => {
    clearTimeout(messageTimer);
    message.textContent = text ?? '';
    message.classList.toggle('is-error', error);
    message.hidden = !text;
    if (text && !error) messageTimer = setTimeout(() => { message.hidden = true; }, 3500);
  };
  const colorFor = topicColor;
  const parseQuery = (raw) => {
    // "#tag" und "thema:Name" in der Suche wirken wie die Leiste links.
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    const parsed = { tag: null, topic: null, text: [] };
    for (const token of tokens) {
      if (token === '#' || /^thema:$/i.test(token)) continue;
      if (token.startsWith('#')) parsed.tag = token.slice(1);
      else if (/^thema:/i.test(token)) parsed.topic = token.slice(6);
      else parsed.text.push(token);
    }
    return { ...parsed, text: parsed.text.join(' ') };
  };
  // Gefaltete Felder je Gedanke, damit Tippen in der Suche nicht jedes Mal alles neu faltet.
  const foldedOf = (idea) => {
    const key = `${idea.id}:${idea.updatedAt ?? ''}`;
    let entry = foldCache.get(key);
    if (!entry) {
      if (foldCache.size > ideas.length * 2 + 50) foldCache.clear();
      const tagList = tagsOf(idea).map(fold);
      entry = {
        title: fold(idea.title), tagList, tags: [...tagList, ...(idea.keywords ?? []).map(fold)].join(' '), topic: fold(idea.topic), summary: fold(idea.summary),
        hay: fold([idea.title, idea.summary, idea.topic, ...(idea.keywords ?? []), ...tagsOf(idea), idea.input, idea.notes].join('\n')),
      };
      foldCache.set(key, entry);
    }
    return entry;
  };
  // Der Raum ordnet, die Suche findet: Getipptes durchsucht die ganze Sammlung,
  // Tag- und Themenfilter aus der Sammlung bleiben im Raum.
  const visibleIdeas = () => {
    const parsed = parseQuery(searchInput.value);
    const terms = termsOf(parsed.text);
    const chipTag = fold(filter.tag ?? '');
    const typedTags = parsed.tag ? variantsOf(fold(parsed.tag)) : [];
    const topicOk = topicMatcher(filter.topic, parsed.topic);
    const searching = !!(terms.length || typedTags.length || parsed.topic || (filter.global && (filter.tag || filter.topic)));
    const pool = searching ? ideas : spaces.contextIdeas(ideas);
    const room = spaces.currentRoom();
    const results = pool.filter((idea) => {
      const folded = foldedOf(idea);
      return (!chipTag || folded.tagList.includes(chipTag))
        && (!typedTags.length || typedTags.some((variant) => folded.tagList.some((tag) => tag.startsWith(variant))))
        && (!topicOk || topicOk(folded.topic))
        && (!filter.question || (isQuestion(idea) && (filter.question === 'answered') === !!idea.answeredAt))
        && matches(folded.hay, terms);
    });
    if (!terms.length) return results;
    return results
      .map((idea, index) => ({ idea, index, score: scoreOf(foldedOf(idea), terms) + (room?.ideaIds.includes(idea.id) ? 100 : 0) }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map(({ idea }) => idea);
  };
  const render = () => {
    const focusedId = map.contains(document.activeElement) ? document.activeElement.dataset.ideaId : null;
    const viewport = q('[data-mm-viewport]');
    const scroll = viewport ? { left: viewport.scrollLeft, top: viewport.scrollTop } : null;
    // Beim selben Gedanken bleiben Scrollstand, aufgeklapptes „Mehr“ und Fokus in der Ansicht erhalten.
    const sameIdea = selectedId === renderedId;
    const panelScroll = sameIdea ? detail.scrollTop : 0;
    const organizeOpen = sameIdea && !!detail.querySelector('.ib-organize')?.open;
    const panelFocus = sameIdea && detail.contains(document.activeElement) ? focusKeyOf(document.activeElement) : null;
    const parsed = parseQuery(searchInput.value);
    const terms = termsOf(parsed.text);
    filter.query = searchInput.value.trim();
    const visible = visibleIdeas();
    const idea = selected();
    const room = spaces.currentRoom();
    count.textContent = `${visible.length} VON ${ideas.length}`;
    grid.classList.toggle('is-tree', view === 'tree');
    grid.classList.toggle('has-library', libraryOpen);
    grid.classList.toggle('has-detail', detailOpen && !!idea);
    q('[data-library]').hidden = !libraryOpen;
    q('[data-library-toggle]').setAttribute('aria-expanded', String(libraryOpen));
    q('[data-view-select]').value = view;
    detail.hidden = !detailOpen || !idea;
    rail.innerHTML = railSection('rooms', 'ARBEITSRÄUME', rooms.filter((item) => !item.archivedAt).length, spaces.railItems(), collapsedRail.has('rooms'))
      + railMarkup(spaces.contextIdeas(ideas), filter, colorFor, collapsedRail);
    q('[data-undo]').disabled = !canUndo;
    const refreshing = ideas.filter((item) => item.reanalyze && item.analysisState === 'pending').length;
    q('[data-reanalyze]').textContent = refreshing ? `NEU-ANALYSE ABBRECHEN · ${refreshing} OFFEN` : 'ALLE NEU ANALYSIEREN';
    q('[data-trash-open]').textContent = `PAPIERKORB${trash.length ? ` · ${trash.length}` : ''}`;
    const hasFilter = !!(filter.tag || filter.topic || filter.question || filter.query);
    const outside = room ? visible.filter((candidate) => outsideRoom(candidate, room)).length : 0;
    let body;
    if (view === 'tree') body = mindmapMarkup(visible, selectedId, colorFor, thinking.mapState);
    else if (!visible.length) body = emptyMarkup(hasFilter, ideas.length > 0, room, filter.query);
    else if (view === 'time') body = timelineMarkup(visible, selectedId, colorFor, terms, room);
    else body = listMarkup(visible, selectedId, terms, room);
    map.innerHTML = (hasFilter ? filterMarkup(filter, visible.length, outside) : '') + body;
    detail.innerHTML = panelHeadMarkup(idea) + detailMarkup(idea, ideas, colorFor, terms);
    const announce = hasFilter ? (visible.length ? `${visible.length} Treffer` : 'Nichts gefunden') : '';
    if (searchStatus.textContent !== announce) searchStatus.textContent = announce;
    captureInput.placeholder = room ? `Gedanke zu „${shorten(room.question, 40)}“ …` : CAPTURE_PLACEHOLDER;
    spaces.sync();
    inline.decorate();
    if (scroll && q('[data-mm-viewport]')) { q('[data-mm-viewport]').scrollLeft = scroll.left; q('[data-mm-viewport]').scrollTop = scroll.top; }
    renderedId = idea?.id ?? null;
    if (!detail.hidden) {
      if (organizeOpen) detail.querySelector('.ib-organize').open = true;
      detail.scrollTop = panelScroll;
      if (panelFocus) [...detail.querySelectorAll('button, a, [tabindex]')].find((node) => focusKeyOf(node) === panelFocus)?.focus({ preventScroll: true });
    }
    if (focusedId) [...map.querySelectorAll('[data-idea-id]')].find((button) => button.dataset.ideaId === focusedId)?.focus({ preventScroll: true });
  };
  // Liegt ideas.json eingecheckt in einem Git-Repository, bietet das Menü bei Änderungen „Push“ an.
  // Geprüft wird kurz nach jeder Änderung der Sammlung und beim Öffnen des Menüs.
  let gitTimer = null;
  let gitCheck = 0;
  const showGit = (git) => {
    const pending = !!git?.available && (git.changed || git.ahead > 0);
    gitPush.hidden = !pending;
    if (!pending) return;
    // Push nimmt alle lokalen Commits des Branches mit, auch solche, die nicht von Gedankenraum stammen.
    const foreign = git.foreign > 0 ? git.foreign : 0;
    const others = `${foreign} fremde${foreign === 1 ? 'r' : ''} Commit${foreign === 1 ? '' : 's'}`;
    gitPush.textContent = git.changed ? `PUSH · ideas.json geändert${foreign ? ` (+ ${others})` : ''}` : `PUSH · ${git.ahead} Commit${git.ahead === 1 ? '' : 's'} offen${foreign ? ` (${foreign} fremde)` : ''}`;
    gitPush.title = `Committet ideas.json und pusht ${git.branch}${git.upstream ? ` nach ${git.upstream}` : ''}`
      + (foreign ? `. Dabei ${foreign === 1 ? 'wird' : 'werden'} auch ${others} gepusht, ${foreign === 1 ? 'der' : 'die'} nicht von Gedankenraum ${foreign === 1 ? 'stammt' : 'stammen'}.` : '');
  };
  const loadGit = async () => {
    clearTimeout(gitTimer);
    const check = ++gitCheck;
    try {
      const response = await fetch('/api/git');
      const git = await response.json();
      if (check === gitCheck) showGit(response.ok ? git : null);
      return response.ok ? git : null;
    } catch { if (check === gitCheck) showGit(null); return null; }
  };
  // Was der Start aus dem Remote-Repository geholt hat, erscheint einmal beim Laden.
  const announceUpdate = (update) => {
    if (update?.error) showMessage(`Nicht aktualisiert: ${update.error}`, true);
    else if (update?.pulled) showMessage(`Aktualisiert: ${update.pulled} Commit${update.pulled === 1 ? '' : 's'} aus ${update.upstream} geholt.`);
  };
  const applySnapshot = (snapshot) => {
    if (!Array.isArray(snapshot.ideas)) return;
    clearTimeout(gitTimer); gitTimer = setTimeout(loadGit, 1000);
    ideas = snapshot.ideas;
    trash = snapshot.trash ?? [];
    canUndo = snapshot.canUndo ?? false;
    rooms = snapshot.rooms ?? [];
    reflections = snapshot.reflections ?? [];
    if (!ideas.some((idea) => idea.id === selectedId)) { selectedId = null; detailOpen = false; }
  };
  const post = async (path, command = {}) => {
    mutationCount += 1; epoch += 1;
    try {
    const send = async (renew) => fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gedankenraum-token': await getToken(renew) },
      body: JSON.stringify(command),
    });
    // Nach einem Neustart des Servers gilt das alte Token nicht mehr; abgewiesen wird vor jeder Änderung,
    // also einmal mit frischem Token wiederholen.
    let response = await send(false);
    if (response.status === 403) response = await send(true);
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error ?? 'Aktion fehlgeschlagen.'), payload);
    applySnapshot(payload);
    return payload;
    } finally { mutationCount -= 1; epoch += 1; }
  };
  const runCommand = async (command) => {
      if (command.type === 'capture' && !command.roomId && spaces.roomId()) command = { ...command, roomId: spaces.roomId() };
      const result = await post('/api/ideas/execute', command);
      if (command.type === 'undo') {
        if (result.focusRoomId && rooms.some((room) => room.id === result.focusRoomId && !room.archivedAt)) spaces.chooseRoom(result.focusRoomId);
        if (ideas.some((idea) => idea.id === result.focusId)) selectedId = result.focusId;
        showMessage('Letzte Änderung rückgängig gemacht.');
      }
      if (command.type === 'restore') showMessage('Gedanke wiederhergestellt.');
      render(); return result;
  };
  const clearFilters = () => { filter.tag = null; filter.topic = null; filter.question = null; filter.global = false; searchInput.value = ''; };
  const displayedParents = () => layoutMindmap(visibleIdeas()).parents;
  const parentOf = (idea) => displayedParents().get(idea.id) ?? null;
  const cardOf = (id) => [...map.querySelectorAll('[data-idea-id]')].find((button) => button.dataset.ideaId === id) ?? null;
  const focusPanelContent = () => detail.querySelector('[data-detail-focus]')?.focus({ preventScroll: true });
  // Ein Klick liest: Auswahl öffnet den Gedanken. Der Fokus wandert nur per Tastatur in die Ansicht.
  const select = (id, { focusPanel = false } = {}) => {
    if (inline.isEditing()) { inline.focus(); return; }
    const wasOpen = detailOpen && id === selectedId && !detail.hidden;
    selectedId = id; detailOpen = true; spaces.closeResults(); render();
    if (focusPanel) focusPanelContent();
    if (!wasOpen || focusPanel) {
      const hit = detail.querySelector('mark.ib-hit');
      if (hit) hit.scrollIntoView({ block: 'center' }); else detail.scrollTop = 0;
    }
  };
  const closeDetail = () => {
    const id = selectedId;
    detailOpen = false; render();
    (cardOf(id) ?? searchInput).focus({ preventScroll: true });
  };
  const closeOverlays = () => {
    detailOpen = false; libraryOpen = false; spaces.closeResults(); render();
  };
  // Filter werden nur aufgehoben, wenn das Ziel sonst unsichtbar bliebe – und dann wird es gesagt.
  const reveal = (id, open = true) => {
      selectedId = id; detailOpen = open;
      if (open) spaces.closeResults();
      if (!visibleIdeas().some((idea) => idea.id === id)) {
        clearFilters();
        if (!visibleIdeas().some((idea) => idea.id === id)) { spaces.reset(); showMessage('Raum verlassen, damit der Gedanke sichtbar ist.'); }
        else showMessage('Filter aufgehoben.');
      }
      // Eingeklappte Vorfahren öffnen, auch wenn ein Vorschlag nur über „baut auf“ an seiner Quelle hängt.
      const parents = displayedParents();
      const visited = new Set();
      let parentId = parents.get(id);
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId); thinking.mapState.collapsed.delete(parentId);
        parentId = parents.get(parentId);
      }
      render();
      const node = cardOf(id);
      node?.focus({ preventScroll: true }); node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const spaces = initWorkspaces({
    root, snapshot: () => ({ ideas, trash, canUndo, rooms, reflections }), command: runCommand, render, reveal, selected,
    visibleIds: () => visibleIdeas().filter((idea) => !spaces.roomId() || spaces.currentRoom().ideaIds.includes(idea.id)).map((idea) => idea.id),
    canNavigate: () => { if (!inline.isEditing()) return true; inline.focus(); return false; },
    openPanel: () => { detailOpen = false; render(); },
  });
  const inline = initInlineThought({
    root, command: runCommand, render, notify: showMessage, selected,
    parentOf,
    reveal: (id) => { const open = resumePanel; resumePanel = false; reveal(id, open); },
  });
  const editInline = (idea = selected()) => {
    if (!idea) return;
    if (inline.isEditing()) { inline.focus(); return; }
    resumePanel = detailOpen && selectedId === idea.id;
    detailOpen = false; spaces.closeResults(); inline.openEdit(idea);
  };
  const thinking = initThinkingTools({
    parentOf,
    root, snapshot: () => ({ ideas, trash, canUndo }), selected, command: runCommand,
    render, notify: showMessage, reveal, openInline: editInline,
    newInline: (kind, idea) => { resumePanel = false; detailOpen = false; spaces.closeResults(); inline.openNew(kind, idea); },
  });
  const replaceIdea = (idea) => { ideas = ideas.map((item) => item.id === idea.id ? idea : item); };
  initTagCleanup({ root, snapshot: () => ({ ideas }), request: post, render, notify: showMessage });
  // Nach einem Modellwechsel alles noch einmal analysieren; läuft im Hintergrund und lässt sich abbrechen.
  const reanalyze = async () => {
    try {
      if (ideas.some((item) => item.reanalyze && item.analysisState === 'pending')) {
        const result = await runCommand({ type: 'cancelReanalysis' });
        showMessage(`Neu-Analyse abgebrochen. ${result.stopped} Gedanken behalten ihre bisherige Analyse.`);
        return;
      }
      if (status.classList.contains('is-fallback')) { showMessage('Codex ist nicht verfügbar. Die Neu-Analyse braucht Codex.', true); return; }
      const count = ideas.filter((item) => item.analysisState !== 'pending').length;
      if (!count || !window.confirm(`${count} Gedanken erneut mit ${status.textContent} analysieren?\n\nLinks werden neu gelesen und alle Texte noch einmal an Codex übertragen. Das läuft im Hintergrund und nutzt dein Codex-Kontingent. Eigene Titel, Zusammenfassungen und Themen bleiben. Schlägt eine Analyse fehl, bleibt die bisherige.`)) return;
      const result = await runCommand({ type: 'reanalyzeAll' });
      showMessage(`${result.queued} Gedanken werden neu analysiert. Abbrechen über ⋯.`);
    } catch (error) { showMessage(error.message, true); }
  };
  const setTags = async (idea, tags) => {
    const result = await post('/api/ideas/execute', { type: 'retag', id: idea.id, tags });
    replaceIdea(result.idea);
    render();
  };
  const setView = (next) => { view = next; localStorage.setItem(VIEW_KEY, next); render(); };
  const toggleFilter = (key, value, global = false) => {
    filter[key] = filter[key] === value ? null : value;
    filter.global = !!(filter.tag || filter.topic) && (filter[key] ? global : filter.global);
    render();
  };

  const showStorageMessage = (text) => {
    storageMessage.textContent = text ?? '';
    storageMessage.hidden = !text;
  };
  const updateStorageFile = () => {
    storageDecision.hidden = true;
    const directory = storageDirectory.value.trim().replace(/[\\/]$/, '');
    storageFile.textContent = directory ? `${directory}${directory.includes('\\') ? '\\' : '/'}ideas.json` : 'ideas.json';
  };
  const loadStorage = async () => {
    const response = await fetch('/api/storage');
    const storage = await response.json();
    if (!response.ok) throw new Error(storage.error ?? 'Speicherort konnte nicht geladen werden.');
    storageDirectory.value = storage.directory;
    storageOpen.title = storage.filePath;
    storageBrowse.hidden = !storage.canBrowse;
    storageDirectory.disabled = !storage.configurable;
    storageSave.disabled = !storage.configurable;
    updateStorageFile();
    return storage;
  };
  // Ein bereits gespeicherter Link wird gezeigt statt verdoppelt. Im Raum landet er dort mit;
  // ein zweites Ablegen desselben Textes speichert ihn trotzdem neu.
  let duplicateInput = null;
  const handleDuplicate = async (input) => {
    if (keep || !isLink(input) || duplicateInput === input) return false;
    const key = linkKey(input);
    const existing = ideas.find((idea) => idea.source === 'link' && linkKey(idea.url) === key);
    const trashed = !existing && trash.some((idea) => idea.source === 'link' && linkKey(idea.url) === key);
    if (!existing && !trashed) return false;
    duplicateInput = input;
    if (trashed) { showMessage('Dieser Link liegt im Papierkorb (⋯ → Papierkorb). Nochmal Ablegen speichert ihn neu.'); return true; }
    const room = spaces.currentRoom();
    if (room && !room.ideaIds.includes(existing.id)) {
      await post('/api/ideas/execute', { type: 'roomMembers', id: room.id, add: [existing.id] });
      captureInput.value = ''; updateType(); duplicateInput = null;
      showMessage(`Schon gespeichert: „${shorten(existing.title, 50)}“ liegt jetzt auch in diesem Raum.`);
    } else showMessage(`Schon gespeichert: „${shorten(existing.title, 50)}“. Nochmal Ablegen speichert den Link trotzdem neu.`);
    selectedId = existing.id; detailOpen = true; spaces.closeResults();
    if (!visibleIdeas().some((idea) => idea.id === existing.id)) clearFilters();
    render();
    cardOf(existing.id)?.scrollIntoView({ block: 'nearest' });
    return true;
  };
  // Ablegen fragt nichts und räumt nichts weg: Suche, Filter und geöffneter Gedanke bleiben,
  // solange der neue Gedanke damit sichtbar ist.
  const capture = async () => {
    const input = captureInput.value.trim();
    if (!input || busy) return;
    try { if (await handleDuplicate(input)) return; } catch (error) { showMessage(error.message, true); return; }
    duplicateInput = null;
    busy = true;
    captureButton.disabled = true;
    captureButton.innerHTML = 'WIRD GESPEICHERT <span class="ib-spinner">◌</span>';
    const submitted = captureInput.value;
    showMessage('');
    try {
      const room = spaces.currentRoom();
      const result = await post('/api/ideas/execute', { type: 'capture', input, keep: keep || !isLink(input), roomId: spaces.roomId() });
      if (captureInput.value === submitted) captureInput.value = '';
      updateType();
      let text = room ? `Gespeichert in „${shorten(room.question, 40)}“.` : 'Gespeichert.';
      if (!visibleIdeas().some((idea) => idea.id === result.idea.id)) { clearFilters(); text += ' Filter aufgehoben.'; }
      showMessage(text);
      render();
      if (view !== 'tree') map.scrollTop = 0;
      captureInput.focus();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      busy = false;
      captureButton.disabled = !captureInput.value.trim();
      captureButton.innerHTML = 'Ablegen <span>↵</span>';
    }
  };
  const updateType = () => {
    typeLabel.hidden = !keep || !isLink(captureInput.value);
    if (keep) typeLabel.textContent = 'Link bleibt Text';
    else typeLabel.textContent = isLink(captureInput.value) ? 'LINK ERKANNT' : 'NOTIZ ODER LINK';
  };

  captureInput.addEventListener('input', () => {
    captureButton.disabled = !captureInput.value.trim() || busy;
    updateType();
  });
  keepToggle.addEventListener('click', () => {
    keep = !keep;
    keepToggle.setAttribute('aria-checked', String(keep));
    keepToggle.classList.toggle('is-active', keep);
    updateType();
    captureInput.focus();
  });
  captureInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') capture();
  });
  captureButton.addEventListener('click', capture);
  searchInput.addEventListener('input', render);
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = map.querySelector('[data-idea-id]');
      if (first) { event.preventDefault(); select(first.dataset.ideaId, { focusPanel: true }); }
    } else if (event.key === 'ArrowDown') {
      const first = map.querySelector('[data-idea-id]');
      if (first) { event.preventDefault(); first.focus(); }
    } else if (event.key === 'Escape' && searchInput.value) {
      event.preventDefault(); event.stopPropagation();
      searchInput.value = ''; render();
    }
  });
  searchInput.addEventListener('focus', () => {
    if (narrow.matches && (detailOpen || libraryOpen || spaces.resultsOpen())) closeOverlays();
  });
  q('[data-view-select]').addEventListener('change', (event) => {
    if (inline.isEditing()) { event.target.value = view; inline.focus(); return; }
    setView(event.target.value);
  });

  const closeMenu = () => {
    if (menuList.contains(document.activeElement)) menuOpen.focus();
    menuList.hidden = true; menuOpen.setAttribute('aria-expanded', 'false');
  };
  menuOpen.addEventListener('click', () => {
    menuList.hidden = !menuList.hidden;
    menuOpen.setAttribute('aria-expanded', String(!menuList.hidden));
    if (!menuList.hidden) loadGit();
  });
  document.addEventListener('click', (event) => { if (!event.target.closest?.('[data-menu]')) closeMenu(); });
  const inField = (target) => !!target.closest?.('input, textarea, select, dialog, [contenteditable="true"]');
  document.addEventListener('keydown', (event) => {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (event.shiftKey) captureInput.focus(); else { searchInput.focus(); searchInput.select(); }
      return;
    }
    if (plain && !inField(event.target) && !q('dialog[open]')) {
      if (event.key === '/') { event.preventDefault(); searchInput.focus(); searchInput.select(); return; }
      if (event.key === 'n' && !event.shiftKey) { event.preventDefault(); captureInput.focus(); return; }
    }
    if (event.key !== 'Escape' || event.target === captureInput) return;
    if (!menuList.hidden) closeMenu();
    else if (q('dialog[open]') || inline.isEditing()) return;
    else if ((detailOpen && selected()) || libraryOpen || spaces.resultsOpen()) {
      const id = selectedId;
      closeOverlays();
      (cardOf(id) ?? (document.activeElement === document.body ? searchInput : null))?.focus({ preventScroll: true });
    } else { selectedId = null; spaces.clearSelection(); render(); }
  });

  importOpen.addEventListener('click', () => { closeMenu(); importFile.click(); });
  importFile.addEventListener('change', async () => {
    const [file] = importFile.files;
    importFile.value = '';
    if (!file) return;
    importOpen.disabled = true;
    showMessage('Import wird geprüft.');
    try {
      let imported;
      try {
        imported = JSON.parse(await file.text());
      } catch {
        throw new Error('Die gewählte Datei enthält kein gültiges JSON.');
      }
      const result = await post('/api/ideas/import', imported);
      ideas = result.ideas;
      selectedId = null; detailOpen = false;
      const duplicates = result.skipped ? ` ${result.skipped} Duplikat${result.skipped === 1 ? '' : 'e'} übersprungen.` : '';
      showMessage(`${result.imported} Gedanke${result.imported === 1 ? '' : 'n'} importiert.${duplicates}${result.importedRooms ? ` ${result.importedRooms} Arbeitsräume übernommen.` : ''}${result.importedReflections ? ` ${result.importedReflections} Auswertungen übernommen.` : ''}`);
      render();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      importOpen.disabled = false;
    }
  });

  const drop = q('[data-idea-drop]');
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-dragging');
    captureInput.value = (event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')).trim();
    captureInput.dispatchEvent(new Event('input'));
    captureInput.focus();
  });

  const openTagDialog = (tag) => {
    editingTag = tag;
    tagName.value = tag;
    tagHeading.textContent = `#${tag}`;
    updateTagHint();
    tagDialog.showModal();
    tagName.select();
  };
  const updateTagHint = () => {
    const target = tagName.value.trim().replace(/^#/, '');
    const affected = ideas.filter((idea) => tagsOf(idea).includes(editingTag)).length;
    const exists = target && lower(target) !== lower(editingTag) && ideas.some((idea) => tagsOf(idea).some((tag) => lower(tag) === lower(target)));
    tagSave.disabled = !target || target === editingTag;
    tagSave.textContent = exists ? 'ZUSAMMENLEGEN' : 'UMBENENNEN';
    tagHint.textContent = exists
      ? `#${target} existiert bereits. Beide Tags werden zusammengelegt (${affected} Gedanken betroffen).`
      : target && target !== editingTag ? `${affected} Gedanke${affected === 1 ? '' : 'n'} ${affected === 1 ? 'wird' : 'werden'} umbenannt.` : '';
  };
  tagName.addEventListener('input', updateTagHint);
  tagName.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !tagSave.disabled) tagSave.click(); });
  for (const button of root.querySelectorAll('[data-tag-cancel]')) button.addEventListener('click', () => tagDialog.close());
  tagSave.addEventListener('click', async () => {
    const target = tagName.value.trim().replace(/^#/, '');
    if (!target || !editingTag) return;
    tagSave.disabled = true;
    try {
      const result = await post('/api/ideas/execute', { type: 'renametag', from: editingTag, to: target });
      ideas = result.ideas;
      filter.tag = result.tag;
      tagDialog.close();
      showMessage(result.merged ? `#${editingTag} wurde in #${result.tag} zusammengelegt.` : `#${editingTag} heißt jetzt #${result.tag}.`);
      render();
    } catch (error) {
      tagHint.textContent = error.message;
      tagSave.disabled = false;
    }
  });

  root.addEventListener('click', async (event) => {
    const target = event.target;
    if (target.closest('[data-library-toggle]')) { libraryOpen = !libraryOpen; render(); return; }
    const railToggle = target.closest('[data-rail-toggle]');
    if (railToggle) {
      const key = railToggle.dataset.railToggle;
      if (collapsedRail.has(key)) collapsedRail.delete(key); else collapsedRail.add(key);
      localStorage.setItem(RAIL_KEY, JSON.stringify([...collapsedRail]));
      render();
      [...rail.querySelectorAll('[data-rail-toggle]')].find((button) => button.dataset.railToggle === key)?.focus({ preventScroll: true });
      return;
    }
    if (target.closest('[data-detail-close]')) { closeDetail(); return; }
    if (target.closest('[data-inline-edit]')) { editInline(); return; }
    if (target.closest('[data-inline-editor]')) return;
    if (target === grid && narrow.matches && (detailOpen || libraryOpen || spaces.resultsOpen())) { closeOverlays(); return; }
    const viewButton = target.closest?.('[data-idea-view]');
    if (viewButton) return setView(viewButton.dataset.ideaView);
    const clear = target.closest?.('[data-idea-filter-clear]');
    if (clear) {
      const key = clear.dataset.ideaFilterClear;
      if (key === 'all') clearFilters();
      else if (key === 'query') searchInput.value = '';
      else { filter[key] = null; if (!filter.tag && !filter.topic) filter.global = false; }
      return render();
    }
    const tagEdit = target.closest?.('[data-idea-tag-edit]');
    if (tagEdit) return openTagDialog(tagEdit.dataset.ideaTagEdit);
    const tagRemove = target.closest?.('[data-idea-tag-remove]');
    const idea = selected();
    if (tagRemove && idea) {
      event.stopPropagation();
      return setTags(idea, tagsOf(idea).filter((tag) => tag !== tagRemove.dataset.ideaTagRemove)).catch((error) => showMessage(error.message, true));
    }
    const tagFilter = target.closest?.('[data-idea-tag-filter]');
    if (tagFilter) return toggleFilter('tag', tagFilter.dataset.ideaTagFilter, detail.contains(tagFilter));
    const topicFilter = target.closest?.('[data-idea-topic-filter]');
    if (topicFilter) return toggleFilter('topic', topicFilter.dataset.ideaTopicFilter, detail.contains(topicFilter));
    const questionFilter = target.closest?.('[data-idea-question-filter]');
    if (questionFilter) return toggleFilter('question', questionFilter.dataset.ideaQuestionFilter);
    if (target.closest('[data-reanalyze]')) return reanalyze();
    const row = target.closest?.('[data-idea-id]');
    if (row) {
      if (inline.isEditing()) { inline.focus(); return; }
      if (spaces.handlePick(row.dataset.ideaId, event)) return;
      // Doppelklick mit der Maus öffnet den Editor; die Liste wird zwischen den Klicks neu gezeichnet.
      const doubleClick = !coarse.matches && event.detail > 0 && lastCardClick?.id === row.dataset.ideaId && event.timeStamp - lastCardClick.time < 400;
      lastCardClick = { id: row.dataset.ideaId, time: event.timeStamp };
      if (doubleClick) { selectedId = row.dataset.ideaId; editInline(); return; }
      return select(row.dataset.ideaId, { focusPanel: event.detail === 0 });
    }
    if (!idea) return;
    try {
      if (target.closest?.('[data-idea-tag-accept]')) {
        await setTags(idea, [...tagsOf(idea), target.closest('[data-idea-tag-accept]').dataset.ideaTagAccept]);
      } else if (target.closest?.('[data-idea-tag-accept-all]')) {
        await setTags(idea, [...tagsOf(idea), ...suggestionsOf(idea)]);
      } else if (target.closest?.('[data-idea-tag-new]')) {
        const tag = window.prompt('Neuer Tag', '')?.trim().replace(/^#/, '');
        if (tag) await setTags(idea, [...tagsOf(idea), tag]);
      } else if (target.closest?.('[data-idea-copy]')) {
        const button = target.closest('[data-idea-copy]');
        await navigator.clipboard.writeText(idea.input ?? '');
        button.textContent = 'KOPIERT';
        setTimeout(() => { button.textContent = 'KOPIEREN'; }, 1_500);
      } else if (target.closest?.('[data-idea-topic]')) {
        const topic = window.prompt('Neues Thema', idea.topic)?.trim();
        if (!topic || topic === idea.topic) return;
        const result = await post('/api/ideas/execute', { type: 'retopic', id: idea.id, topic });
        replaceIdea(result.idea);
        render();
      } else if (target.closest?.('[data-research]')) {
        await runCommand({ type: 'research', id: idea.id });
        showMessage('Recherche gestartet. Das Ergebnis erscheint im Gedanken.');
      } else if (target.closest?.('[data-research-accept]')) {
        const accept = target.closest('[data-research-accept]');
        await runCommand({ type: 'acceptResearch', id: idea.id, index: Number(accept.dataset.researchAccept), resultId: accept.dataset.researchResult });
        showMessage('Als Gedanke übernommen. Er baut auf dieser Frage auf.');
      } else if (target.closest?.('[data-question-answered]')) {
        const answered = target.closest('[data-question-answered]').dataset.questionAnswered === 'true';
        await runCommand({ type: 'answer', id: idea.id, answered });
        showMessage(answered ? 'Frage als beantwortet markiert.' : 'Frage ist wieder offen.');
      } else if (target.closest?.('[data-idea-delete]')) {
        await post('/api/ideas/execute', { type: 'delete', id: idea.id });
        ideas = ideas.filter((item) => item.id !== idea.id);
        selectedId = null; detailOpen = false;
        showMessage('Im Papierkorb. Rückgängig mit Strg+Z oder über ⋯.');
        render();
        (map.querySelector('[data-idea-id]') ?? captureInput).focus({ preventScroll: true });
      }
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  menuList.addEventListener('click', (event) => { if (event.target.closest('button')) closeMenu(); });
  root.addEventListener('dblclick', (event) => {
    if (coarse.matches || inline.isEditing()) return;
    const row = event.target.closest('[data-idea-map] [data-idea-id]');
    if (row && !spaces.isSelecting()) { selectedId = row.dataset.ideaId; editInline(); }
  });
  root.addEventListener('keydown', (event) => {
    const row = event.target.closest('[data-idea-map] .ib-row');
    if (!row) return;
    if (event.key === 'F2') {
      event.preventDefault();
      if (inline.isEditing()) { inline.focus(); return; }
      selectedId = row.dataset.ideaId; editInline();
    }
    else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); spaces.handlePick(row.dataset.ideaId, { shiftKey: true, preventDefault() {} }); }
    else if (event.key === 'ArrowUp' && row === map.querySelector('.ib-row')) { event.preventDefault(); searchInput.focus(); }
  });

  q('[data-stop]').addEventListener('click', async () => {
    closeMenu();
    if (!window.confirm('Gedankenraum beenden?')) return;
    try {
      await post('/api/shutdown');
      document.body.innerHTML = '<div class="stopped"><b>Gedankenraum wurde beendet.</b><span>Dieser Tab kann geschlossen werden.</span></div>';
      window.close();
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  storageOpen.addEventListener('click', async () => {
    closeMenu();
    showStorageMessage('');
    storageDecision.hidden = true;
    try {
      const storage = await loadStorage();
      if (!storage.configurable) showStorageMessage('Der Speicherort wird durch GEDANKENRAUM_HOME festgelegt.');
      storageDialog.showModal();
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  storageDirectory.addEventListener('input', updateStorageFile);
  storageBrowse.addEventListener('click', async () => {
    storageBrowse.disabled = true;
    showStorageMessage('Windows-Ordnerauswahl ist geöffnet.');
    try {
      const result = await post('/api/storage/browse', { initialDirectory: storageDirectory.value.trim() });
      if (result.directory) {
        storageDirectory.value = result.directory;
        updateStorageFile();
      }
      showStorageMessage('');
    } catch (error) {
      showStorageMessage(error.message);
    } finally {
      storageBrowse.disabled = false;
    }
  });
  const switchStorage = async (mode) => {
    for (const button of [storageSave, storageMerge, storageReplace]) button.disabled = true;
    storageDecision.hidden = true;
    showStorageMessage('Speicherort wird geprüft.');
    try {
      const result = await post('/api/storage', { directory: storageDirectory.value.trim(), ...(mode && { mode }) });
      spaces.reset();
      ideas = result.ideas;
      selectedId = null; detailOpen = false;
      storageOpen.title = result.filePath;
      storageDialog.close();
      const messages = {
        created: 'Sammlung wurde am neuen Speicherort angelegt.',
        merge: 'Sammlungen wurden zusammengeführt.',
        replace: 'Zieldatei wurde durch die aktuelle Sammlung ersetzt.',
        unchanged: 'Dieser Speicherort wird bereits verwendet.',
      };
      showMessage(messages[result.action] ?? 'Speicherort wurde geändert.');
      render();
    } catch (error) {
      showStorageMessage(error.message);
      storageDecision.hidden = !error.requiresDecision;
    } finally {
      for (const button of [storageSave, storageMerge, storageReplace]) button.disabled = false;
    }
  };
  storageSave.addEventListener('click', () => switchStorage());
  storageMerge.addEventListener('click', () => switchStorage('merge'));
  storageReplace.addEventListener('click', () => switchStorage('replace'));
  for (const selector of ['[data-storage-close]', '[data-storage-cancel]']) {
    q(selector).addEventListener('click', () => storageDialog.close());
  }
  gitPush.addEventListener('click', async () => {
    gitPush.disabled = true;
    showMessage('ideas.json wird committet und gepusht …');
    try {
      const git = await post('/api/git/push');
      gitCheck += 1; showGit(git);
      showMessage(git.pushed ? `ideas.json wurde nach ${git.upstream ?? git.branch} gepusht.` : 'Keine Änderungen zum Pushen.');
    } catch (error) {
      showMessage(error.message, true);
      loadGit();
    } finally {
      gitPush.disabled = false;
    }
  });

  const refresh = async () => {
    const started = epoch;
    try {
      if (!mutationCount && !thinking.isInteracting() && !spaces.isEditing() && !inline.isEditing() && !document.hidden) {
        const response = await fetch('/api/ideas');
        const next = await response.json();
        if (!response.ok) throw new Error(next.error ?? 'Sammlung konnte nicht aktualisiert werden.');
        if (started === epoch && !mutationCount && !thinking.isInteracting() && !spaces.isEditing() && !inline.isEditing()
          && JSON.stringify(next) !== JSON.stringify({ ideas, trash, canUndo, rooms, reflections })) {
          applySnapshot(next); render();
        }
      }
    } catch { /* Keep locally displayed data and unsaved dialog input while offline. */ }
    pollTimer = setTimeout(refresh, 1200);
  };
  window.addEventListener('pagehide', () => clearTimeout(pollTimer));
  return {
    async load() {
      const [snapshotResponse] = await Promise.all([fetch('/api/ideas'), loadStorage()]);
      const snapshot = await snapshotResponse.json();
      if (!snapshotResponse.ok) throw new Error(snapshot.error ?? 'Gedankenraum konnte nicht geladen werden.');
      applySnapshot(snapshot);
      selectedId = null;
      render();
      if (!narrow.matches && !q('dialog[open]')) captureInput.focus();
      pollTimer = setTimeout(refresh, 1200);
      loadGit().then((git) => announceUpdate(git?.update));
      fetch('/api/ideas/status').then((response) => response.json()).then((engine) => {
        status.textContent = engine.engine ?? 'Analyse nicht verfügbar';
        status.classList.toggle('is-fallback', !engine.available);
      }).catch(() => { status.textContent = 'Analyse nicht erreichbar'; });
    },
    render,
  };
}

const root = document.getElementById('gedankenraum');
let token = null;
const app = initGedankenraum({
  root,
  getToken: async (renew = false) => {
    if (token && !renew) return token;
    const response = await fetch('/api/session');
    const payload = await response.json();
    if (!response.ok || !payload.token) throw new Error(payload.error ?? 'Sitzung konnte nicht geöffnet werden.');
    token = payload.token;
    return token;
  },
});
app.load().catch((error) => {
  const message = root.querySelector('[data-idea-message]');
  message.textContent = error.message;
  message.classList.add('is-error');
  message.hidden = false;
});
