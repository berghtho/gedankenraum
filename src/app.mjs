const COLORS = ['#d5ff65', '#ffb86b', '#86d9ff', '#d5a6ff', '#ff8f8f', '#79e3bc', '#ffe071'];

const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

const relativeDate = (value) => {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  if (minutes < 1_440) return `vor ${Math.floor(minutes / 60)} Std.`;
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short' }).format(new Date(value));
};

const isLink = (value) => /^https?:\/\/\S+$/i.test(value.trim());
const sourceLabel = (source) => ({ link: 'LINK', text: 'TEXT' })[source] ?? 'NOTIZ';

function mapMarkup(ideas, selectedId) {
  if (!ideas.length) return `<div class="ib-empty-map">
    <div><span>NOCH ZIEMLICH RUHIG HIER</span><h3>Der erste Gedanke macht den Anfang.</h3>
    <p>Oben einen Link oder eine kurze Notiz einwerfen. Gedankenraum ordnet den Rest.</p></div>
  </div>`;
  const grouped = new Map();
  for (const idea of ideas) {
    if (!grouped.has(idea.topic)) grouped.set(idea.topic, []);
    grouped.get(idea.topic).push(idea);
  }
  return [...grouped].map(([topic, entries], index) => {
    const color = COLORS[index % COLORS.length];
    const rows = entries.map((idea) => `<button class="ib-row${idea.id === selectedId ? ' is-selected' : ''}" type="button" data-idea-id="${html(idea.id)}">
      <span class="ib-row-title">${html(idea.title)}</span>
      <span class="ib-row-meta">${sourceLabel(idea.source)} · ${html(relativeDate(idea.createdAt))}</span>
    </button>`).join('');
    return `<div class="ib-group">
      <div class="ib-group-head"><span class="ib-group-dot" style="background:${color}"></span><b>${html(topic)}</b><span>${entries.length}</span></div>
      <div class="ib-group-rows">${rows}</div>
    </div>`;
  }).join('');
}

