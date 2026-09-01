const TOPIC_COLORS = ['oklch(72% 0.05 120)', 'oklch(72% 0.05 60)', 'oklch(72% 0.05 230)', 'oklch(72% 0.05 300)', 'oklch(72% 0.05 160)', 'oklch(72% 0.05 20)', 'oklch(72% 0.05 90)'];
const VIEW_KEY = 'gedankenraum.view';

const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const lower = (value) => String(value ?? '').toLocaleLowerCase('de-DE');

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
const tagsOf = (idea) => Array.isArray(idea.tags) ? idea.tags : [];
const suggestionsOf = (idea) => {
  const have = new Set(tagsOf(idea).map(lower));
  return (idea.keywords ?? []).filter((word) => !have.has(lower(word)));
};
const paragraphsOf = (idea) => (idea.input ?? '').split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);

const tagChip = (tag) => `<span class="ib-tag">#${html(tag)}</span>`;
const rowTags = (idea, { max = 3, compact = false } = {}) => {
  const tags = tagsOf(idea);
  if (!tags.length) return '';
  if (compact) {
    const rest = tags.length > 1 ? ` +${tags.length - 1}` : '';
    return `<span class="ib-row-meta" title="${html(tags.map((tag) => `#${tag}`).join(' '))}">#${html(tags[0])}${rest}</span>`;
  }
  return `<span class="ib-row-tags">${tags.slice(0, max).map(tagChip).join('')}${tags.length > max ? tagChip(`+${tags.length - max}`) : ''}</span>`;
};
const rowMarkup = (idea, selectedId, { color = null, meta = null, compact = false } = {}) => `<button class="ib-row${idea.id === selectedId ? ' is-selected' : ''}" type="button" data-idea-id="${html(idea.id)}">
  ${color ? `<span class="ib-topic-dot" style="background:${color}"></span>` : ''}
  <span class="ib-row-title">${html(idea.title)}</span>
  ${rowTags(idea, { compact })}
  ${meta === null ? '' : `<span class="ib-row-meta">${html(meta)}</span>`}
</button>`;

function emptyMarkup(hasFilter, hasIdeas) {
  if (!hasIdeas) return `<div class="ib-empty-map"><div><span>NOCH ZIEMLICH RUHIG HIER</span><h3>Der erste Gedanke macht den Anfang.</h3>
    <p>Oben einen Link oder eine kurze Notiz einwerfen. Gedankenraum ordnet den Rest.</p></div></div>`;
  return `<div class="ib-empty-map"><div><span>NICHTS GEFUNDEN</span><h3>Kein Gedanke passt zu diesem Filter.</h3>
    <p>${hasFilter ? 'Tag oder Thema abwählen, oder die Suche leeren.' : 'Die Suche liefert keine Treffer.'}</p></div></div>`;
}

function groupByTopic(ideas, colorFor) {
  const grouped = new Map();
  for (const idea of ideas) {
    if (!grouped.has(idea.topic)) grouped.set(idea.topic, []);
    grouped.get(idea.topic).push(idea);
  }
  return [...grouped].map(([topic, entries]) => ({ topic, entries, color: colorFor(topic) }));
}

function listMarkup(ideas, selectedId, colorFor) {
  return groupByTopic(ideas, colorFor).map(({ topic, entries, color }) => `<div class="ib-group">
    <div class="ib-group-head"><span class="ib-group-dot" style="background:${color}"></span><b>${html(topic)}</b><span>${entries.length}</span></div>
    <div class="ib-group-rows">${entries.map((idea) => rowMarkup(idea, selectedId, { meta: `${sourceLabel(idea.source)} · ${relativeDate(idea.createdAt)}` })).join('')}</div>
  </div>`).join('');
}

function timelineMarkup(ideas, selectedId, colorFor) {
  const sorted = [...ideas].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const days = new Map();
  for (const idea of sorted) {
    const label = dayLabel(idea.createdAt);
    if (!days.has(label)) days.set(label, []);
    days.get(label).push(idea);
  }
  return [...days].map(([label, entries]) => `<div class="ib-day">
    <div class="ib-day-label">${html(label)}</div>
    <div class="ib-day-rows">${entries.map((idea) => rowMarkup(idea, selectedId, { color: colorFor(idea.topic), meta: sourceLabel(idea.source) })).join('')}</div>
  </div>`).join('');
}

