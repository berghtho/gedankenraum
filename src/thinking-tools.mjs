import { relationLabels } from './mindmap.mjs';
const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function connectionsMarkup(idea, ideas) {
  const rows = [];
  for (const from of ideas) for (const edge of from.relations ?? []) {
    if (!relationLabels[edge.type] || (from.id !== idea.id && edge.targetId !== idea.id)) continue;
    const target = ideas.find((item) => item.id === edge.targetId);
    if (!target) continue;
    const outgoing = from.id === idea.id;
    const other = outgoing ? target : from;
    const direction = outgoing ? `Dieser Gedanke ${relationLabels[edge.type]} →` : ({ builds: '← baut auf diesem Gedanken auf', contradicts: '← widerspricht diesem Gedanken', example: '← Beispiel für diesen Gedanken' })[edge.type];
    rows.push(`<div class="ib-connection"><button type="button" data-related-open="${html(other.id)}"><small>${direction}</small><span>${html(other.title)}</span></button><button type="button" data-connection-remove data-from="${html(from.id)}" data-target="${html(target.id)}" data-relation="${edge.type}" aria-label="Verbindung entfernen">×</button></div>`);
  }
  const parent = ideas.find((item) => item.id === idea.parentId);
  return `<section class="ib-related"><div class="ib-section-head"><span class="ib-detail-label">VERBINDUNGEN</span><button class="ib-small-btn" type="button" data-connect-open>+ VERBINDEN</button></div>${parent ? `<button class="ib-parent-link" type="button" data-related-open="${html(parent.id)}">Untergedanke von ${html(parent.title)}</button>` : ''}${rows.join('') || '<p class="ib-tools-note">Verknüpfe Gedanken auch über Themengrenzen hinweg.</p>'}</section>`;
}

