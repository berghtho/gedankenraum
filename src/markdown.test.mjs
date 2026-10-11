import assert from 'node:assert/strict';
import test from 'node:test';

import { inlineMarkdown, markdownHtml } from './markdown.mjs';

test('headings, paragraphs and rules; single line breaks stay visible', () => {
  const { html, headings } = markdownHtml('# Theo\n\nErste Zeile\nzweite Zeile\n\n---\n\n## Primeagen ##\n#hashtag bleibt Text');
  assert.match(html, /<h1 id="ib-md-1">Theo<\/h1>/);
  assert.match(html, /<p>Erste Zeile<br>\nzweite Zeile<\/p>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<h2 id="ib-md-2">Primeagen<\/h2>/);
  assert.match(html, /<p>#hashtag bleibt Text<\/p>/);
  assert.deepEqual(headings, [{ id: 'ib-md-1', level: 1, text: 'Theo' }, { id: 'ib-md-2', level: 2, text: 'Primeagen' }]);
  assert.equal(markdownHtml('## A', { idPrefix: 'n-' }).headings[0].id, 'n-1');
});

test('nested, ordered, loose and task lists', () => {
  const { html } = markdownHtml('Punkte:\n- eins\n  - unter\n    - tiefer\n- zwei\n\n3. drei\n4. vier\n\n- [x] erledigt\n- [ ] offen');
  assert.match(html, /<p>Punkte:<\/p>\n<ul><li>eins\n<ul><li>unter\n<ul><li>tiefer<\/li><\/ul><\/li><\/ul><\/li><li>zwei<\/li><\/ul>/);
  assert.match(html, /<ol start="3"><li>drei<\/li><li>vier<\/li><\/ol>/);
  assert.match(html, /<li><span class="ib-md-task" aria-hidden="true">☑<\/span>erledigt<\/li>/);
  assert.match(markdownHtml('- a\n\n  noch a\n- b').html, /<li><p>a<\/p>\n<p>noch a<\/p><\/li><li>b<\/li>/);
  assert.match(markdownHtml('im\n2. Halbjahr').html, /<p>im<br>\n2\. Halbjahr<\/p>/);
  assert.match(markdownHtml('- - -').html, /^<hr>$/);
});

test('code, quotes and tables', () => {
  const { html } = markdownHtml('```js\nconst a = "<b>";\n\n# kein Titel\n```\n> zitiert\n> **fett**\n\n| Video | Dauer |\n|:--|--:|\n| A | 3 |\n| B |');
  assert.match(html, /<pre><code>const a = &quot;&lt;b&gt;&quot;;\n\n# kein Titel<\/code><\/pre>/);
  assert.match(html, /<blockquote><p>zitiert<br>\n<strong>fett<\/strong><\/p><\/blockquote>/);
  assert.match(html, /<th style="text-align:left">Video<\/th><th style="text-align:right">Dauer<\/th>/);
  assert.match(html, /<tr><td style="text-align:left">B<\/td><td style="text-align:right"><\/td><\/tr>/);
});

test('inline emphasis, code and links; snake_case and lone stars stay text', () => {
  assert.equal(inlineMarkdown('**fett** und *kursiv* und _auch_ und ~~weg~~'), '<strong>fett</strong> und <em>kursiv</em> und <em>auch</em> und <del>weg</del>');
  assert.equal(inlineMarkdown('snake_case_name und 2 * 3 * 4'), 'snake_case_name und 2 * 3 * 4');
  assert.equal(inlineMarkdown('`a **b** <c>`'), '<code>a **b** &lt;c&gt;</code>');
  assert.equal(inlineMarkdown('\\*kein\\* Stern'), '*kein* Stern');
  assert.equal(inlineMarkdown('[**Video**](https://youtu.be/x_y)'), '<a href="https://youtu.be/x_y" target="_blank" rel="noreferrer"><strong>Video</strong></a>');
  assert.equal(inlineMarkdown('Siehe https://de.wikipedia.org/wiki/Foo_(Bar). Und (https://a.example/b).'),
    'Siehe <a href="https://de.wikipedia.org/wiki/Foo_(Bar)" target="_blank" rel="noreferrer">https://de.wikipedia.org/wiki/Foo_(Bar)</a>. Und (<a href="https://a.example/b" target="_blank" rel="noreferrer">https://a.example/b</a>).');
  assert.equal(inlineMarkdown('<https://a.example/?q=1&r=2>'), '<a href="https://a.example/?q=1&amp;r=2" target="_blank" rel="noreferrer">https://a.example/?q=1&amp;r=2</a>');
});

test('raw html, script links and images never become markup', () => {
  const { html } = markdownHtml('<script>alert(1)</script>\n[klick](javascript:alert(1)) ![bild](https://a.example/x.png) <img src=x onerror=alert(1)>\n\u0000 0 \u0000');
  assert.doesNotMatch(html, /<script|<img|href="javascript/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /klick/);
  assert.match(html, /<a href="https:\/\/a\.example\/x\.png" target="_blank" rel="noreferrer">Bild: bild<\/a>/);
  assert.match(markdownHtml('[x](https://a.example/"onmouseover="alert(1))').html, /href="https:\/\/a\.example\/%22onmouseover=%22alert\(1\)"/);
});

test('a long digest renders quickly', () => {
  const section = '## Kanal\n\n- **Punkt** mit [Link](https://a.example/x) und `code`\n  - Detail https://b.example/y\n\nAbsatz mit *Betonung*.\n\n';
  const text = section.repeat(Math.ceil(500_000 / section.length));
  const started = performance.now();
  const { headings } = markdownHtml(text);
  assert.ok(headings.length > 1000);
  assert.ok(performance.now() - started < 2000);
});
