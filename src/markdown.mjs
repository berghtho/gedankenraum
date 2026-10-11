import { html, webUrl } from './util.mjs';

// Kleines Markdown für den Lesemodus. Roh-HTML bleibt Text, Links gibt es nur für http(s),
// Bilder werden nicht geladen. Einzelne Zeilenumbrüche bleiben sichtbar, weil Notizen meist so geschrieben sind.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const TABLE_RULE = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;
const SLOT = /\u0000(\d+)\u0000/g;
const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!~|<>])/g;

const leadOf = (line) => line.length - line.trimStart().length;
const startsBlock = (line) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line);
const isTable = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-')
  && lines[i + 1].includes('|') && TABLE_RULE.test(lines[i + 1]);
const plain = (text) => text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\\(.)/g, '$1').replace(/[*_`~]/g, '').trim();

// Eine abschließende Klammer gehört nur dann zur Adresse, wenn sie eine geöffnete schließt.
function trimUrl(url) {
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (/[.,;:!?'"]/.test(last)) { end -= 1; continue; }
    if (last === ')' && (url.slice(0, end).match(/\(/g)?.length ?? 0) < (url.slice(0, end).match(/\)/g)?.length ?? 0)) { end -= 1; continue; }
    return url.slice(0, end);
  }
}

const anchor = (url, label) => `<a href="${html(url)}" target="_blank" rel="noreferrer">${label}</a>`;

export function inlineMarkdown(text, { links = true } = {}) {
  const slots = [];
  const keep = (markup) => `\u0000${slots.push(markup) - 1}\u0000`;
  let out = String(text ?? '').replace(/\u0000/g, '')
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, ticks, code) => keep(`<code>${html(code.replace(/^ (.*) $/s, '$1'))}</code>`))
    .replace(ESCAPABLE, (_, char) => keep(html(char)));
  if (links) {
    out = out
      .replace(/(!?)\[([^\]\n]*)\]\(\s*<?((?:[^\s()<>]|\([^\s()<>]*\))+)>?(?:\s+"[^"\n]*")?\s*\)/g, (match, image, label, url) => {
        const target = webUrl(url);
        const text = inlineMarkdown(label || (image ? 'Bild' : url), { links: false });
        if (!target) return keep(text);
        return keep(anchor(target, image ? `Bild: ${text}` : text));
      })
      .replace(/<(https?:\/\/[^\s<>]+)>/g, (match, url) => (webUrl(url) ? keep(anchor(webUrl(url), html(url))) : match))
      .replace(/https?:\/\/[^\s<>\u0000]+/g, (match) => {
        const url = trimUrl(match);
        const target = webUrl(url);
        return target ? keep(anchor(target, html(url))) + match.slice(url.length) : match;
      });
  }
  out = html(out)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu, '<strong>$1</strong>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/(?<!\*)\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<![\p{L}\p{N}_])_(?=[^\s_])([^_]*?[^\s_])_(?![\p{L}\p{N}_])/gu, '<em>$1</em>')
    .replace(/[ \t]*\n/g, '<br>\n');
  return out.replace(SLOT, (_, index) => slots[index]);
}

function tableMarkup(rows) {
  const cells = (row) => row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim());
  const align = cells(rows[1]).map((cell) => (cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : cell.startsWith(':') ? 'left' : null));
  const head = cells(rows[0]);
  const cell = (tag, text, index) => `<${tag}${align[index] ? ` style="text-align:${align[index]}"` : ''}>${inlineMarkdown(text)}</${tag}>`;
  const body = rows.slice(2).map((row) => `<tr>${head.map((_, index) => cell('td', cells(row)[index] ?? '', index)).join('')}</tr>`).join('');
  return `<div class="ib-md-table"><table><thead><tr>${head.map((text, index) => cell('th', text, index)).join('')}</tr></thead>${body ? `<tbody>${body}</tbody>` : ''}</table></div>`;
}

function listMarkup(lines, start, ctx) {
  const first = LIST.exec(lines[start]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const match = LIST.exec(lines[i]);
    if (!match || match[1].length !== indent || /\d/.test(match[2]) !== ordered || RULE.test(lines[i])) break;
    // Folgezeilen werden um die Einrückung des Inhalts gekürzt; tiefer eingerückte Listen werden so verschachtelt.
    const contentIndent = indent + match[2].length + Math.min(match[3].length || 1, 4);
    const content = [match[4]];
    i += 1;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { content.push(''); i += 1; continue; }
      const lead = leadOf(line);
      if (lead > indent) { content.push(line.slice(Math.min(lead, contentIndent))); i += 1; continue; }
      if (content[content.length - 1] !== '' && !LIST.test(line) && !startsBlock(line)) { content.push(line.trim()); i += 1; continue; }
      break;
    }
    while (content.length > 1 && content[content.length - 1] === '') content.pop();
    let task = '';
    const box = /^\[([ xX])\][ \t]+/.exec(content[0]);
    if (box) { content[0] = content[0].slice(box[0].length); task = `<span class="ib-md-task" aria-hidden="true">${box[1] === ' ' ? '☐' : '☑'}</span>`; }
    items.push(task + render(content, ctx, { tight: !content.includes('') }));
  }
  const number = Number.parseInt(first[2], 10);
  const open = ordered ? `<ol${number !== 1 ? ` start="${number}"` : ''}>` : '<ul>';
  return { markup: `${open}${items.map((item) => `<li>${item}</li>`).join('')}${ordered ? '</ol>' : '</ul>'}`, next: i };
}

function render(lines, ctx, { tight = false } = {}) {
  const out = [];
  const paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    const text = inlineMarkdown(paragraph.join('\n'));
    out.push(tight ? text : `<p>${text}</p>`);
    paragraph.length = 0;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let match;
    if (!line.trim()) { flush(); i += 1; continue; }
    if ((match = FENCE.exec(line))) {
      flush();
      const close = new RegExp(`^ {0,3}${match[1][0] === '`' ? '`' : '~'}{${match[1].length},}[ \\t]*$`);
      const code = [];
      for (i += 1; i < lines.length && !close.test(lines[i]); i += 1) code.push(lines[i]);
      i += 1;
      out.push(`<pre><code>${html(code.join('\n'))}</code></pre>`);
      continue;
    }
    if ((match = HEADING.exec(line))) {
      flush();
      const level = match[1].length;
      const text = match[2] ?? '';
      const id = `${ctx.prefix}${ctx.headings.length + 1}`;
      ctx.headings.push({ id, level, text: plain(text) });
      out.push(`<h${level} id="${id}">${inlineMarkdown(text)}</h${level}>`);
      i += 1; continue;
    }
    if (RULE.test(line)) { flush(); out.push('<hr>'); i += 1; continue; }
    if (QUOTE.test(line)) {
      flush();
      const quoted = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i += 1) quoted.push(lines[i].replace(QUOTE, ''));
      out.push(`<blockquote>${render(quoted, ctx)}</blockquote>`);
      continue;
    }
    if (isTable(lines, i)) {
      flush();
      const rows = [lines[i], lines[i + 1]];
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|'); i += 1) rows.push(lines[i]);
      out.push(tableMarkup(rows));
      continue;
    }
    // Eine nummerierte Liste unterbricht einen Absatz nur, wenn sie mit 1 beginnt („im\n2. Halbjahr“ bleibt Text).
    if ((match = LIST.exec(line)) && match[4].trim() && (!paragraph.length || !/\d/.test(match[2]) || Number.parseInt(match[2], 10) === 1)) {
      flush();
      const list = listMarkup(lines, i, ctx);
      out.push(list.markup);
      i = list.next;
      continue;
    }
    paragraph.push(line.trim());
    i += 1;
  }
  flush();
  return out.join('\n');
}

// Überschriften bekommen fortlaufende IDs mit Präfix, damit zwei Texte auf einer Seite sich nicht stören.
export function markdownHtml(text, { idPrefix = 'ib-md-' } = {}) {
  const ctx = { headings: [], prefix: idPrefix };
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return { html: render(lines, ctx), headings: ctx.headings };
}
