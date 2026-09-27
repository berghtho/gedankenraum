import { similarTagGroups } from './tag-match.mjs';

const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// Tags aufräumen: Schreibvarianten erkennt Gedankenraum selbst, gleichbedeutende Tags schlägt Codex auf Wunsch vor.
// Zusammengelegt wird erst per Klick und je Gruppe; rückgängig wie jede Tag-Änderung.
export function initTagCleanup({ root, snapshot, request, render, notify }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'ib-dialog ib-workspace-dialog';
  dialog.setAttribute('aria-labelledby', 'tag-cleanup-title');
  root.append(dialog);
  let suggested = null;
  let loading = false;
  let error = '';
  const counts = () => {
    const map = new Map();
    for (const idea of snapshot().ideas) for (const tag of idea.tags ?? []) map.set(tag, (map.get(tag) ?? 0) + 1);
    return map;
  };
  const groupMarkup = (group, label, known) => {
    const tags = group.tags.filter((tag) => known.has(tag));
    if (tags.length < 2) return '';
    const into = tags.includes(group.into) ? group.into : tags[0];
    return `<fieldset class="ib-merge-group" data-merge-group>
      <legend>${label}${group.reason ? ` · ${html(group.reason)}` : ''}</legend>
      <div class="ib-merge-tags">${tags.map((tag) => `<label><input type="checkbox" value="${html(tag)}" checked>#${html(tag)}<small>${known.get(tag)}</small></label>`).join('')}</div>
      <div class="ib-merge-row"><label>ZIEL <select>${tags.map((tag) => `<option value="${html(tag)}"${tag === into ? ' selected' : ''}>#${html(tag)}</option>`).join('')}</select></label><button type="button" class="ib-small-btn" data-merge-apply>ZUSAMMENLEGEN</button></div>
    </fieldset>`;
  };
  const draw = () => {
    const known = counts();
    const ordered = [...known].sort(([, left], [, right]) => right - left).map(([tag]) => tag);
    const variants = similarTagGroups(ordered).map((tags) => groupMarkup({ into: tags[0], tags }, 'ÄHNLICHE SCHREIBWEISEN · BITTE PRÜFEN', known)).join('');
    const proposals = (suggested ?? []).map((group) => groupMarkup(group, 'VORSCHLAG VON CODEX', known)).join('');
    dialog.innerHTML = `<div class="ib-dialog-head"><div><span>TAGS</span><h2 id="tag-cleanup-title">Tags aufräumen</h2></div><button class="ib-dialog-close" type="button" data-cleanup-close aria-label="Schließen">✕</button></div>
      <p>${ordered.length} Tags. Schreibvarianten erkennt Gedankenraum selbst. Tags, die dasselbe meinen, kann Codex vorschlagen; dafür gehen nur Tag-Namen und ihre Häufigkeit an Codex. Zusammengelegt wird erst per Klick, rückgängig mit Strg+Z.</p>
      <div class="ib-merge-list">
        ${variants || '<p class="ib-dialog-note">Keine Schreibvarianten gefunden.</p>'}
        ${proposals}
        ${suggested && !proposals ? `<p class="ib-dialog-note">${suggested.length ? 'Alle Vorschläge sind erledigt.' : 'Codex hat keine Tags gefunden, die dasselbe meinen.'}</p>` : ''}
      </div>
      <p class="ib-tools-error" role="alert">${html(error)}</p>
      <div class="ib-dialog-actions"><button type="button" data-cleanup-close>SCHLIESSEN</button><button type="button" class="is-primary" data-cleanup-suggest${loading || ordered.length < 2 ? ' disabled' : ''}>${loading ? 'CODEX PRÜFT …' : suggested ? 'ERNEUT VORSCHLAGEN' : 'ÄHNLICHE TAGS VORSCHLAGEN'}</button></div>`;
  };
  root.addEventListener('click', (event) => {
    if (!event.target.closest('[data-tags-cleanup]')) return;
    error = '';
    draw();
    dialog.showModal();
  });
  dialog.addEventListener('click', async (event) => {
    const target = event.target;
    if (target.closest('[data-cleanup-close]')) { dialog.close(); return; }
    if (target.closest('[data-cleanup-suggest]') && !loading) {
      loading = true; error = ''; draw();
      try { suggested = (await request('/api/tags/suggest', {})).groups; } catch (failure) { error = failure.message; }
      loading = false;
      if (dialog.open) draw();
      return;
    }
    const apply = target.closest('[data-merge-apply]');
    if (!apply) return;
    const group = apply.closest('[data-merge-group]');
    const into = group.querySelector('select').value;
    const tags = [...new Set([into, ...[...group.querySelectorAll('input:checked')].map((input) => input.value)])];
    if (tags.length < 2) { error = 'Bitte mindestens zwei Tags auswählen.'; draw(); return; }
    apply.disabled = true;
    try {
      const result = await request('/api/ideas/execute', { type: 'mergeTags', tags, into });
      error = '';
      notify(`${tags.filter((tag) => tag !== into).map((tag) => `#${tag}`).join(', ')} → #${into} (${result.changed} Gedanke${result.changed === 1 ? '' : 'n'}).`);
      render();
    } catch (failure) { error = failure.message; }
    draw();
  });
}
