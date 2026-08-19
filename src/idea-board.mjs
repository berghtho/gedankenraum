import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { atomicReplaceText } from './atomic-file.mjs';

const MAX_INPUT = 12_000;

export class IdeaBoardValidationError extends Error {}

const clean = (value, fallback = '') => typeof value === 'string' && value.trim()
  ? value.trim().replace(/\s+/g, ' ')
  : fallback;

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

  async #execute(command) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new IdeaBoardValidationError('command must be an object');
    }
    if (command.type === 'capture') return this.#capture(command);
    if (command.type === 'retopic') return this.#retopic(command);
    if (command.type === 'delete') return this.#delete(command);
    throw new IdeaBoardValidationError(`unsupported command: ${clean(command.type, '(empty)')}`);
  }

  async #capture(command) {
    const input = clean(command.input);
    if (!input) throw new IdeaBoardValidationError('Bitte eine Notiz oder einen Link eingeben.');
    if (input.length > MAX_INPUT) throw new IdeaBoardValidationError(`Eingabe überschreitet ${MAX_INPUT} Zeichen.`);

    const state = this.#read();
    const isLink = /^https?:\/\/\S+$/i.test(input);
    let source = { kind: 'note', text: input, url: null, pageTitle: null };
    if (isLink) {
      try {
        const page = await this.readLink(input);
        source = { kind: 'link', text: page.text, url: page.url, pageTitle: page.title ?? null };
      } catch (error) {
        throw new IdeaBoardValidationError(`Link konnte nicht gelesen werden: ${error.message}`);
      }
    }

    const existingTopics = [...new Set(state.ideas.map((idea) => idea.topic))];
    const result = await this.analyze({ input, source, existingTopics });
    const fallbackTitle = source.pageTitle || (isLink ? new URL(input).hostname : input.slice(0, 90));
    const analysis = normalizedAnalysis(result.analysis ?? result, fallbackTitle);
    const createdAt = this.now().toISOString();
    const idea = {
      id: this.makeId(),
      ...analysis,
      source: source.kind,
      url: source.url,
      input,
      createdAt,
      updatedAt: createdAt,
      engine: clean(result.engine, 'Lokale Analyse'),
    };
    state.ideas.unshift(idea);
    this.#write(state);
    return { idea: structuredClone(idea) };
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

  #delete(command) {
    const state = this.#read();
    const index = state.ideas.findIndex((candidate) => candidate.id === clean(command.id));
    if (index < 0) throw new IdeaBoardValidationError('Gedanke wurde nicht gefunden.');
    const [idea] = state.ideas.splice(index, 1);
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #read() {
    if (!existsSync(this.path)) return emptyState();
    const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
    if (parsed?.version !== 1 || !Array.isArray(parsed.ideas)) {
      throw new Error('Die Datendatei hat ein unbekanntes Format.');
    }
    return parsed;
  }

  #write(state) {
    atomicReplaceText(this.path, `${JSON.stringify(state, null, 2)}\n`);
  }
}
