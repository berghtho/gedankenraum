import { markdownHtml } from './markdown.mjs';
import { fold, hitsIn, hostOf, pathOf } from './search.mjs';
import { html, isWebUrl } from './util.mjs';

const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const MAX_HITS = 500;

// Lesen lohnt sich bei eigenem Text; Links haben nur ihre Zusammenfassung und bleiben in der Seitenansicht.
export const canRead = (idea) => !!idea && idea.source !== 'link' && !!String(idea.input ?? '').trim();

// Lesemodus: der ganze Text als Markdown auf einer ruhigen Seite, bei längeren Dokumenten mit Inhaltsverzeichnis.
// Liest nur; Bearbeiten schließt den Lesemodus und öffnet den passenden Editor.
export function initReader({ root, find, terms = () => [], edit, canOpen = () => true }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'ib-dialog ib-reader';
  dialog.setAttribute('aria-labelledby', 'reader-title');
  root.append(dialog);
  // Leseposition je Gedanke, solange der Tab offen ist.
  const positions = new Map();
  let current = null;
  let hits = [];
  let hitIndex = -1;
  const q = (selector) => dialog.querySelector(selector);

  const markHits = (list) => {
    hits = []; hitIndex = -1;
    if (!list.length) return;
    const walker = document.createTreeWalker(q('.ib-reader-page'), NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (hits.length >= MAX_HITS) break;
      const ranges = hitsIn(node.data, list);
      if (!ranges.length) continue;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const { start, end } of ranges) {
        const mark = document.createElement('mark');
        mark.className = 'ib-hit';
        mark.textContent = node.data.slice(start, end);
        fragment.append(node.data.slice(cursor, start), mark);
        hits.push(mark);
        cursor = end;
      }
      fragment.append(node.data.slice(cursor));
      node.replaceWith(fragment);
    }
  };
  const jump = (index) => {
    if (!hits.length) return;
    hits[hitIndex]?.classList.remove('is-current');
    hitIndex = (index + hits.length) % hits.length;
    hits[hitIndex].classList.add('is-current');
    hits[hitIndex].scrollIntoView({ block: 'center' });
    q('[data-reader-hit-count]').textContent = `Treffer ${hitIndex + 1} / ${hits.length}${hits.length >= MAX_HITS ? '+' : ''}`;
  };

  const open = (id) => {
    if (dialog.open) return;
    const idea = find(id);
    if (!canRead(idea) || !canOpen()) return;
    current = idea;
    // Ist die erste Zeile nur der Titel, steht er nicht doppelt da.
    const bare = (line) => fold(line.replace(/^#+\s*/, '').replace(/[.!?…:]+$/, '').trim());
    const [firstLine, ...rest] = idea.input.trim().split('\n');
    const body = markdownHtml(bare(firstLine) === bare(idea.title) ? rest.join('\n') : idea.input);
    const notes = idea.notes?.trim() ? markdownHtml(idea.notes, { idPrefix: 'ib-md-note-' }).html : '';
    const toc = body.headings.filter((heading) => heading.level <= 3 && heading.text);
    const minutes = Math.max(1, Math.round(idea.input.split(/\s+/).filter(Boolean).length / 200));
    const kind = [idea.source === 'digest' ? 'DIGEST' : 'NOTIZ', DATE.format(new Date(idea.createdAt)), `${minutes} MIN. LESEZEIT`].join(' · ');
    const videos = (idea.sourceUrls ?? []).filter(isWebUrl);
    dialog.innerHTML = `<div class="ib-reader-head">
        <span class="ib-reader-kind">${html(kind)}</span>
        <span class="ib-reader-hits" data-reader-hits hidden><span data-reader-hit-count></span><button type="button" data-reader-hit="-1" aria-label="Vorheriger Treffer">↑</button><button type="button" data-reader-hit="1" aria-label="Nächster Treffer">↓</button></span>
        <span class="ib-reader-actions"><button type="button" data-reader-copy>Kopieren</button>${edit ? '<button type="button" data-reader-edit>Bearbeiten</button>' : ''}<button class="ib-dialog-close" type="button" data-reader-close aria-label="Lesemodus schließen">×</button></span>
      </div>
      <div class="ib-reader-body" data-reader-scroll tabindex="-1">
        ${toc.length >= 3 ? `<nav class="ib-reader-toc" aria-label="Inhalt"><span>INHALT</span>${toc.map((heading) => `<button type="button" class="is-l${heading.level}" data-reader-jump="${html(heading.id)}">${html(heading.text)}</button>`).join('')}</nav>` : ''}
        <article class="ib-reader-page">
          <h2 id="reader-title">${html(idea.title)}</h2>
          ${videos.length ? `<div class="ib-research-sources ib-reader-sources">${videos.map((url, index) => `<a href="${html(url)}" target="_blank" rel="noreferrer" title="${html(url)}">Video ${index + 1} · ${html(hostOf(url))}${html(pathOf(url))} ↗</a>`).join('')}</div>` : ''}
          <div class="ib-md">${body.html}</div>
          ${notes ? `<section class="ib-reader-notes"><h3>EIGENE ERGÄNZUNGEN</h3><div class="ib-md">${notes}</div></section>` : ''}
        </article>
      </div>`;
    dialog.showModal();
    markHits(terms());
    const scroller = q('[data-reader-scroll]');
    scroller.focus({ preventScroll: true });
    if (hits.length) { q('[data-reader-hits]').hidden = false; jump(0); } else scroller.scrollTop = positions.get(idea.id) ?? 0;
  };

  dialog.addEventListener('close', () => {
    if (current) positions.set(current.id, q('[data-reader-scroll]')?.scrollTop ?? 0);
    current = null; hits = [];
  });
  dialog.addEventListener('click', async (event) => {
    const target = event.target;
    if (target.closest('[data-reader-close]')) { dialog.close(); return; }
    const heading = target.closest('[data-reader-jump]');
    if (heading) { dialog.querySelector(`[id="${CSS.escape(heading.dataset.readerJump)}"]`)?.scrollIntoView({ block: 'start' }); return; }
    const hit = target.closest('[data-reader-hit]');
    if (hit) { jump(hitIndex + Number(hit.dataset.readerHit)); return; }
    if (target.closest('[data-reader-edit]')) { const idea = current; dialog.close(); edit(idea); return; }
    const copy = target.closest('[data-reader-copy]');
    if (copy && current) {
      try { await navigator.clipboard.writeText(current.input); copy.textContent = 'Kopiert'; } catch { copy.textContent = 'Nicht kopiert'; }
      setTimeout(() => { copy.textContent = 'Kopieren'; }, 1_500);
    }
  });
  // F3 und Enter springen zum nächsten Treffer, Shift zurück.
  dialog.addEventListener('keydown', (event) => {
    if (!hits.length || !(event.key === 'F3' || (event.key === 'Enter' && event.target === q('[data-reader-scroll]')))) return;
    event.preventDefault();
    jump(hitIndex + (event.shiftKey ? -1 : 1));
  });
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-reader-open]');
    if (button) open(button.dataset.readerOpen);
  });
  return { open, isOpen: () => dialog.open };
}
