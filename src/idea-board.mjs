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
const RELATIONS = new Set(['builds', 'contradicts', 'example']);
const USER_FIELDS = ['title', 'summary', 'input', 'notes', 'topic', 'tags', 'manualFields', 'parentId', 'relations', 'deletedAt'];
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

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
    this.history = [];
    this.analysisTask = null;
    this.generation = 0;
    this.stopped = false;
  }

  snapshot() {
    const ideas = this.#read().ideas;
    return {
      ideas: structuredClone(ideas.filter((idea) => !idea.deletedAt)),
      trash: structuredClone(ideas.filter((idea) => idea.deletedAt)),
      canUndo: this.history.length > 0,
    };
  }

  execute(command) {
    return this.#enqueue(async () => {
      const before = this.#read();
      const result = await this.#execute(command);
      if (command.type !== 'undo' && command.type !== 'retry') this.#remember(before, this.#read());
      return { ...result, ...this.snapshot() };
    }).then((result) => { this.resumeAnalysis(); return result; });
  }

  #enqueue(work) {
    const operation = this.pending.then(work);
    this.pending = operation.catch(() => {});
    return operation;
  }

  switchStorage(path, mode = 'open') {
    if (!path || typeof path !== 'string') throw new TypeError('IdeaBoard requires a state path');
    if (!['open', 'merge', 'replace'].includes(mode)) throw new TypeError('Unknown storage switch mode');
    return this.#enqueue(() => this.#switchStorage(path, mode)).then((result) => { this.resumeAnalysis(); return result; });
  }

  importState(imported) {
    return this.#enqueue(() => this.#importState(imported)).then((result) => { this.resumeAnalysis(); return result; });
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
    if (command.type === 'restore') return this.#restore(command);
    if (command.type === 'edit') return this.#edit(command);
    if (command.type === 'undo') return this.#undo();
    if (command.type === 'move') return this.#move(command);
    if (command.type === 'connect' || command.type === 'disconnect') return this.#connect(command);
    if (command.type === 'retry') {
      const state = this.#read();
      const idea = this.#active(state, command.id);
      this.#queueIdea(idea);
      this.#write(state);
      return { idea: structuredClone(idea) };
    }
    throw new IdeaBoardValidationError(`unsupported command: ${clean(command.type, '(empty)')}`);
  }

  async #capture(command) {
    const keep = command.keep === true;
    const raw = typeof command.input === 'string' ? command.input.replace(/\r\n?/g, '\n').trim() : '';
    const input = raw;
    if (!input) throw new IdeaBoardValidationError('Bitte eine Notiz, einen Text oder einen Link eingeben.');
    if (keep && input.length > MAX_TEXT) throw new IdeaBoardValidationError(`Textnotiz überschreitet ${MAX_TEXT} Zeichen.`);
    if (!keep && input.length > MAX_INPUT) {
      throw new IdeaBoardValidationError(`Eingabe überschreitet ${MAX_INPUT} Zeichen. Längere Texte als Textnotiz aufbewahren.`);
    }

    const state = this.#read();
    const isLink = !keep && /^https?:\/\/\S+$/i.test(input);
    const parent = command.parentId ? this.#active(state, command.parentId) : null;
    const title = clean(command.title) || (isLink ? new URL(input).hostname : clean(input).slice(0, 90));
    const createdAt = this.now().toISOString();
    const idea = {
      id: this.makeId(),
      title: title.slice(0, 160),
      summary: '', keyPoints: [], keywords: [],
      topic: parent?.topic ?? clean(command.topic, 'Unsortiert').slice(0, 80),
      // Schlagwörter (keywords) sind Vorschläge der Analyse; tags bestätigt der Mensch.
      tags: [],
      source: isLink ? 'link' : keep ? 'text' : 'note',
      url: isLink ? input : null,
      input,
      createdAt,
      updatedAt: createdAt,
      engine: 'Analyse ausstehend', analysisState: 'pending', analysisRevision: 1,
      manualFields: [...(command.title ? ['title'] : []), ...(parent || command.topic ? ['topic'] : [])],
      parentId: parent?.id ?? null, relations: [], notes: '',
    };
    state.ideas.unshift(idea);
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #remember(before, after) {
    const patches = [];
    for (const idea of after.ideas) {
      const previous = before.ideas.find((item) => item.id === idea.id);
      if (!previous) { patches.push({ id: idea.id, captured: true }); continue; }
      const fields = USER_FIELDS.filter((key) => !equal(previous[key], idea[key]));
      if (fields.length) patches.push({ id: idea.id, fields: fields.map((key) => ({ key, before: previous[key], after: idea[key] })) });
    }
    if (patches.length) this.history.push(structuredClone(patches));
    if (this.history.length > 50) this.history.shift();
  }

  #undo() {
    const patches = this.history.at(-1);
    if (!patches) throw new IdeaBoardValidationError('Nichts zum Rückgängigmachen.');
    const state = this.#read();
    for (const patch of patches) {
      const idea = state.ideas.find((item) => item.id === patch.id);
      if (!idea || patch.fields?.some((field) => !equal(idea[field.key], field.after))) {
        throw new IdeaBoardValidationError('Der Gedanke wurde inzwischen anderweitig geändert.');
      }
      if (patch.captured) idea.deletedAt = this.now().toISOString();
      else for (const field of patch.fields) {
        if (field.before === undefined) delete idea[field.key];
        else idea[field.key] = structuredClone(field.before);
      }
      if (patch.fields?.some((field) => field.key === 'input')) this.#queueIdea(idea);
      idea.updatedAt = this.now().toISOString();
    }
    this.#write(state);
    this.history.pop();
    return { undone: true, focusId: patches[0].id };
  }

  #queueIdea(idea) {
    idea.analysisRevision = (idea.analysisRevision ?? 0) + 1;
    idea.analysisState = 'pending';
    idea.analysisWarning = null;
  }

  resumeAnalysis() {
    if (this.stopped) return;
    if (this.analysisTask) { this.analysisRequested = true; return; }
    this.analysisRequested = false;
    this.analysisTask = this.#analyzePending().catch((error) => {
      // Leave pending work durable on disk failure. Retry or restart can resume it.
      this.lastAnalysisError = error.message;
    }).finally(() => {
      this.analysisTask = null;
      if (this.analysisRequested) this.resumeAnalysis();
    });
  }

  async whenIdle() {
    await this.pending;
    this.resumeAnalysis();
    while (this.analysisTask) await this.analysisTask;
    await this.pending;
  }

  stop() { this.stopped = true; this.generation += 1; }

  async #analyzePending() {
    while (!this.stopped) {
      await this.pending;
      const state = this.#read();
      const idea = state.ideas.find((item) => !item.deletedAt && item.analysisState === 'pending');
      if (!idea) return;
      const generation = this.generation;
      const revision = idea.analysisRevision;
      let result;
      let failure;
      try {
        let source = { kind: idea.source, text: idea.input, url: idea.url, pageTitle: null };
        if (idea.source === 'link') {
          const page = await this.readLink(idea.url);
          source = { kind: 'link', text: page.text, url: page.url, pageTitle: page.title ?? null };
        }
        result = await this.analyze({
          input: idea.input, source,
          existingTopics: [...new Set(state.ideas.filter((item) => !item.deletedAt && item.topic !== 'Unsortiert').map((item) => item.topic))],
          existingTags: [...new Set(state.ideas.filter((item) => !item.deletedAt).flatMap(tagsOf))],
        });
      } catch (error) { failure = error.message || 'Analyse fehlgeschlagen.'; }
      await this.#enqueue(() => {
        if (this.stopped || generation !== this.generation) return;
        const current = this.#read();
        const target = current.ideas.find((item) => item.id === idea.id);
        if (!target || target.deletedAt || target.analysisRevision !== revision || target.analysisState !== 'pending') return;
        if (failure) {
          target.analysisState = 'failed';
          target.analysisWarning = failure;
        } else {
          const analysis = normalizedAnalysis(result.analysis ?? result, idea.title);
          for (const [key, value] of Object.entries(analysis)) {
            if (!(target.manualFields ?? []).includes(key)) target[key] = value;
          }
          target.engine = clean(result.engine, 'Lokale Analyse');
          target.analysisState = 'ready';
          target.analysisWarning = clean(result.warning) || null;
        }
        target.updatedAt = this.now().toISOString();
        this.#write(current);
      });
    }
  }

  #active(state, id) {
    const idea = state.ideas.find((item) => item.id === clean(id) && !item.deletedAt);
    if (!idea) throw new IdeaBoardValidationError('Gedanke wurde nicht gefunden.');
    return idea;
  }

  #edit(command) {
    const state = this.#read();
    const idea = this.#active(state, command.id);
    const fields = command.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new IdeaBoardValidationError('Änderungen fehlen.');
    const limits = { title: 160, summary: 1200, input: MAX_TEXT, notes: MAX_TEXT };
    for (const [key, value] of Object.entries(fields)) {
      if (!Object.hasOwn(limits, key) || typeof value !== 'string' || value.length > limits[key]) throw new IdeaBoardValidationError('Ungültige Änderung oder Text zu lang.');
      if (key === 'input' && idea.source === 'link') throw new IdeaBoardValidationError('Die Linkquelle bleibt unverändert. Eigene Ergänzungen unter Notizen speichern.');
      if (['title', 'input'].includes(key) && !value.trim()) throw new IdeaBoardValidationError('Titel und Text dürfen nicht leer sein.');
      const next = value.replace(/\r\n?/g, '\n').trim();
      if (idea[key] === next) continue;
      idea[key] = next;
      if (key === 'title' || key === 'summary') idea.manualFields = [...new Set([...(idea.manualFields ?? []), key])];
      if (key === 'input') { idea.keyPoints = []; idea.keywords = []; this.#queueIdea(idea); }
    }
    idea.updatedAt = this.now().toISOString();
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #move(command) {
    const state = this.#read();
    const idea = this.#active(state, command.id);
    let parent = command.parentId ? this.#active(state, command.parentId) : null;
    const visited = new Set([idea.id]);
    while (parent) {
      if (visited.has(parent.id)) throw new IdeaBoardValidationError('Ein Zweig kann nicht unter sich selbst liegen.');
      visited.add(parent.id);
      parent = state.ideas.find((item) => item.id === parent.parentId);
    }
    idea.parentId = command.parentId || null;
    idea.updatedAt = this.now().toISOString();
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #connect(command) {
    const state = this.#read();
    const idea = this.#active(state, command.id);
    const target = this.#active(state, command.targetId);
    if (idea.id === target.id || !RELATIONS.has(command.relation)) throw new IdeaBoardValidationError('Ungültige Verbindung.');
    const matches = (edge) => edge.targetId === target.id && edge.type === command.relation;
    idea.relations = Array.isArray(idea.relations) ? idea.relations : [];
    if (command.type === 'disconnect') idea.relations = idea.relations.filter((edge) => !matches(edge));
    else if (!idea.relations.some(matches)) idea.relations.push({ targetId: target.id, type: command.relation });
    idea.updatedAt = this.now().toISOString();
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #restore(command) {
    const state = this.#read();
    const idea = state.ideas.find((item) => item.id === clean(command.id) && item.deletedAt);
    if (!idea) throw new IdeaBoardValidationError('Gedanke wurde nicht im Papierkorb gefunden.');
    delete idea.deletedAt;
    idea.updatedAt = this.now().toISOString();
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #retopic(command) {
    const state = this.#read();
    const idea = this.#active(state, command.id);
    const topic = clean(command.topic);
    if (!topic) throw new IdeaBoardValidationError('Thema darf nicht leer sein.');
    idea.topic = topic.slice(0, 80);
    idea.manualFields = [...new Set([...(idea.manualFields ?? []), 'topic'])];
    idea.updatedAt = this.now().toISOString();
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #retag(command) {
    const state = this.#read();
    const idea = this.#active(state, command.id);
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
      if (idea.deletedAt) continue;
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
    const idea = this.#active(state, command.id);
    idea.deletedAt = this.now().toISOString();
    idea.updatedAt = this.now().toISOString();
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
    this.generation += 1;
    this.history = [];
    return { ...this.snapshot(), created, action: created ? 'created' : mode };
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
      ...this.snapshot(),
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
    for (const idea of state.ideas) {
      if (idea.parentId != null && (typeof idea.parentId !== 'string' || !idea.parentId.trim())) {
        throw new IdeaBoardValidationError('Die Datendatei enthält einen ungültigen übergeordneten Gedanken.');
      }
      if (idea.relations !== undefined && (!Array.isArray(idea.relations) || idea.relations.some((edge) => !edge
        || typeof edge.targetId !== 'string' || !edge.targetId.trim() || !RELATIONS.has(edge.type)))) {
        throw new IdeaBoardValidationError('Die Datendatei enthält ungültige Verbindungen.');
      }
      if (idea.manualFields !== undefined && (!Array.isArray(idea.manualFields)
        || idea.manualFields.some((field) => !['title', 'summary', 'topic'].includes(field)))) {
        throw new IdeaBoardValidationError('Die Datendatei enthält ungültige Bearbeitungsdaten.');
      }
    }
  }

  #write(state) {
    atomicReplaceText(this.path, `${JSON.stringify(state, null, 2)}\n`);
  }
}