function treeMarkup(ideas, selectedId, colorFor, rootLabel) {
  const groups = groupByTopic(ideas, colorFor);
  const branches = groups.map(({ topic, entries, color }) => `<div class="ib-branch">
    <div class="ib-tree-tick"></div>
    <div class="ib-branch-node" data-idea-topic-filter="${html(topic)}" role="button" tabindex="0"><span class="ib-topic-dot" style="background:${color}"></span><span class="ib-rail-name">${html(topic)}</span><span class="ib-rail-n">${entries.length}</span></div>
    <div class="ib-tree-link${entries.length > 1 ? '' : ' is-single'}"></div>
    <div class="ib-leaves">${entries.map((idea) => `<div class="ib-leaf"><div class="ib-tree-tick"></div>${rowMarkup(idea, selectedId, { compact: true })}</div>`).join('')}</div>
  </div>`).join('');
  return `<div class="ib-tree">
    <div class="ib-tree-root"><div><span>SAMMLUNG</span><b>${html(rootLabel)}</b><i>${ideas.length} GEDANKEN</i></div></div>
    <div class="ib-tree-link${groups.length > 1 ? '' : ' is-single'}"></div>
    <div class="ib-tree-branches">${branches}</div>
  </div>`;
}

function railMarkup(ideas, filter, colorFor) {
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
  }).join('') : '<div class="ib-rail-empty">Noch keine Tags. Vorschläge erscheinen im Detail eines Gedankens.</div>';
  const topicItems = [...topicCount].map(([topic, count]) => `<div class="ib-rail-item${filter.topic === topic ? ' is-active' : ''}">
    <button type="button" data-idea-topic-filter="${html(topic)}"><span class="ib-topic-dot" style="background:${colorFor(topic)}"></span><span class="ib-rail-name">${html(topic)}</span><span class="ib-rail-n">${count}</span></button>
  </div>`).join('');
  return `<div><div class="ib-rail-head">TAGS <span>${tags.length}</span></div><div class="ib-rail-items">${tagItems}</div></div>
    <div><div class="ib-rail-head">THEMEN <span>${topicCount.size}</span></div><div class="ib-rail-items">${topicItems}</div></div>`;
}

