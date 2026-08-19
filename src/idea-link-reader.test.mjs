import assert from 'node:assert/strict';
import test from 'node:test';

import { createIdeaLinkReader } from './idea-link-reader.mjs';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];

test('link reader extracts bounded readable HTML', async () => {
  const read = createIdeaLinkReader({
    resolveHost: publicDns,
    fetchPage: async () => new Response('<title>Nützlich &amp; klein</title><script>ignore()</script><main>Hallo Architektur.</main>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  });
  const page = await read('https://example.com/post');
  assert.equal(page.title, 'Nützlich & klein');
  assert.equal(page.text, 'Hallo Architektur.');
});

test('link reader refuses private destinations before fetching', async () => {
  let fetched = false;
  const read = createIdeaLinkReader({
    resolveHost: async () => [{ address: '127.0.0.1', family: 4 }],
    fetchPage: async () => { fetched = true; return new Response('no'); },
  });
  await assert.rejects(() => read('http://internal.example/test'), /Private oder lokale/);
  assert.equal(fetched, false);
});

test('link reader refuses IPv4-mapped IPv6 destinations', async () => {
  let fetched = false;
  const read = createIdeaLinkReader({
    resolveHost: async () => [{ address: '::ffff:127.0.0.1', family: 6 }],
    fetchPage: async () => { fetched = true; return new Response('no'); },
  });
  await assert.rejects(() => read('http://internal.example/test'), /Private oder lokale/);
  assert.equal(fetched, false);
});

test('link reader passes the validated address to the HTTP implementation', async () => {
  let target;
  const read = createIdeaLinkReader({
    resolveHost: publicDns,
    fetchPage: async (validatedTarget) => {
      target = validatedTarget;
      return new Response('Öffentlicher Inhalt.', { headers: { 'content-type': 'text/plain' } });
    },
  });
  await read('https://example.com/post');
  assert.deepEqual(target.addresses, [{ address: '93.184.216.34', family: 4 }]);
});

test('link reader rejects oversized pages', async () => {
  const read = createIdeaLinkReader({
    resolveHost: publicDns,
    fetchPage: async () => new Response('x', {
      headers: { 'content-type': 'text/plain', 'content-length': String(2 * 1024 * 1024 + 1) },
    }),
  });
  await assert.rejects(() => read('https://example.com/large'), /zu groß/);
});
