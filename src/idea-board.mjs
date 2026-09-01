import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { atomicReplaceText } from './atomic-file.mjs';

const MAX_INPUT = 12_000;
const MAX_TEXT = 60_000;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 40;

export class IdeaBoardValidationError extends Error {}

const clean = (value, fallback = '') => typeof value === 'string' && value.trim()
  ? value.trim().replace(/\s+/g, ' ')
  : fallback;

const cleanTag = (value) => clean(value).replace(/^#+/, '').trim().slice(0, MAX_TAG_LENGTH);
const sameTag = (left, right) => left.toLocaleLowerCase('de-DE') === right.toLocaleLowerCase('de-DE');

function normalizedTags(value) {
  if (!Array.isArray(value)) throw new IdeaBoardValidationError('Tags müssen eine Liste sein.');
  const tags = [];
  for (const item of value) {
    const tag = cleanTag(item);
    if (!tag || tags.some((known) => sameTag(known, tag))) continue;
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS) throw new IdeaBoardValidationError(`Höchstens ${MAX_TAGS} Tags pro Gedanke.`);
  return tags;
}

const tagsOf = (idea) => Array.isArray(idea.tags) ? idea.tags : [];

function normalizedAnalysis(value, fallbackTitle) {
  const title = clean(value?.title, fallbackTitle).slice(0, 160);
  const summary = clean(value?.summary, fallbackTitle).slice(0, 1_200);
  const keyPoints = Array.isArray(value?.keyPoints)
    ? value.keyPoints.map((item) => clean(item)).filter(Boolean).slice(0, 4)
    : [];
  const keywords = Array.isArray(value?.keywords)
    ? [...new Set(value.keywords.map((item) => clean(item)).filter(Boolean))].slice(0, 6)
    : [];
  const topic = clean(value?.topic, 'Unsortiert').slice(0, 80);
  return { title, summary, keyPoints, keywords, topic };
}

const emptyState = () => ({ version: 1, ideas: [] });

export class IdeaBoard {
  constructor({ path, analyze, readLink, now = () => new Date(), makeId = randomUUID }) {
    if (!path || typeof path !== 'string') throw new TypeError('IdeaBoard requires a state path');
    if (typeof analyze !== 'function') throw new TypeError('IdeaBoard requires an analyzer');
    if (typeof readLink !== 'function') throw new TypeError('IdeaBoard requires a link reader');
    this.path = path;
    this.analyze = analyze;
    this.readLink = readLink;
    this.now = now;
    this.makeId = makeId;
    this.pending = Promise.resolve();
  }

  snapshot() {
    return { ideas: structuredClone(this.#read().ideas) };
  }

  execute(command) {
    const operation = this.pending.then(() => this.#execute(command));
    this.pending = operation.catch(() => {});
    return operation;
  }

  switchStorage(path, mode = 'open') {
    if (!path || typeof path !== 'string') throw new TypeError('IdeaBoard requires a state path');
    if (!['open', 'merge', 'replace'].includes(mode)) throw new TypeError('Unknown storage switch mode');
    const operation = this.pending.then(() => this.#switchStorage(path, mode));
    this.pending = operation.catch(() => {});
    return operation;
  }

  importState(imported) {
    const operation = this.pending.then(() => this.#importState(imported));
    this.pending = operation.catch(() => {});
    return operation;
  }

  async #execute(command) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new IdeaBoardValidationError('command must be an object');
    }
    if (command.type === 'capture') return this.#capture(command);
    if (command.type === 'retopic') return this.#retopic(command);
    if (command.type === 'retag') return this.#retag(command);
    if (command.type === 'renametag') return this.#renameTag(command);
    if (command.type === 'delete') return this.#delete(command);
    throw new IdeaBoardValidationError(`unsupported command: ${clean(command.type, '(empty)')}`);
  }

  async #capture(command) {
    const keep = command.keep === true;
    const raw = typeof command.input === 'string' ? command.input.replace(/\r\n?/g, '\n').trim() : '';
    const input = keep ? raw : clean(raw);
    if (!input) throw new IdeaBoardValidationError('Bitte eine Notiz, einen Text oder einen Link eingeben.');
    if (keep && input.length > MAX_TEXT) throw new IdeaBoardValidationError(`Textnotiz überschreitet ${MAX_TEXT} Zeichen.`);
    if (!keep && input.length > MAX_INPUT) {
      throw new IdeaBoardValidationError(`Eingabe überschreitet ${MAX_INPUT} Zeichen. Längere Texte als Textnotiz aufbewahren.`);
    }

    const state = this.#read();
    const isLink = !keep && /^https?:\/\/\S+$/i.test(input);
    let source = { kind: keep ? 'text' : 'note', text: input, url: null, pageTitle: null };
    if (isLink) {
      try {
        const page = await this.readLink(input);
        source = { kind: 'link', text: page.text, url: page.url, pageTitle: page.title ?? null };
      } catch (error) {
        throw new IdeaBoardValidationError(`Link konnte nicht gelesen werden: ${error.message}`);
      }
    }

    const existingTopics = [...new Set(state.ideas.map((idea) => idea.topic))];
    const existingTags = [...new Set(state.ideas.flatMap(tagsOf))];
    const result = await this.analyze({ input, source, existingTopics, existingTags });
    const fallbackTitle = source.pageTitle || (isLink ? new URL(input).hostname : clean(input).slice(0, 90));
    const analysis = normalizedAnalysis(result.analysis ?? result, fallbackTitle);
    const createdAt = this.now().toISOString();
    const idea = {
      id: this.makeId(),
      ...analysis,
      // Schlagwörter (keywords) sind Vorschläge der Analyse; tags bestätigt der Mensch.
      tags: [],
      source: source.kind,
      url: source.url,
      input,
      createdAt,
      updatedAt: createdAt,
      engine: clean(result.engine, 'Lokale Analyse'),
    };
    state.ideas.unshift(idea);
    this.#write(state);
    return { idea: structuredClone(idea), warning: clean(result.warning) || null };
  }

  #retopic(command) {
    const state = this.#read();
    const idea = state.ideas.find((candidate) => candidate.id === clean(command.id));
    if (!idea) throw new IdeaBoardValidationError('Gedanke wurde nicht gefunden.');
    const topic = clean(command.topic);
    if (!topic) throw new IdeaBoardValidationError('Thema darf nicht leer sein.');
    idea.topic = topic.slice(0, 80);
    idea.updatedAt = this.now().toISOString();
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #retag(command) {
    const state = this.#read();
    const idea = state.ideas.find((candidate) => candidate.id === clean(command.id));
    if (!idea) throw new IdeaBoardValidationError('Gedanke wurde nicht gefunden.');
    const tags = normalizedTags(command.tags);
    // Bestehende Schreibweise eines Tags in der Sammlung übernehmen, damit #ai und #AI nicht auseinanderlaufen.
    const known = new Map();
    for (const other of state.ideas) for (const tag of tagsOf(other)) known.set(tag.toLocaleLowerCase('de-DE'), tag);
    idea.tags = tags.map((tag) => known.get(tag.toLocaleLowerCase('de-DE')) ?? tag);
    idea.updatedAt = this.now().toISOString();
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #renameTag(command) {
    const from = cleanTag(command.from);
    const to = cleanTag(command.to);
    if (!from || !to) throw new IdeaBoardValidationError('Tag darf nicht leer sein.');
    const state = this.#read();
    const existing = state.ideas.flatMap(tagsOf).find((tag) => sameTag(tag, to) && tag !== from);
    const target = existing ?? to;
    const merged = !!existing && !sameTag(from, to);
    let changed = 0;
    const updatedAt = this.now().toISOString();
    for (const idea of state.ideas) {
      const tags = tagsOf(idea);
      if (!tags.some((tag) => sameTag(tag, from))) continue;
      const next = [];
      for (const tag of tags) {
        const replacement = sameTag(tag, from) ? target : tag;
        if (!next.some((known) => sameTag(known, replacement))) next.push(replacement);
      }
      idea.tags = next;
      idea.updatedAt = updatedAt;
      changed += 1;
    }
    if (!changed) throw new IdeaBoardValidationError('Tag wurde nicht gefunden.');
    this.#write(state);
    return { ideas: structuredClone(state.ideas), tag: target, merged, changed };
  }

  #delete(command) {
    const state = this.#read();
    const index = state.ideas.findIndex((candidate) => candidate.id === clean(command.id));
    if (index < 0) throw new IdeaBoardValidationError('Gedanke wurde nicht gefunden.');
    const [idea] = state.ideas.splice(index, 1);
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #switchStorage(path, mode) {
    if (path === this.path) return { ...this.snapshot(), created: false, action: 'unchanged' };
    const created = !existsSync(path);
    const current = this.#read();
    let state = current;
    if (!created && mode === 'open') state = this.#readFrom(path);
    if (!created && mode === 'merge') {
      const target = this.#readFrom(path);
      const currentIds = new Set(current.ideas.map((idea) => idea.id).filter((id) => typeof id === 'string'));
      state = {
        version: 1,
        ideas: [...current.ideas, ...target.ideas.filter((idea) => !currentIds.has(idea.id))],
      };
    }
    if (created || mode !== 'open') atomicReplaceText(path, `${JSON.stringify(state, null, 2)}\n`);
    this.path = path;
    return { ideas: structuredClone(state.ideas), created, action: created ? 'created' : mode };
  }

  #importState(imported) {
    this.#validateState(imported);
    const current = this.#read();
    const knownIds = new Set(current.ideas.map((idea) => idea.id));
    const additions = [];
    let skipped = 0;
    for (const idea of imported.ideas) {
      if (knownIds.has(idea.id)) {
        skipped += 1;
        continue;
      }
      knownIds.add(idea.id);
      additions.push(idea);
    }
    const state = { version: 1, ideas: [...current.ideas, ...additions] };
    if (additions.length) this.#write(state);
    return {
      ideas: structuredClone(state.ideas),
      imported: additions.length,
      skipped,
    };
  }

  #read() {
    return existsSync(this.path) ? this.#readFrom(this.path) : emptyState();
  }

  #readFrom(path) {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    this.#validateState(parsed);
    return parsed;
  }

  #validateState(state) {
    if (state?.version !== 1 || !Array.isArray(state.ideas)) {
      throw new IdeaBoardValidationError('Die Datendatei hat ein unbekanntes Format.');
    }
    if (state.ideas.some((idea) => !idea || typeof idea !== 'object' || Array.isArray(idea)
      || typeof idea.id !== 'string' || !idea.id.trim())) {
      throw new IdeaBoardValidationError('Die Datendatei enthält ungültige Gedanken.');
    }
  }

  #write(state) {
    atomicReplaceText(this.path, `${JSON.stringify(state, null, 2)}\n`);
  }
}
