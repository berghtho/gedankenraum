import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;

function addressIsPrivate(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) return true;
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') ||
    value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') ||
    value.startsWith('ff');
}

async function publicTarget(value, resolveHost) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Nur HTTP(S)-Links sind erlaubt.');
  if (url.username || url.password) throw new Error('Links mit Zugangsdaten sind nicht erlaubt.');
  if (url.hostname === 'localhost') throw new Error('Lokale Ziele sind nicht erlaubt.');
  const addresses = await resolveHost(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => addressIsPrivate(address))) {
    throw new Error('Private oder lokale Ziele sind nicht erlaubt.');
  }
  return { url, addresses };
}

function requestPinned(target, { headers, signal }) {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = transport(target.url, {
      headers,
      signal,
      lookup(_hostname, options, callback) {
        if (options?.all) callback(null, target.addresses);
        else callback(null, target.addresses[0].address, target.addresses[0].family);
      },
    }, (incoming) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
        else if (value !== undefined) responseHeaders.set(name, value);
      }
      resolve(new Response(Readable.toWeb(incoming), {
        status: incoming.statusCode,
        statusText: incoming.statusMessage,
        headers: responseHeaders,
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function limitedText(response) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new Error('Seite ist zu groß.');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('Seite ist zu groß.');
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? ' ';
    const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : ' ';
  });
}

function readableHtml(html) {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const text = decodeEntities(html
    .replace(/<(head|title|script|style|noscript|svg|canvas|nav|footer|form|dialog)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
  return { title: title || null, text };
}

export function createIdeaLinkReader({ fetchPage = requestPinned, resolveHost = lookup } = {}) {
  return async function readLink(value) {
    let target = await publicTarget(value, resolveHost);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetchPage(target, {
        signal: AbortSignal.timeout(12_000),
        headers: { 'user-agent': 'Gedankenraum/1.0', accept: 'text/html,text/plain;q=0.9' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === MAX_REDIRECTS) throw new Error('Zu viele Weiterleitungen.');
        const location = response.headers.get('location');
        if (!location) throw new Error('Weiterleitung ohne Ziel.');
        target = await publicTarget(new URL(location, target.url).href, resolveHost);
        continue;
      }
      if (!response.ok) throw new Error(`Seite antwortet mit HTTP ${response.status}.`);
      const type = response.headers.get('content-type') ?? '';
      if (!/^(text\/html|text\/plain)(?:;|$)/i.test(type)) throw new Error('Link ist keine lesbare Textseite.');
      const raw = await limitedText(response);
      const content = /text\/html/i.test(type) ? readableHtml(raw) : { title: null, text: raw.replace(/\s+/g, ' ').trim() };
      if (!content.text) throw new Error('Seite enthält keinen lesbaren Text.');
      return { url: target.url.href, ...content };
    }
    throw new Error('Zu viele Weiterleitungen.');
  };
}
