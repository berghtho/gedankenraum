const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const kinds = { commonalities: 'Gemeinsamkeiten', contradictions: 'Widersprüche', questions: 'Offene Fragen' };

export function initWorkspaces({ root, snapshot, command, render, reveal, changeContext, visibleIds, selected, canNavigate = () => true, openPanel = () => {} }) {
  let activeId = null;
  const picked = new Set();
  let mode = null;
  let editingId = null;
  let membership = new Set();
  let baseline = new Set();
  let resultKey = '';
  let resultId = null;
  let draggedId = null;
  let selecting = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'ib-dialog ib-workspace-dialog';
  dialog.setAttribute('aria-labelledby', 'workspace-dialog-title');
  root.append(dialog);
  const resultsPanel = document.createElement('aside');
  resultsPanel.className = 'ib-results-panel'; resultsPanel.hidden = true;
  resultsPanel.setAttribute('aria-label', 'Auswertungen');
  root.querySelector('[data-idea-grid]').append(resultsPanel);
  dialog.addEventListener('close', () => { if (!resultsPanel.hidden) mode = 'results'; });
  const q = (selector) => dialog.querySelector(selector);
  const currentRoom = () => snapshot().rooms.find((room) => room.id === activeId && !room.archivedAt) ?? null;
  const contextResults = () => snapshot().reflections.filter((item) => !activeId || item.roomId === activeId);
  const chooseRoom = (id) => {
    if (!canNavigate()) return false;
    activeId = id || null; picked.clear(); selecting = false; resultId = null; resultsPanel.hidden = true; changeContext(); render();
  };
  const shell = (title, body, action = '') => {
    dialog.innerHTML = `<form><div class="ib-dialog-head"><h2 id="workspace-dialog-title">${html(title)}</h2><button class="ib-dialog-close" type="button" data-workspace-close aria-label="Schließen">×</button></div>${body}<p class="ib-tools-error" role="alert" data-workspace-error></p><div class="ib-dialog-actions"><button type="button" data-workspace-close>SCHLIESSEN</button>${action ? `<button class="is-primary" type="submit">${html(action)}</button>` : ''}</div></form>`;
    if (!dialog.open) dialog.showModal();
  };
  const editRoom = (room = null) => {
    mode = 'edit'; editingId = room?.id ?? null;
    shell(room ? 'Arbeitsfrage ändern' : 'Neuer Arbeitsraum', `<p>Welche Frage möchtest du hier durchdenken?</p><label class="ib-dialog-field"><span>ARBEITSFRAGE</span><input name="question" maxlength="240" required value="${html(room?.question ?? '')}" placeholder="Wie soll mein nächstes Spiel funktionieren?"></label>${room ? '<p><button type="button" class="ib-small-btn" data-room-archive>RAUM ARCHIVIEREN</button></p><p class="ib-dialog-note">Gedanken bleiben in der Sammlung. Der Raum lässt sich wiederherstellen.</p>' : ''}`, 'SPEICHERN');
    q('[name="question"]').focus();
  };
  const renderMembers = () => {
    const query = q('[name="member-search"]').value.toLocaleLowerCase('de-DE');
    q('[data-members-list]').innerHTML = snapshot().ideas.filter((idea) => `${idea.title} ${idea.topic}`.toLocaleLowerCase('de-DE').includes(query)).map((idea) => `<label><input type="checkbox" data-member-id="${html(idea.id)}" ${membership.has(idea.id) ? 'checked' : ''}><span>${html(idea.title)}<small>${html(idea.topic)}</small></span></label>`).join('') || '<p>Keine passenden Gedanken.</p>';
  };
  const openMembers = (room) => {
    if (!room) return;
    mode = 'members'; editingId = room.id; membership = new Set(room.ideaIds); baseline = new Set(room.ideaIds);
    shell('Gedanken im Arbeitsraum', `<p>${html(room.question)}</p><p class="ib-dialog-note">Ein Gedanke kann in mehreren Räumen liegen. Abwählen entfernt ihn nur aus diesem Raum.</p><label class="ib-dialog-field"><span>GEDANKEN SUCHEN</span><input name="member-search" type="search" placeholder="Titel oder Thema"></label><div class="ib-member-list" data-members-list></div>`, 'AUSWAHL SPEICHERN');
    renderMembers();
    q('[name="member-search"]').addEventListener('input', renderMembers);
  };
  const openAddToRoom = () => {
    mode = 'add';
    const rooms = snapshot().rooms.filter((room) => !room.archivedAt);
    shell('Auswahl einem Raum hinzufügen', `<p>${picked.size} ausgewählte Gedanken</p><label class="ib-dialog-field"><span>ARBEITSRAUM</span><select name="room" required>${rooms.map((room) => `<option value="${html(room.id)}">${html(room.question)}</option>`).join('')}</select></label>`, 'HINZUFÜGEN');
  };
  const openArchive = () => {
    mode = 'archive';
    shell('Archivierte Arbeitsräume', `<div class="ib-member-list">${snapshot().rooms.filter((room) => room.archivedAt).map((room) => `<div class="ib-archive-row"><span>${html(room.question)}</span><button type="button" class="ib-small-btn" data-room-restore="${html(room.id)}">WIEDERHERSTELLEN</button></div>`).join('') || '<p>Keine archivierten Räume.</p>'}</div>`);
  };
  const resultMarkup = (result) => {
    const current = snapshot().ideas;
    const changed = result.sources.some((source) => !current.some((idea) => idea.id === source.id && (idea.updatedAt ?? null) === source.updatedAt));
    return `<article class="ib-reflection"><header><span>${html(kinds[result.kind])}</span><time>${html(new Date(result.createdAt).toLocaleString('de-DE'))}</time></header>
      ${result.question ? `<h3>${html(result.question)}</h3>` : ''}
      <p class="ib-reflection-label">KI-VORSCHLÄGE · ${result.sources.length} GEDANKEN${result.engine ? ` · ${html(result.engine)}` : ''}</p>
      ${changed ? '<p class="ib-reflection-warning">Quellen inzwischen geändert oder im Papierkorb. Die Auswertung bezieht sich auf den gespeicherten Stand.</p>' : ''}
      ${result.sources.some((source) => source.truncated) ? '<p class="ib-reflection-warning">Lange Texte wurden für diese Auswertung gekürzt.</p>' : ''}
      ${result.status === 'pending' ? '<p role="status">Auswertung läuft im Hintergrund. Du kannst dieses Fenster schließen und weiterarbeiten.</p>' : result.status === 'failed' ? `<p class="ib-reflection-warning">${html(result.error)}</p><button type="button" class="ib-small-btn" data-reflection-retry="${html(result.id)}">ERNEUT VERSUCHEN</button>` : `<p>${html(result.summary)}</p>${result.findings.length ? result.findings.map((finding, index) => {
        const accepted = current.find((idea) => idea.reflectionOrigin?.id === result.id && idea.reflectionOrigin.index === index);
        return `<section class="ib-finding"><p>${html(finding.text)}</p><div class="ib-finding-sources">${finding.sourceIds.map((id) => `<button type="button" data-source-result="${html(result.id)}" data-source-id="${html(id)}">${html(result.sources.find((source) => source.id === id)?.title ?? id)}</button>`).join('')}</div><button type="button" class="ib-small-btn" data-finding-result="${html(result.id)}" data-finding-index="${index}" ${accepted ? 'disabled' : ''}>${accepted ? 'ALS GEDANKE ÜBERNOMMEN' : 'ALS GEDANKEN ÜBERNEHMEN'}</button></section>`;
      }).join('') : '<p>Keine belegbaren Einzelvorschläge.</p>'}`}
      <details><summary>Alle verwendeten Quellen</summary><div class="ib-finding-sources">${result.sources.map((source) => `<button type="button" data-source-result="${html(result.id)}" data-source-id="${html(source.id)}">${html(source.title)}</button>`).join('')}</div></details>
    </article>`;
  };
  const openResults = (force = false) => {
    const results = resultId ? snapshot().reflections.filter((item) => item.id === resultId) : contextResults();
    const key = JSON.stringify([results, snapshot().ideas.map((idea) => [idea.id, idea.updatedAt, idea.reflectionOrigin])]);
    if (!force && key === resultKey) return;
    resultKey = key;
    const scroll = resultsPanel.scrollTop;
    mode = 'results';
    resultsPanel.innerHTML = `<div class="ib-panel-head"><h2>Zusammen denken</h2><button type="button" data-results-close aria-label="Auswertungen schließen">×</button></div><div class="ib-results">${results.map(resultMarkup).join('') || '<p>Wähle mehrere Gedanken aus, um Verbindungen oder offene Fragen zu entdecken.</p>'}</div><p role="alert" data-results-error></p>`;
    const wasHidden = resultsPanel.hidden; resultsPanel.hidden = false;
    root.querySelector('[data-idea-grid]').classList.add('has-results');
    if (dialog.open) dialog.close();
    resultsPanel.scrollTop = scroll;
    if (wasHidden) { openPanel(); resultsPanel.querySelector('[data-results-close]').focus(); }
  };
  const openSource = (resultId, sourceId) => {
    const result = snapshot().reflections.find((item) => item.id === resultId);
    const source = result?.sources.find((item) => item.id === sourceId);
    if (!source) return;
    mode = 'source';
    shell('Verwendeter Quellenstand', `<div class="ib-source-snapshot"><h3>${html(source.title)}</h3><p class="ib-dialog-note">Stand beim Start der Auswertung. ${source.source === 'link' ? 'Gespeicherte Link-Zusammenfassung; Originalseite nicht erneut gelesen.' : ''} ${source.truncated ? 'Gekürzter Auszug.' : ''}</p><h4>Text</h4><p>${html(source.input)}</p><h4>Zusammenfassung</h4><p>${html(source.summary)}</p>${source.notes ? `<h4>Eigene Ergänzungen</h4><p>${html(source.notes)}</p>` : ''}${source.keyPoints?.length ? `<h4>Kernpunkte</h4><ul>${source.keyPoints.map((point) => `<li>${html(point)}</li>`).join('')}</ul>` : ''}<button type="button" class="ib-small-btn" data-results-open>ZUR AUSWERTUNG</button>${snapshot().ideas.some((idea) => idea.id === source.id) ? `<button type="button" class="ib-small-btn" data-source-live="${html(source.id)}">AKTUELLEN GEDANKEN ÖFFNEN</button>` : ''}</div>`);
  };
  const error = (failure) => {
    if (dialog.open) q('[data-workspace-error]').textContent = failure.message;
    else if (!resultsPanel.hidden) resultsPanel.querySelector('[data-results-error]').textContent = failure.message;
    else { const message = root.querySelector('[data-idea-message]'); message.textContent = failure.message; message.hidden = false; message.classList.add('is-error'); }
  };
  const safely = (work) => Promise.resolve().then(work).catch(error);
  dialog.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = q('[type="submit"]'); if (!button || button.disabled) return;
    button.disabled = true;
    const data = new FormData(q('form'));
    try {
      if (mode === 'edit') {
        const result = await command({ type: editingId ? 'roomRename' : 'roomCreate', ...(editingId && { id: editingId }), question: data.get('question') });
        chooseRoom(result.room.id);
      } else if (mode === 'members') {
        await command({ type: 'roomMembers', id: editingId, add: [...membership].filter((id) => !baseline.has(id)), remove: [...baseline].filter((id) => !membership.has(id)) });
      } else if (mode === 'add') {
        await command({ type: 'roomMembers', id: data.get('room'), add: [...picked] });
        chooseRoom(data.get('room'));
      } else if (mode === 'reflect') {
        const result = await command({ type: 'reflect', kind: data.get('kind'), ideaIds: [...picked], roomId: activeId });
        resultId = result.reflection.id; openResults(true);
      }
      dialog.close(); render();
    } catch (failure) { error(failure); button.disabled = false; }
  });
  root.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches('[data-room-select]') && chooseRoom(target.value) === false) target.value = activeId ?? '';
    if (target.matches('[data-pick-id]')) {
      if (target.checked) picked.add(target.dataset.pickId); else picked.delete(target.dataset.pickId);
      const id = target.dataset.pickId; render();
      [...root.querySelectorAll('[data-pick-id]')].find((item) => item.dataset.pickId === id)?.focus();
    }
    if (target.matches('[data-member-id]')) { if (target.checked) membership.add(target.dataset.memberId); else membership.delete(target.dataset.memberId); }
  });
  root.addEventListener('pointerdown', (event) => { if (event.target.closest('.ib-pick')) event.stopPropagation(); }, true);
  root.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.ib-row[data-idea-id]');
    if (!row) return;
    draggedId = row.dataset.ideaId;
    event.dataTransfer.setData('application/x-gedankenraum-idea', draggedId);
    event.dataTransfer.effectAllowed = 'copy';
  });
  root.addEventListener('dragover', (event) => {
    const room = event.target.closest('[data-open-room]');
    if (room && draggedId) { event.preventDefault(); room.classList.add('is-drop-target'); }
  });
  root.addEventListener('dragleave', (event) => event.target.closest('[data-open-room]')?.classList.remove('is-drop-target'));
  root.addEventListener('dragend', () => { draggedId = null; root.querySelectorAll('[data-open-room].is-drop-target').forEach((item) => item.classList.remove('is-drop-target')); });
  root.addEventListener('drop', (event) => {
    const room = event.target.closest('[data-open-room]');
    if (!room || !draggedId) return;
    event.preventDefault();
    const id = draggedId; draggedId = null; room.classList.remove('is-drop-target');
    safely(() => command({ type: 'roomMembers', id: room.dataset.openRoom, add: [id] }));
  });
  root.addEventListener('click', (event) => {
    const target = event.target;
    if (target.closest('[data-selection-toggle]')) { if (!canNavigate()) return; selecting = !selecting; picked.clear(); if (selecting && selected()) picked.add(selected().id); render(); root.querySelector('[data-pick-id]')?.focus(); }
    if (target.closest('[data-reflection-open]')) {
      mode = 'reflect';
      shell('Zusammen denken', `<p>${picked.size} Gedanken. Was möchtest du entdecken?</p><label class="ib-dialog-field"><span>Auswertung</span><select name="kind">${Object.entries(kinds).map(([id, name]) => `<option value="${id}">${html(name)}</option>`).join('')}</select></label><p class="ib-dialog-note">Die ausgewählten Texte werden an Codex übertragen. Ergebnisse bleiben Vorschläge.</p>`, 'Auswerten');
    }
    if (target.closest('[data-results-close]')) { resultsPanel.hidden = true; root.querySelector('[data-idea-grid]').classList.remove('has-results'); root.querySelector('[data-reflection-open], [data-menu-open]')?.focus(); }
    if (target.closest('[data-workspace-close]')) dialog.close();
    if (target.closest('[data-room-new]')) editRoom();
    if (target.closest('[data-room-edit]')) editRoom(currentRoom());
    if (target.closest('[data-room-members]')) openMembers(currentRoom());
    if (target.closest('[data-room-archives]')) openArchive();
    if (target.closest('[data-selection-add]')) openAddToRoom();
    if (target.closest('[data-pick-clear]')) { picked.clear(); selecting = false; render(); root.querySelector('[data-menu-open]').focus(); }
    if (target.closest('[data-pick-visible]')) { for (const id of visibleIds()) picked.add(id); render(); }
    if (target.closest('[data-selection-remove]') && currentRoom()) safely(() => command({ type: 'roomMembers', id: activeId, remove: [...picked] }).then(() => { picked.clear(); render(); }));
    if (target.closest('[data-results-open]')) { if (mode !== 'source' || !dialog.open) resultId = null; openResults(true); }
    const source = target.closest('[data-source-result]');
    if (source) openSource(source.dataset.sourceResult, source.dataset.sourceId);
    const provenance = target.closest('[data-provenance]');
    if (provenance) { resultId = provenance.dataset.provenance; openResults(true); }
    const live = target.closest('[data-source-live]');
    if (live) { dialog.close(); activeId = null; reveal(live.dataset.sourceLive); }
    const roomButton = target.closest('[data-open-room]');
    if (roomButton) chooseRoom(roomButton.dataset.openRoom);
    if (target.closest('[data-room-archive]')) safely(async () => { await command({ type: 'roomArchive', id: editingId }); dialog.close(); chooseRoom(null); });
    const restore = target.closest('[data-room-restore]');
    if (restore) safely(async () => { await command({ type: 'roomRestore', id: restore.dataset.roomRestore }); dialog.close(); chooseRoom(restore.dataset.roomRestore); });
    const retry = target.closest('[data-reflection-retry]');
    if (retry) safely(() => command({ type: 'retryReflection', id: retry.dataset.reflectionRetry }));
    const accept = target.closest('[data-finding-result]');
    if (accept && !accept.disabled) {
      accept.disabled = true;
      safely(async () => { try { await command({ type: 'acceptReflection', id: accept.dataset.findingResult, index: Number(accept.dataset.findingIndex) }); openResults(true); } finally { accept.disabled = false; } });
    }
  });
  return {
    currentRoom,
    chooseRoom,
    clearSelection: () => { picked.clear(); selecting = false; },
    closeResults: () => { resultsPanel.hidden = true; root.querySelector('[data-idea-grid]').classList.remove('has-results'); },
    isSelecting: () => selecting || picked.size > 0,
    handlePick(id, event) {
      if (!selecting && !event.shiftKey) return false;
      event.preventDefault();
      selecting = true;
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      render(); return true;
    },
    roomId: () => currentRoom()?.id ?? null,
    reset: () => { activeId = null; picked.clear(); selecting = false; resultsPanel.hidden = true; },
    contextIdeas: (ideas) => currentRoom() ? ideas.filter((idea) => currentRoom().ideaIds.includes(idea.id)) : ideas,
    isEditing: () => !!draggedId || (dialog.open && mode !== 'results'),
    railMarkup: () => `<div><div class="ib-rail-head">ARBEITSRÄUME</div><div class="ib-rail-items">${snapshot().rooms.filter((room) => !room.archivedAt).map((room) => `<div class="ib-rail-item${room.id === activeId ? ' is-active' : ''}"><button type="button" data-open-room="${html(room.id)}"><span class="ib-rail-name">${html(room.question)}</span><span class="ib-rail-n">${snapshot().ideas.filter((idea) => room.ideaIds.includes(idea.id)).length}</span></button></div>`).join('') || '<p class="ib-tools-note">Sammle Gedanken zu einer eigenen Frage.</p>'}</div></div>`,
    sync() {
      if (activeId && !currentRoom()) activeId = null;
      for (const id of picked) if (!snapshot().ideas.some((idea) => idea.id === id) || (currentRoom() && !currentRoom().ideaIds.includes(id))) picked.delete(id);
      const room = currentRoom();
      const rooms = snapshot().rooms.filter((item) => !item.archivedAt);
      const archived = snapshot().rooms.length - rooms.length;
      root.querySelector('[data-idea-grid]').classList.toggle('has-results', !resultsPanel.hidden);
      root.querySelector('[data-workspace-bar]').innerHTML = rooms.length ? `<select data-room-select aria-label="Arbeitsraum"><option value="">Gedankenraum</option>${rooms.map((item) => `<option value="${html(item.id)}" ${item.id === activeId ? 'selected' : ''}>${html(item.question)}</option>`).join('')}</select>` : '<span class="ib-room-title">Gedankenraum</span>';
      root.querySelector('[data-room-tools]').innerHTML = `<button type="button" data-room-new>+ Arbeitsraum</button>${room ? '<button type="button" data-room-edit>Frage ändern</button><button type="button" data-room-members>Gedanken zuordnen</button>' : ''}${archived ? `<button type="button" data-room-archives>Archiv · ${archived}</button>` : ''}<button type="button" data-results-open>Auswertungen · ${contextResults().length}</button>`;
      const bar = root.querySelector('[data-context-bar]');
      bar.hidden = !selecting && !picked.size && !selected();
      bar.innerHTML = selecting || picked.size ? `<span>${picked.size} ausgewählt</span><button type="button" data-pick-visible>Alle sichtbaren</button>${picked.size && rooms.length ? '<button type="button" data-selection-add>In Raum …</button>' : ''}${picked.size && room ? '<button type="button" data-selection-remove>Aus Raum entfernen</button>' : ''}<button type="button" data-reflection-open ${picked.size < 2 || picked.size > 12 ? 'disabled' : ''}>Zusammen denken</button>${picked.size > 12 ? '<span>Bitte höchstens 12 Gedanken wählen.</span>' : ''}<button type="button" data-pick-clear aria-label="Auswahl beenden">×</button>` : '<span>Dein Gedanke</span><button type="button" data-inline-edit>Weiterschreiben</button><button type="button" data-detail-open>Öffnen</button><button type="button" data-selection-toggle>Mehrere auswählen</button><button type="button" data-clear-focus aria-label="Gedanke abwählen">×</button>';
      for (const button of root.querySelectorAll('[data-idea-map] .ib-row, [data-idea-map] .ib-mm-select')) {
        if (button.classList.contains('ib-row')) button.draggable = true;
        const id = button.dataset.ideaId;
        const idea = snapshot().ideas.find((item) => item.id === id);
        if (!selecting && !picked.size) continue;
        const label = document.createElement('label'); label.className = 'ib-pick';
        label.innerHTML = `<input type="checkbox" data-pick-id="${html(id)}" ${picked.has(id) ? 'checked' : ''} aria-label="Auswählen: ${html(idea?.title)}">`;
        if (button.classList.contains('ib-mm-select')) button.parentElement.append(label);
        else { const wrapper = document.createElement('div'); wrapper.className = 'ib-selection-row'; button.before(wrapper); wrapper.append(label, button); }
      }
      const origin = selected()?.reflectionOrigin;
      if (origin) root.querySelector('[data-idea-detail]').insertAdjacentHTML('afterbegin', `<p class="ib-provenance">Übernommener KI-Vorschlag <button type="button" data-provenance="${html(origin.id)}">QUELLENSTAND ANSEHEN</button></p>`);
      if (!resultsPanel.hidden && mode === 'results') openResults();
    },
  };
}