function filterMarkup(filter, visibleCount, groupCount) {
  const chips = [];
  if (filter.tag) chips.push(`<button class="ib-filter-chip" type="button" data-idea-filter-clear="tag">#${html(filter.tag)} <span>✕</span></button>`);
  if (filter.topic) chips.push(`<button class="ib-filter-chip" type="button" data-idea-filter-clear="topic">${html(filter.topic)} <span>✕</span></button>`);
  if (filter.query) chips.push(`<button class="ib-filter-chip" type="button" data-idea-filter-clear="query">„${html(filter.query)}“ <span>✕</span></button>`);
  const note = chips.length ? `${visibleCount} Gedanken in ${groupCount} Themen` : 'Alle Gedanken';
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
    return `<button class="ib-related-row" type="button" data-idea-id="${html(other.id)}"><span class="ib-topic-dot" style="background:${colorFor(other.topic)}"></span><span class="ib-rail-name">${html(other.title)}</span><span class="ib-rail-n">#${html(via)}</span></button>`;
  }).join('')}</div></div>`;
}

function detailMarkup(idea, ideas, colorFor, reading) {
  if (!idea) return '<div class="ib-no-selection"><p>Wähle einen Gedanken aus.</p></div>';
  const paragraphs = idea.source === 'text' && idea.input ? paragraphsOf(idea) : [];
  const points = idea.keyPoints.map((point, index) => `<li><b>0${index + 1}</b><span>${html(point)}</span></li>`).join('');
  const sourceButton = idea.url
    ? `<a class="ib-icon-btn" href="${html(idea.url)}" target="_blank" rel="noreferrer" title="Quelle öffnen" aria-label="Quelle öffnen">↗</a>`
    : '';
  const topline = `<div class="ib-detail-topline"><span>● ${sourceLabel(idea.source)} · ${html(relativeDate(idea.createdAt))}</span>
    <span class="ib-topline-meta">${sourceButton}
      <button class="ib-small-btn" type="button" data-idea-reading>${reading ? 'SCHLIESSEN ⤡' : 'LESEMODUS ⤢'}</button>
      <button class="ib-icon-btn is-danger" type="button" data-idea-delete title="Gedanke löschen" aria-label="Gedanke löschen">✕</button></span></div>`;
  const date = new Date(idea.createdAt).toLocaleDateString('de-DE');
  if (reading) {
    const body = (paragraphs.length ? paragraphs : [idea.summary]).map((part) => `<p>${html(part)}</p>`).join('');
    return `${topline}<div class="ib-reading">
      <div class="ib-reading-side">
        <div><span class="ib-detail-label">THEMA</span><span class="ib-meta-topic"><span class="ib-topic-dot" style="background:${colorFor(idea.topic)}"></span>${html(idea.topic)}</span></div>
        <div><span class="ib-detail-label">TAGS</span>${tagEditorMarkup(idea)}</div>
        ${points ? `<div><span class="ib-detail-label">WAS HÄNGEN BLEIBT</span><ul>${idea.keyPoints.map((point) => `<li>${html(point)}</li>`).join('')}</ul></div>` : ''}
        ${paragraphs.length ? '<button class="ib-copy-btn" type="button" data-idea-copy>KOPIEREN</button>' : ''}
        <div class="ib-reading-foot">${html(idea.engine)}<br>${html(date)}</div>
      </div>
      <article><h2>${html(idea.title)}</h2>${paragraphs.length ? `<p class="ib-reading-lede">${html(idea.summary)}</p>` : ''}<div class="ib-reading-body">${body}</div></article>
    </div>`;
  }
  const text = paragraphs.length
    ? `<div class="ib-text-head"><span class="ib-detail-label">WORTLAUT</span><button class="ib-copy-btn" type="button" data-idea-copy>KOPIEREN</button></div>
       <div class="ib-text-body">${paragraphs.map((part) => `<p>${html(part)}</p>`).join('')}</div>`
    : '';
  return `${topline}
    <h3>${html(idea.title)}</h3>
    <div class="ib-meta-grid">
      <span class="ib-detail-label">THEMA</span><span class="ib-meta-topic"><span class="ib-topic-dot" style="background:${colorFor(idea.topic)}"></span>${html(idea.topic)}<button type="button" data-idea-topic>ÄNDERN</button></span>
      <span class="ib-detail-label">TAGS</span>${tagEditorMarkup(idea)}
      <span class="ib-detail-label">ANALYSE</span><span>${html(idea.engine)} · ${html(date)}</span>
    </div>
    <p class="ib-summary">${html(idea.summary)}</p>
    ${text}
    <div class="ib-points-block"><span class="ib-detail-label">WAS HÄNGEN BLEIBT</span><ul>${points || '<li><span>Keine weiteren Punkte.</span></li>'}</ul></div>
    ${relatedMarkup(idea, ideas, colorFor)}`;
}

export function initGedankenraum({ root, getToken }) {
  let ideas = [];
  let selectedId = null;
  let busy = false;
  let keep = false;
  let reading = false;
  let view = ['list', 'time', 'tree'].includes(localStorage.getItem(VIEW_KEY)) ? localStorage.getItem(VIEW_KEY) : 'list';
  const filter = { tag: null, topic: null, query: '' };
  let editingTag = null;

  const q = (selector) => root.querySelector(selector);
  const captureInput = q('[data-idea-input]');
  const captureButton = q('[data-idea-capture]');
  const keepToggle = q('[data-idea-keep]');
  const typeLabel = q('[data-idea-type]');
  const searchInput = q('[data-idea-search]');
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
  const tagDialog = q('[data-tag-dialog]');
  const tagName = q('[data-tag-name]');
  const tagHint = q('[data-tag-hint]');
  const tagSave = q('[data-tag-save]');
  const tagHeading = q('[data-tag-heading]');

  const selected = () => ideas.find((idea) => idea.id === selectedId) ?? null;
  const showMessage = (text, error = false) => {
    message.textContent = text ?? '';
    message.classList.toggle('is-error', error);
    message.hidden = !text;
  };
  const colorFor = (() => {
    const order = () => [...new Set(ideas.map((idea) => idea.topic))];
    return (topic) => TOPIC_COLORS[Math.max(0, order().indexOf(topic)) % TOPIC_COLORS.length];
  })();
  const parseQuery = (raw) => {
    // "#tag" und "thema:Name" in der Suche wirken wie die Leiste links.
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    const parsed = { tag: null, topic: null, text: [] };
    for (const token of tokens) {
      if (token.startsWith('#') && token.length > 1) parsed.tag = token.slice(1);
      else if (/^thema:/i.test(token) && token.length > 6) parsed.topic = token.slice(6);
      else parsed.text.push(token);
    }
    return { ...parsed, text: parsed.text.join(' ') };
  };
  const visibleIdeas = () => {
    const parsed = parseQuery(searchInput.value);
    const tag = lower(filter.tag ?? parsed.tag ?? '');
    const topic = lower(filter.topic ?? parsed.topic ?? '');
    const query = lower(parsed.text);
    return ideas.filter((idea) => (!tag || tagsOf(idea).some((candidate) => lower(candidate) === tag))
      && (!topic || lower(idea.topic).includes(topic))
      && (!query || [idea.title, idea.summary, idea.topic, ...(idea.keywords ?? []), ...tagsOf(idea), idea.source === 'text' ? idea.input : '']
        .join(' ').toLocaleLowerCase('de-DE').includes(query)));
  };
  const render = () => {
    filter.query = parseQuery(searchInput.value).text;
    const visible = visibleIdeas();
    const idea = selected();
    count.textContent = `${visible.length} VON ${ideas.length}`;
    grid.classList.toggle('is-reading', reading && !!idea);
    grid.classList.toggle('is-tree', view === 'tree' && !reading);
    for (const button of root.querySelectorAll('[data-idea-view]')) button.setAttribute('aria-pressed', String(button.dataset.ideaView === view));
    rail.innerHTML = railMarkup(ideas, filter, colorFor);
    const groupCount = new Set(visible.map((candidate) => candidate.topic)).size;
    const hasFilter = !!(filter.tag || filter.topic || filter.query);
    let body;
    if (!visible.length) body = emptyMarkup(hasFilter, ideas.length > 0);
    else if (view === 'time') body = timelineMarkup(visible, selectedId, colorFor);
    else if (view === 'tree') body = treeMarkup(visible, selectedId, colorFor, filter.tag ? `#${filter.tag}` : filter.topic ?? 'Alles');
    else body = listMarkup(visible, selectedId, colorFor);
    map.innerHTML = (ideas.length ? filterMarkup(filter, visible.length, groupCount) : '') + body;
    detail.innerHTML = detailMarkup(idea, ideas, colorFor, reading);
  };
  const post = async (path, command = {}) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gedankenraum-token': await getToken() },
      body: JSON.stringify(command),
    });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error ?? 'Aktion fehlgeschlagen.'), payload);
    return payload;
  };
  const replaceIdea = (idea) => { ideas = ideas.map((item) => item.id === idea.id ? idea : item); };
  const setTags = async (idea, tags) => {
    const result = await post('/api/ideas/execute', { type: 'retag', id: idea.id, tags });
    replaceIdea(result.idea);
    render();
  };
  const select = (id) => { selectedId = id; render(); };
  const setView = (next) => { view = next; localStorage.setItem(VIEW_KEY, next); render(); };
  const toggleFilter = (key, value) => { filter[key] = filter[key] === value ? null : value; render(); };

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
  const capture = async () => {
    const input = captureInput.value.trim();
    if (!input || busy) return;
    busy = true;
    captureButton.disabled = true;
    captureButton.innerHTML = 'WIRD VERDICHTET <span class="ib-spinner">◌</span>';
    showMessage('');
    try {
      const result = await post('/api/ideas/execute', { type: 'capture', input, keep });
      ideas.unshift(result.idea);
      selectedId = result.idea.id;
      reading = false;
      filter.tag = null; filter.topic = null; searchInput.value = '';
      captureInput.value = '';
      updateType();
      status.textContent = result.idea.engine;
      status.classList.toggle('is-fallback', result.idea.engine === 'Lokale Analyse');
      const suggestions = suggestionsOf(result.idea).length;
      showMessage(result.warning ?? `Eingeordnet unter „${result.idea.topic}“.${suggestions ? ` ${suggestions} Tag-Vorschl${suggestions === 1 ? 'ag' : 'äge'} im Detail prüfen.` : ''}`);
      render();
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      busy = false;
      captureButton.disabled = !captureInput.value.trim();
      captureButton.innerHTML = 'EINSORTIEREN <span>→</span>';
    }
  };
  const updateType = () => {
    if (keep) typeLabel.textContent = 'TEXTNOTIZ · WORTGETREU';
    else typeLabel.textContent = isLink(captureInput.value) ? 'LINK ERKANNT' : 'NOTIZ ODER LINK';
  };

  captureInput.addEventListener('input', () => {
    captureButton.disabled = !captureInput.value.trim() || busy;
    updateType();
  });
  keepToggle.addEventListener('click', () => {
    keep = !keep;
    keepToggle.setAttribute('aria-pressed', String(keep));
    keepToggle.classList.toggle('is-active', keep);
    updateType();
    captureInput.focus();
  });
  captureInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') capture();
  });
  captureButton.addEventListener('click', capture);
  searchInput.addEventListener('input', render);

  const closeMenu = () => { menuList.hidden = true; menuOpen.setAttribute('aria-expanded', 'false'); };
  menuOpen.addEventListener('click', () => {
    menuList.hidden = !menuList.hidden;
    menuOpen.setAttribute('aria-expanded', String(!menuList.hidden));
  });
  document.addEventListener('click', (event) => { if (!event.target.closest?.('[data-menu]')) closeMenu(); });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!menuList.hidden) closeMenu();
    else if (reading) { reading = false; render(); }
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
      selectedId = ideas[0]?.id ?? null;
      const duplicates = result.skipped ? ` ${result.skipped} Duplikat${result.skipped === 1 ? '' : 'e'} übersprungen.` : '';
      showMessage(`${result.imported} Gedanke${result.imported === 1 ? '' : 'n'} importiert.${duplicates}`);
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
    const viewButton = target.closest?.('[data-idea-view]');
    if (viewButton) return setView(viewButton.dataset.ideaView);
    const clear = target.closest?.('[data-idea-filter-clear]');
    if (clear) {
      if (clear.dataset.ideaFilterClear === 'query') searchInput.value = '';
      else filter[clear.dataset.ideaFilterClear] = null;
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
    if (tagFilter) return toggleFilter('tag', tagFilter.dataset.ideaTagFilter);
    const topicFilter = target.closest?.('[data-idea-topic-filter]');
    if (topicFilter) return toggleFilter('topic', topicFilter.dataset.ideaTopicFilter);
    const row = target.closest?.('[data-idea-id]');
    if (row) return select(row.dataset.ideaId);
    if (!idea) return;
    try {
      if (target.closest?.('[data-idea-reading]')) {
        reading = !reading;
        render();
      } else if (target.closest?.('[data-idea-tag-accept]')) {
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
      } else if (target.closest?.('[data-idea-delete]')) {
        if (!window.confirm(`Gedanke „${idea.title}“ endgültig löschen?`)) return;
        await post('/api/ideas/execute', { type: 'delete', id: idea.id });
        ideas = ideas.filter((item) => item.id !== idea.id);
        selectedId = ideas[0]?.id ?? null;
        reading = false;
        render();
      }
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  root.addEventListener('keydown', (event) => {
    const node = event.target.closest?.('[data-idea-topic-filter][role="button"]');
    if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); node.click(); }
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
      ideas = result.ideas;
      selectedId = ideas[0]?.id ?? null;
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

  return {
    async load() {
      const [snapshotResponse, statusResponse] = await Promise.all([fetch('/api/ideas'), fetch('/api/ideas/status'), loadStorage()]);
      const snapshot = await snapshotResponse.json();
      const engine = await statusResponse.json();
      if (!snapshotResponse.ok) throw new Error(snapshot.error ?? 'Gedankenraum konnte nicht geladen werden.');
      ideas = snapshot.ideas ?? [];
      selectedId = ideas[0]?.id ?? null;
      status.textContent = engine.engine;
      status.classList.toggle('is-fallback', !engine.available);
      render();
    },
    render,
  };
}

const root = document.getElementById('gedankenraum');
let token = null;
const app = initGedankenraum({
  root,
  getToken: async () => {
    if (token) return token;
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
