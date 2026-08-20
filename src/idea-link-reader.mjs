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

const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function metaContent(html, names) {
  const wanted = new Set(names);
  const tags = html.match(/<meta\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi) ?? [];
  for (const tag of tags) {
    const attributes = new Map();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    }
    const name = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase();
    if (wanted.has(name) && attributes.has('content')) return compact(decodeEntities(attributes.get('content')));
  }
  return '';
}

function readableHtml(html) {
  const documentTitle = compact(decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''));
  const title = metaContent(html, ['og:title', 'twitter:title']) || documentTitle;
  const description = metaContent(html, ['description', 'og:description', 'twitter:description']);
  const text = compact(decodeEntities(html
    .replace(/<(head|title|script|style|noscript|svg|canvas|nav|footer|form|dialog)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')));
  return { title: title || null, description, text };
}

function embeddedJson(html, marker) {
  let markerAt = html.indexOf(marker);
  while (markerAt >= 0) {
    const start = html.indexOf('{', markerAt + marker.length);
    if (start < 0 || start - markerAt > 200) {
      markerAt = html.indexOf(marker, markerAt + marker.length);
      continue;
    }
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < html.length; index += 1) {
      const character = html[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}' && --depth === 0) {
        try { return JSON.parse(html.slice(start, index + 1)); } catch { break; }
      }
    }
    markerAt = html.indexOf(marker, markerAt + marker.length);
  }
  return null;
}

function youtubeHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
}

function captionText(raw) {
  try {
    const payload = JSON.parse(raw);
    return compact((payload.events ?? [])
      .map((event) => (event.segs ?? []).map((segment) => segment.utf8 ?? '').join(''))
      .join(' '));
  } catch {
    return compact([...raw.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi)]
      .map((match) => decodeEntities(match[1]))
      .join(' ')).slice(0, 40_000);
  }
}

export function createIdeaLinkReader({ fetchPage = requestPinned, resolveHost = lookup } = {}) {
  const fetchFollowing = async (value, headers) => {
    let target = await publicTarget(value, resolveHost);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetchPage(target, { signal: AbortSignal.timeout(12_000), headers });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === MAX_REDIRECTS) throw new Error('Zu viele Weiterleitungen.');
        const location = response.headers.get('location');
        if (!location) throw new Error('Weiterleitung ohne Ziel.');
        target = await publicTarget(new URL(location, target.url).href, resolveHost);
        continue;
      }
      if (!response.ok) throw new Error(`Seite antwortet mit HTTP ${response.status}.`);
      return { response, target };
    }
    throw new Error('Zu viele Weiterleitungen.');
  };

  const youtubeTranscript = async (player) => {
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return '';
    const track = tracks.find((candidate) => candidate.kind !== 'asr') ?? tracks[0];
    if (typeof track?.baseUrl !== 'string') return '';
    const url = new URL(track.baseUrl);
    url.searchParams.set('fmt', 'json3');
    const { response } = await fetchFollowing(url.href, {
      'user-agent': 'Gedankenraum/1.0',
      accept: 'application/json,text/xml;q=0.9,text/plain;q=0.8',
    });
    return captionText(await limitedText(response)).slice(0, 40_000);
  };

  return async function readLink(value) {
    const { response, target } = await fetchFollowing(value, {
      'user-agent': 'Gedankenraum/1.0',
      accept: 'text/html,text/plain;q=0.9',
    });
    const type = response.headers.get('content-type') ?? '';
    if (!/^(text\/html|text\/plain)(?:;|$)/i.test(type)) throw new Error('Link ist keine lesbare Textseite.');
    const raw = await limitedText(response);
    let content = /text\/html/i.test(type)
      ? readableHtml(raw)
      : { title: null, description: '', text: compact(raw) };
    if (/text\/html/i.test(type) && youtubeHost(target.url.hostname)) {
      const player = embeddedJson(raw, 'ytInitialPlayerResponse');
      const title = compact(player?.videoDetails?.title) || content.title;
      const description = compact(player?.videoDetails?.shortDescription) || content.description;
      let transcript = '';
      try { transcript = await youtubeTranscript(player); } catch { /* Metadata remains useful without captions. */ }
      const text = [description, transcript && `Transkript: ${transcript}`].filter(Boolean).join(' ') || content.text;
      content = { title, description, text };
    }
    if (!content.text) throw new Error('Seite enthält keinen lesbaren Text.');
    return { url: target.url.href, title: content.title, text: content.text };
  };
}
