import { digestSources, MAX_DIGEST_TEXT } from './digest.mjs';
import { html } from './util.mjs';

export function initDigests({ root, command, reveal, notify, selected, canOpen = () => true }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'ib-dialog ib-digest-dialog';
  dialog.setAttribute('aria-labelledby', 'digest-title');
  root.append(dialog);
  let editing = null;
  let saving = false;
  let reading = false;
  let session = 0;
  const q = (selector) => dialog.querySelector(selector);
  const count = () => {
    const length = q('[name="input"]').value.length;
    q('[data-digest-count]').textContent = `${length.toLocaleString('de-DE')} / 500.000 Zeichen`;
  };
  const open = (idea = null) => {
    if (!canOpen()) return;
    if (dialog.open) return;
    session += 1;
    editing = idea ? structuredClone(idea) : null;
    dialog.innerHTML = `<form>
      <div class="ib-dialog-head"><h2 id="digest-title">${idea ? 'Digest bearbeiten' : 'Digest hinzufügen'}</h2><button class="ib-dialog-close" type="button" data-digest-close aria-label="Schließen">×</button></div>
      <p>Deine Notizen zu einem oder mehreren Videos. Der gesamte Text bleibt gespeichert und durchsuchbar.</p>
      <label class="ib-dialog-field"><span>Titel</span><input name="title" required maxlength="160" value="${html(idea?.title ?? '')}" placeholder="Was nimmst du aus den Videos mit?"></label>
      <label class="ib-dialog-field"><span>Videolinks · optional, einer pro Zeile</span><textarea name="sourceUrls" rows="2" placeholder="https://www.youtube.com/watch?v=…">${html((idea?.sourceUrls ?? []).join('\n'))}</textarea></label>
      <div class="ib-digest-file"><button class="ib-small-btn" type="button" data-digest-file-open>Textdatei einfügen</button><span>.md oder .txt</span><input type="file" accept=".md,.txt,text/plain,text/markdown" data-digest-file hidden></div>
      <label class="ib-dialog-field"><span>Digest</span><textarea name="input" required rows="14" placeholder="Digest hier einfügen oder aufschreiben …">${html(idea?.input ?? '')}</textarea></label>
      <p class="ib-dialog-note" data-digest-count></p>
      <p class="ib-tools-error" role="alert" data-digest-error></p>
      <div class="ib-dialog-actions"><button type="button" data-digest-close>Abbrechen</button><button class="is-primary" type="submit">Digest speichern</button></div>
    </form>`;
    count(); dialog.showModal(); q('[name="title"]').focus();
  };
  const setBusy = () => {
    dialog.querySelectorAll('button, input, textarea').forEach((field) => { field.disabled = saving || reading; });
  };
  const close = () => { if (!saving && !reading) dialog.close(); };
  dialog.addEventListener('cancel', (event) => { if (saving || reading) event.preventDefault(); });
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-digest-close]')) close();
    if (event.target.closest('[data-digest-file-open]')) q('[data-digest-file]').click();
  });
  dialog.addEventListener('input', count);
  dialog.addEventListener('change', async (event) => {
    if (!event.target.matches('[data-digest-file]')) return;
    const file = event.target.files?.[0]; if (!file) return;
    const current = session;
    reading = true; setBusy(); q('[data-digest-error]').textContent = '';
    try {
      if (!/\.(md|txt)$/i.test(file.name)) throw new Error('Bitte eine .md- oder .txt-Datei wählen.');
      if (file.size > MAX_DIGEST_TEXT * 4) throw new Error('Die Datei ist zu groß. Höchstens 500.000 Zeichen pro Digest.');
      const text = (await file.text()).replace(/\r\n?/g, '\n');
      if (current !== session) return;
      const input = q('[name="input"]');
      const next = [input.value, text].filter(Boolean).join('\n\n');
      if (next.length > MAX_DIGEST_TEXT) throw new Error('Höchstens 500.000 Zeichen pro Digest. Der bisherige Text bleibt erhalten.');
      input.value = next;
      if (!q('[name="title"]').value.trim()) q('[name="title"]').value = file.name.replace(/\.(md|txt)$/i, '').slice(0, 160);
      count();
    } catch (error) { q('[data-digest-error]').textContent = error.message; }
    finally { reading = false; setBusy(); event.target.value = ''; }
  });
  dialog.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); q('form').requestSubmit(); }
  });
  dialog.addEventListener('submit', async (event) => {
    event.preventDefault(); if (saving || reading) return;
    q('[data-digest-error]').textContent = '';
    try {
      const data = new FormData(q('form'));
      const input = data.get('input').replace(/\r\n?/g, '\n').trim();
      const title = data.get('title').trim();
      if (!title || !input) throw new Error('Bitte Titel und Digest eingeben.');
      if (input.length > MAX_DIGEST_TEXT) throw new Error('Höchstens 500.000 Zeichen pro Digest.');
      const sourceUrls = digestSources(data.get('sourceUrls').split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
      saving = true; setBusy();
      let result;
      if (editing) {
        const fields = Object.fromEntries(Object.entries({ title, input, sourceUrls })
          .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(editing[key] ?? [])));
        result = await command({ type: 'edit', id: editing.id, fields });
      } else result = await command({ type: 'capture', source: 'digest', title, input, sourceUrls });
      dialog.close(); reveal(result.idea.id); notify('Digest gespeichert.');
    } catch (error) { q('[data-digest-error]').textContent = error.message; }
    finally { saving = false; setBusy(); }
  });
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-digest-new]')) open();
    if (event.target.closest('[data-digest-edit]')) open(selected());
  });
  return { openEdit: open, isEditing: () => dialog.open };
}
