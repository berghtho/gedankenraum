const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// Drafts live outside rendered DOM so background snapshots cannot erase typing.
export function initInlineThought({ root, command, render, reveal, notify, selected }) {
  let draft = null;
  let saving = false;
  const close = () => { const id = draft?.id ?? draft?.anchorId; draft = null; render(); if (id) reveal(id, false); else root.querySelector('[data-idea-input]')?.focus(); };
  const focus = () => root.querySelector('[data-inline-editor] textarea')?.focus();
  const open = (next) => {
    if (draft) { focus(); return; }
    draft = next; render(); focus();
  };
  const openEdit = (idea = selected()) => {
    if (!idea) return;
    open({ type: 'edit', id: idea.id, title: idea.title, input: idea.source === 'link' ? idea.notes ?? '' : idea.input ?? '', field: idea.source === 'link' ? 'notes' : 'input', original: structuredClone(idea) });
  };
  const openNew = (kind = 'root', idea = selected()) => open({
    type: 'new', title: '', input: '', anchorId: idea?.id,
    parentId: kind === 'child' ? idea?.id : kind === 'sibling' ? idea?.parentId : null,
    label: kind === 'child' ? 'Untergedanke' : kind === 'sibling' ? 'Weiterdenken' : 'Neuer Gedanke',
  });
  root.addEventListener('input', (event) => {
    if (draft && event.target.closest('[data-inline-editor]')) draft[event.target.name] = event.target.value;
  });
  root.addEventListener('click', (event) => { if (event.target.closest('[data-inline-cancel]') && !saving) close(); });
  root.addEventListener('keydown', (event) => {
    const form = event.target.closest('[data-inline-editor]'); if (!form) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!saving) close(); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); }
  });
  root.addEventListener('submit', async (event) => {
    if (!event.target.matches('[data-inline-editor]')) return;
    event.preventDefault(); if (!draft || saving) return;
    const current = draft; saving = true;
    event.target.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      let result;
      if (current.type === 'edit') {
        const fields = {};
        if (current.title.trim() !== current.original.title) fields.title = current.title.trim();
        if (current.input.trim() !== (current.original[current.field] ?? '')) fields[current.field] = current.input.trim();
        result = await command({ type: 'edit', id: current.id, fields });
      } else result = await command({ type: 'capture', input: current.input, keep: true, parentId: current.parentId });
      draft = null; render(); reveal(result.idea.id, false); notify('Gespeichert.');
    } catch (error) {
      notify(error.message, true);
      root.querySelectorAll('[data-inline-editor] button').forEach((button) => { button.disabled = false; });
    } finally { saving = false; }
  });
  return {
    openEdit, openNew, isEditing: () => !!draft, focus,
    decorate() {
      if (!draft) return;
      const id = draft.id ?? draft.anchorId;
      const target = [...root.querySelectorAll('[data-idea-map] [data-idea-id]')].find((node) => node.dataset.ideaId === id);
      const form = document.createElement('form'); form.className = 'ib-inline-editor'; form.dataset.inlineEditor = '';
      form.setAttribute('aria-label', draft.type === 'edit' ? 'Gedanken bearbeiten' : draft.label);
      form.innerHTML = `${draft.type === 'edit' ? `<label>Titel<input name="title" required maxlength="160" value="${html(draft.title)}"></label>` : `<span>${html(draft.label)}</span>`}<label>${draft.field === 'notes' ? 'Eigene Ergänzungen zur Linkquelle' : 'Dein Gedanke'}<textarea name="input" ${draft.field === 'notes' ? '' : 'required'} maxlength="60000" rows="5" placeholder="Hier darf es unfertig sein …">${html(draft.input)}</textarea></label><div><button type="button" data-inline-cancel ${saving ? 'disabled' : ''}>Verwerfen</button><button type="submit" ${saving ? 'disabled' : ''}>${saving ? 'Speichert …' : 'Speichern'}</button></div>`;
      const node = target?.closest('.ib-mm-node');
      if (node) { node.classList.add('is-editing'); node.append(form); }
      else if (target) { const wrapper = target.closest('.ib-thought-card'); if (wrapper) wrapper.append(form); else target.after(form); }
      else root.querySelector('[data-idea-map]').prepend(form);
    },
  };
}