function detailMarkup(idea) {
  if (!idea) return '<div class="ib-no-selection"><p>Wähle einen Gedanken aus.</p></div>';
  const points = idea.keyPoints.map((point, index) => `<li><b>0${index + 1}</b><span>${html(point)}</span></li>`).join('');
  const sourceButton = idea.url
    ? `<a class="ib-icon-btn" href="${html(idea.url)}" target="_blank" rel="noreferrer" title="Quelle öffnen" aria-label="Quelle öffnen">↗</a>`
    : '';
  const actions = `<span class="ib-topline-meta"><span>${html(relativeDate(idea.createdAt))}</span>${sourceButton}` +
    `<button class="ib-icon-btn is-danger" type="button" data-idea-delete title="Gedanke löschen" aria-label="Gedanke löschen">✕</button></span>`;
  const text = idea.source === 'text' && idea.input
    ? `<div class="ib-text-block"><div class="ib-text-head"><span class="ib-detail-label">WORTLAUT</span>` +
      `<button class="ib-copy-btn" type="button" data-idea-copy>KOPIEREN</button></div><pre>${html(idea.input)}</pre></div>`
    : '';
  return `<div class="ib-detail-topline"><span class="ib-source-badge">● ${sourceLabel(idea.source)}</span>${actions}</div>
    <h3>${html(idea.title)}</h3>
    <button class="ib-topic-pill" type="button" data-idea-topic>${html(idea.topic)} · ÄNDERN</button>
    <div class="ib-summary-block"><span class="ib-detail-label">AUF DEN PUNKT</span><p>${html(idea.summary)}</p></div>
    ${text}
    <div class="ib-points-block"><span class="ib-detail-label">WAS HÄNGEN BLEIBT</span><ul>${points || '<li><span>Keine weiteren Punkte.</span></li>'}</ul></div>
    <div class="ib-keywords">${idea.keywords.map((word) => `#${html(word)}`).join(' ')}</div>
    <div class="ib-detail-footer"><span>${html(idea.engine)}</span><span>·</span><span>${html(new Date(idea.createdAt).toLocaleDateString('de-DE'))}</span></div>`;
}

export function initGedankenraum({ root, getToken }) {
  let ideas = [];
  let selectedId = null;
  let busy = false;
  let keep = false;
  const captureInput = root.querySelector('[data-idea-input]');
  const captureButton = root.querySelector('[data-idea-capture]');
  const keepToggle = root.querySelector('[data-idea-keep]');
  const typeLabel = root.querySelector('[data-idea-type]');
  const searchInput = root.querySelector('[data-idea-search]');
  const map = root.querySelector('[data-idea-map]');
  const detail = root.querySelector('[data-idea-detail]');
  const status = root.querySelector('[data-idea-status]');
  const message = root.querySelector('[data-idea-message]');
  const count = root.querySelector('[data-idea-count]');
  const importOpen = root.querySelector('[data-import-open]');
  const importFile = root.querySelector('[data-import-file]');
  const storageOpen = root.querySelector('[data-storage-open]');
  const storageDialog = root.querySelector('[data-storage-dialog]');
  const storageDirectory = root.querySelector('[data-storage-directory]');
  const storageFile = root.querySelector('[data-storage-file]');
  const storageBrowse = root.querySelector('[data-storage-browse]');
  const storageSave = root.querySelector('[data-storage-save]');
  const storageMessage = root.querySelector('[data-storage-message]');
  const storageDecision = root.querySelector('[data-storage-decision]');
  const storageMerge = root.querySelector('[data-storage-merge]');
  const storageReplace = root.querySelector('[data-storage-replace]');

  const selected = () => ideas.find((idea) => idea.id === selectedId) ?? null;
  const showMessage = (text, error = false) => {
    message.textContent = text ?? '';
    message.classList.toggle('is-error', error);
    message.hidden = !text;
  };
  const visibleIdeas = () => {
    const query = searchInput.value.trim().toLocaleLowerCase('de-DE');
    if (!query) return ideas;
    return ideas.filter((idea) => [idea.title, idea.summary, idea.topic, ...idea.keywords, idea.source === 'text' ? idea.input : '']
      .join(' ').toLocaleLowerCase('de-DE').includes(query));
  };
  const render = () => {
    const visible = visibleIdeas();
    count.textContent = `${visible.length} VON ${ideas.length}`;
    map.innerHTML = mapMarkup(visible, selectedId);
    detail.innerHTML = detailMarkup(selected());
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
      captureInput.value = '';
      updateType();
      status.textContent = result.idea.engine;
      status.classList.toggle('is-fallback', result.idea.engine === 'Lokale Analyse');
      showMessage(result.warning);
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
  importOpen.addEventListener('click', () => importFile.click());
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
  searchInput.addEventListener('input', render);
  root.querySelector('[data-idea-drop]').addEventListener('dragover', (event) => {
    event.preventDefault();
    event.currentTarget.classList.add('is-dragging');
  });
  root.querySelector('[data-idea-drop]').addEventListener('dragleave', (event) => event.currentTarget.classList.remove('is-dragging'));
  root.querySelector('[data-idea-drop]').addEventListener('drop', (event) => {
    event.preventDefault();
    event.currentTarget.classList.remove('is-dragging');
    captureInput.value = (event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')).trim();
    captureInput.dispatchEvent(new Event('input'));
    captureInput.focus();
  });
  root.addEventListener('click', async (event) => {
    const row = event.target.closest?.('[data-idea-id]');
    if (row) {
      selectedId = row.dataset.ideaId;
      render();
      return;
    }
    const idea = selected();
    if (!idea) return;
    try {
      if (event.target.closest?.('[data-idea-copy]')) {
        const button = event.target.closest('[data-idea-copy]');
        await navigator.clipboard.writeText(idea.input ?? '');
        button.textContent = 'KOPIERT';
        setTimeout(() => { button.textContent = 'KOPIEREN'; }, 1_500);
      } else if (event.target.closest?.('[data-idea-topic]')) {
        const topic = window.prompt('Neues Thema', idea.topic)?.trim();
        if (!topic || topic === idea.topic) return;
        const result = await post('/api/ideas/execute', { type: 'retopic', id: idea.id, topic });
        ideas = ideas.map((item) => item.id === idea.id ? result.idea : item);
        render();
      } else if (event.target.closest?.('[data-idea-delete]')) {
        if (!window.confirm(`Gedanke „${idea.title}“ endgültig löschen?`)) return;
        await post('/api/ideas/execute', { type: 'delete', id: idea.id });
        ideas = ideas.filter((item) => item.id !== idea.id);
        selectedId = ideas[0]?.id ?? null;
        render();
      }
    } catch (error) {
      showMessage(error.message, true);
    }
  });
  root.querySelector('[data-stop]').addEventListener('click', async () => {
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
    root.querySelector(selector).addEventListener('click', () => storageDialog.close());
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
