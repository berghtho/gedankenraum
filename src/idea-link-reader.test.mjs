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

test('link reader uses YouTube metadata when the page body has no useful content', async () => {
  const read = createIdeaLinkReader({
    resolveHost: publicDns,
    fetchPage: async () => new Response(`<!doctype html><html><head>
      <meta property="og:title" content="Warum tiefe Module helfen">
      <meta name="description" content="In diesem Video geht es um kleine Schnittstellen und verborgene Komplexität.">
      <title>Warum tiefe Module helfen - YouTube</title>
      </head><body><script>window.ytInitialData = {};</script></body></html>`, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  });

  const page = await read('https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(page.title, 'Warum tiefe Module helfen');
  assert.equal(page.text, 'In diesem Video geht es um kleine Schnittstellen und verborgene Komplexität.');
});

test('link reader adds a public YouTube caption track to the description', async () => {
  const requests = [];
  const player = {
    videoDetails: { title: 'Deep Modules', shortDescription: 'A talk about module design.' },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk', languageCode: 'en' }],
      },
    },
  };
  const read = createIdeaLinkReader({
    resolveHost: publicDns,
    fetchPage: async (target) => {
      requests.push(target.url.href);
      if (target.url.pathname === '/api/timedtext') {
        return new Response(JSON.stringify({
          events: [
            { segs: [{ utf8: 'Deep modules ' }, { utf8: 'hide complexity.' }] },
            { segs: [{ utf8: 'Small interfaces matter.' }] },
          ],
        }), { headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      return new Response(`<html><head><script>const playerKey = 'ytInitialPlayerResponse';</script>${' '.repeat(250)}
        <script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script></head><body></body></html>`, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    },
  });

  const page = await read('https://youtu.be/abcdefghijk');
  assert.equal(page.title, 'Deep Modules');
  assert.equal(page.text, 'A talk about module design. Transkript: Deep modules hide complexity. Small interfaces matter.');
  assert.equal(requests.length, 2);
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