export function initThinkingTools({ root, snapshot, selected, command, render, reveal, notify }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'ib-dialog ib-thinking-dialog';
  dialog.setAttribute('aria-labelledby', 'thinking-title');
  root.append(dialog);
  let editing = null;
  let mode = null;
  let dragged = null;
  let suppressClick = false;
  const mapState = { collapsed: new Set(), zoom: 1 };
  const q = (selector) => dialog.querySelector(selector);
  const shell = (title, body, action = null) => {
    dialog.innerHTML = `<form><div class="ib-dialog-head"><h2 id="thinking-title">${title}</h2><button class="ib-dialog-close" type="button" data-thinking-close aria-label="Schließen">×</button></div>${body}<p class="ib-tools-error" role="alert" data-thinking-error></p><div class="ib-dialog-actions"><button type="button" data-thinking-close>ABBRECHEN</button>${action ? `<button class="is-primary" type="submit">${action}</button>` : ''}</div></form>`;
    if (!dialog.open) dialog.showModal();
  };
  const field = (name, label, value, max, multiline = false) => `<label class="ib-dialog-field"><span>${label}</span>${multiline ? `<textarea name="${name}" maxlength="${max}" rows="${name === 'input' ? 6 : 3}">${html(value)}</textarea>` : `<input name="${name}" value="${html(value)}" maxlength="${max}" required>`}</label>`;
  const openEdit = (idea) => {
    if (!idea) return;
    mode = 'edit'; editing = structuredClone(idea);
    shell('Gedanken bearbeiten', field('title', 'TITEL', idea.title, 160)
      + (idea.source !== 'link' ? field('input', 'TEXT', idea.input, 60000, true) : `<p>Quelle: ${html(idea.url)}</p>`)
      + field('summary', 'ZUSAMMENFASSUNG', idea.summary, 1200, true)
      + field('notes', 'EIGENE ERGÄNZUNGEN', idea.notes ?? '', 60000, true)
      + '<p class="ib-dialog-note">Eigene Titel und Zusammenfassungen bleiben erhalten, auch wenn eine Analyse noch läuft.</p>', 'SPEICHERN');
    q('[name="title"]').focus();
  };
  const openNew = (kind, idea = selected()) => {
    mode = 'new';
    const parentId = kind === 'child' ? idea?.id : kind === 'sibling' ? idea?.parentId : null;
    editing = { parentId: parentId ?? null, topic: kind === 'root' ? null : idea?.topic };
    const parent = snapshot().ideas.find((item) => item.id === parentId);
    shell(kind === 'child' ? 'Untergedanke' : kind === 'sibling' ? 'Nachbargedanke' : 'Neuer Gedanke',
      (parent ? `<p>Unter ${html(parent.title)}</p>` : '') + field('input', 'DEIN GEDANKE', '', 12000, true), 'ABLEGEN');
    q('[name="input"]').required = true;
    q('[name="input"]').focus();
  };
  const populateTargets = () => {
    const query = q('[name="find"]').value.toLocaleLowerCase('de-DE');
    const select = q('[name="target"]');
    const previous = select.value;
    let candidates = snapshot().ideas.filter((idea) => idea.id !== editing.id && `${idea.title} ${idea.topic}`.toLocaleLowerCase('de-DE').includes(query));
    if (mode === 'move') {
      const descendants = new Set([editing.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const idea of snapshot().ideas) if (descendants.has(idea.parentId) && !descendants.has(idea.id)) { descendants.add(idea.id); changed = true; }
      }
      candidates = candidates.filter((idea) => !descendants.has(idea.id));
    }
    select.innerHTML = (mode === 'move' ? '<option value="">Als eigenständiger Gedanke</option>' : '') + candidates.map((idea) => `<option value="${html(idea.id)}">${html(idea.title)} · ${html(idea.topic)}</option>`).join('');
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    else if (select.options.length) select.selectedIndex = 0;
    q('[type="submit"]').disabled = mode !== 'move' && !candidates.length;
  };
  const openTarget = (nextMode) => {
    const idea = selected(); if (!idea) return;
    mode = nextMode; editing = structuredClone(idea);
    shell(mode === 'move' ? 'Zweig verschieben' : 'Gedanken verbinden', `<p>${html(idea.title)}</p>`
      + (mode === 'connect' ? `<label class="ib-dialog-field"><span>BEZIEHUNG ZUM ZIEL</span><select name="relation">${Object.entries(relationLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>` : '')
      + '<label class="ib-dialog-field"><span>ZIEL SUCHEN</span><input name="find" type="search" placeholder="Titel oder Thema"></label><label class="ib-dialog-field"><span>ZIELGEDANKE</span><select name="target" size="6"></select></label>', mode === 'move' ? 'VERSCHIEBEN' : 'VERBINDEN');
    populateTargets();
    q('[name="find"]').addEventListener('input', populateTargets);
    q('[name="find"]').focus();
  };
  const openTrash = () => {
    mode = 'trash';
    const items = snapshot().trash ?? [];
    shell('Papierkorb', `<p>Gedanken bleiben hier bis zur Wiederherstellung erhalten. Untergedanken bleiben beim Löschen einzeln erhalten.</p><div class="ib-trash-list">${items.map((idea) => `<div><span>${html(idea.title)}</span><button class="ib-small-btn" type="button" data-restore="${html(idea.id)}">WIEDERHERSTELLEN</button></div>`).join('') || '<p>Der Papierkorb ist leer.</p>'}</div>`);
  };
  dialog.addEventListener('click', async (event) => {
    if (event.target.closest('[data-thinking-close]')) return dialog.close();
    const restore = event.target.closest('[data-restore]');
    if (restore) {
      restore.disabled = true;
      try { await command({ type: 'restore', id: restore.dataset.restore }); openTrash(); }
      catch (error) { q('[data-thinking-error]').textContent = error.message; restore.disabled = false; }
    }
  });
  dialog.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = q('[type="submit"]');
    if (!button || button.disabled) return;
    button.disabled = true;
    const data = new FormData(q('form'));
    let createdId = null;
    try {
      if (mode === 'edit') {
        const fields = Object.fromEntries([...data].filter(([key, value]) => value.trim() !== (editing[key] ?? '')));
        await command({ type: 'edit', id: editing.id, fields });
      } else if (mode === 'new') {
        const input = data.get('input').trim();
        const result = await command({ type: 'capture', input, title: input.split('\n')[0].slice(0, 160), parentId: editing.parentId, ...(editing.topic && { topic: editing.topic }) });
        if (editing.parentId) mapState.collapsed.delete(editing.parentId);
        createdId = result.idea.id;
      } else if (mode === 'connect') {
        await command({ type: 'connect', id: editing.id, targetId: data.get('target'), relation: data.get('relation') });
      } else if (mode === 'move') {
        await command({ type: 'move', id: editing.id, parentId: data.get('target') || null });
        mapState.collapsed.delete(data.get('target'));
        render();
      }
      dialog.close();
      if (createdId) reveal(createdId);
      notify('Gespeichert.');
    } catch (error) { q('[data-thinking-error]').textContent = error.message; button.disabled = false; }
  });
  dialog.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); q('form').requestSubmit(); }
  });
  const safely = (work) => Promise.resolve().then(work).catch((error) => notify(error.message, true));
  root.addEventListener('click', (event) => {
    const target = event.target;
    if (target.closest('[data-edit-open]')) openEdit(selected());
    if (target.closest('[data-connect-open]')) openTarget('connect');
    if (target.closest('[data-trash-open]')) {
      root.querySelector('[data-menu-list]').hidden = true;
      root.querySelector('[data-menu-open]').setAttribute('aria-expanded', 'false');
      openTrash();
    }
    if (target.closest('[data-undo]')) safely(() => command({ type: 'undo' }));
    if (target.closest('[data-analysis-retry]')) safely(() => command({ type: 'retry', id: selected().id }));
    const related = target.closest('[data-related-open]');
    if (related) reveal(related.dataset.relatedOpen);
    const remove = target.closest('[data-connection-remove]');
    if (remove) safely(() => command({ type: 'disconnect', id: remove.dataset.from, targetId: remove.dataset.target, relation: remove.dataset.relation }));
    const add = target.closest('[data-mm-new]');
    if (add) openNew(add.dataset.mmNew);
    if (target.closest('[data-mm-move]')) openTarget('move');
    const collapse = target.closest('[data-mm-collapse]');
    if (collapse) {
      const id = collapse.dataset.mmCollapse;
      if (mapState.collapsed.has(id)) mapState.collapsed.delete(id); else mapState.collapsed.add(id);
      render();
    }
    const zoom = target.closest('[data-mm-zoom]');
    if (zoom) {
      mapState.zoom = zoom.dataset.mmZoom === 'reset' ? 1 : Math.max(.4, Math.min(1.6, mapState.zoom + (zoom.dataset.mmZoom === 'in' ? .1 : -.1)));
      render();
    }
  });
  root.addEventListener('keydown', (event) => {
    if (event.target.closest('input, textarea, select, dialog, [contenteditable="true"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault(); if (snapshot().canUndo) safely(() => command({ type: 'undo' })); return;
    }
    const node = event.target.closest('.ib-mm-select');
    if (!node || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const idea = snapshot().ideas.find((item) => item.id === node.dataset.ideaId);
    if (event.key === 'Tab' || event.key === 'Enter') { event.preventDefault(); openNew(event.key === 'Tab' ? 'child' : 'sibling', idea); }
    if (event.key === 'F2') { event.preventDefault(); openEdit(idea); }
    if (event.key.startsWith('Arrow')) {
      const buttons = [...root.querySelectorAll('.ib-mm-select')];
      const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
      event.preventDefault(); buttons[buttons.indexOf(node) + direction]?.focus();
    }
  });
  root.addEventListener('click', (event) => {
    if (suppressClick && event.target.closest('[data-mm-id]')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const clearDrag = () => {
    root.querySelectorAll('.is-dragging,.is-drop-target').forEach((node) => node.classList.remove('is-dragging', 'is-drop-target'));
    dragged = null;
  };
  let pan = null;
  root.addEventListener('pointerdown', (event) => {
    const viewport = event.target.closest('[data-mm-viewport]');
    if (!viewport || event.button !== 0) return;
    const node = event.target.closest('[data-mm-id]');
    if (node) {
      if (event.target.closest('[data-mm-collapse]')) return;
      dragged = { node, id: node.dataset.mmId, x: event.clientX, y: event.clientY, moved: false };
      return;
    }
    pan = { viewport, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
  });
  root.addEventListener('pointermove', (event) => {
    if (dragged) {
      if (Math.hypot(event.clientX - dragged.x, event.clientY - dragged.y) < 6 && !dragged.moved) return;
      if (!dragged.moved) dragged.node.setPointerCapture(event.pointerId);
      dragged.moved = true;
      dragged.node.classList.add('is-dragging');
      root.querySelector('.is-drop-target')?.classList.remove('is-drop-target');
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-mm-id]');
      if (target && target.dataset.mmId !== dragged.id) target.classList.add('is-drop-target');
      return;
    }
    if (!pan) return;
    pan.viewport.scrollLeft = pan.left + pan.x - event.clientX;
    pan.viewport.scrollTop = pan.top + pan.y - event.clientY;
  });
  root.addEventListener('pointerup', (event) => {
    if (dragged?.moved) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-mm-id]');
      const id = dragged.id;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (target && target.dataset.mmId !== id) {
        const parentId = target.dataset.mmId;
        mapState.collapsed.delete(parentId);
        safely(() => command({ type: 'move', id, parentId }));
      }
    }
    clearDrag(); pan = null;
  });
  root.addEventListener('pointercancel', () => { clearDrag(); pan = null; });
  return { mapState, isInteracting: () => dialog.open || !!pan || !!dragged };
}
