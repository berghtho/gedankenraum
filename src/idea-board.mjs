import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

import { atomicReplaceText } from './atomic-file.mjs';
import { REFLECTION_KINDS, reflectionSources, validateReflection } from './reflection-analysis.mjs';
import { researchSource, validateResearch, validSources } from './research-analysis.mjs';
import { preferExistingTags } from './tag-match.mjs';
import { byUse, isLinkInput, tagCounts, tagsOf, webUrl } from './util.mjs';

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

// Häufig genutzte Tags zuerst: Sie gehen so an die Analyse und gewinnen bei Schreibvarianten.
const knownTags = (state) => byUse(tagCounts(state.ideas.filter((idea) => !idea.deletedAt))).map(([tag]) => tag);

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
// Windows-Dateinamen unterscheiden keine Groß- und Kleinschreibung.
export const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const fileKey = (path, stats) => `${path}|${stats.ino}:${stats.mtimeMs}:${stats.size}`;
const RELATIONS = new Set(['builds', 'contradicts', 'example']);
const USER_FIELDS = ['title', 'summary', 'input', 'notes', 'topic', 'tags', 'manualFields', 'parentId', 'relations', 'deletedAt', 'answeredAt'];
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
// Bei doppelten IDs gilt wie bei find() der erste Eintrag.
const byId = (items = []) => {
  const map = new Map();
  for (const item of items) if (!map.has(item.id)) map.set(item.id, item);
  return map;
};
const mergeById = (current = [], incoming = []) => {
  const known = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => { if (known.has(item.id)) return false; known.add(item.id); return true; })];
};

// Nach jedem Lesen und Schreiben hat jede Recherche eine resultId; ein Befund hat sie, sobald sie sich ermitteln lässt.
function normalizeResearchIds(ideas) {
  // Alte Recherchen verwendeten Zeitstempel als Identität, teils ohne Abschlusszeit.
  for (const idea of ideas) {
    const origin = idea.researchOrigin;
    if (!origin || origin.resultId !== undefined) continue;
    const research = ideas.find((item) => item.id === origin.ideaId)?.research;
    const resultId = origin.completedAt ?? (research?.resultId === undefined && research?.completedAt == null ? research?.requestedAt : undefined);
    if (typeof resultId === 'string') origin.resultId = resultId;
  }
  for (const idea of ideas) if (idea.research && idea.research.resultId === undefined) {
    idea.research.resultId = typeof idea.research.completedAt === 'string' ? idea.research.completedAt : idea.research.requestedAt;
  }
  return ideas;
}

const importedReflections = (items = []) => items.map((item) => item.status === 'pending'
  ? { ...item, status: 'failed', error: 'Unfertige Auswertung importiert. Prüfe die Quellen und starte sie mit „Erneut versuchen“.' }
  : item);
// Wie bei Auswertungen startet der Import allein keine Übertragung an Codex.
const importedIdeas = (items = []) => normalizeResearchIds(structuredClone(items)).map((idea) => {
  // Eine unterbrochene Neu-Analyse behält die fertige Analyse, wie beim Abbrechen von Hand.
  if (idea.analysisState === 'pending' && idea.reanalyze === 'ready') {
    Object.assign(idea, { analysisState: 'ready', analysisWarning: 'Neu-Analyse beim Import abgebrochen. Die bisherige Analyse bleibt.' });
  } else if (idea.analysisState === 'pending') {
    Object.assign(idea, { analysisState: 'failed', analysisWarning: 'Unfertige Analyse importiert. Starte sie mit „Erneut versuchen“.' });
  }
  if (idea.analysisState !== 'pending') delete idea.reanalyze;
  if (idea.research?.status === 'pending') {
    Object.assign(idea.research, { status: 'failed', error: 'Unfertige Recherche importiert. Starte sie mit „Erneut versuchen“.' });
  }
  return idea;
});

export class IdeaBoard {
  constructor({
    path, analyze, readLink,
    reflect = async () => { throw new Error('KI-Auswertung ist nicht verfügbar. Bitte Codex anmelden.'); },
    research = async () => { throw new Error('KI-Recherche ist nicht verfügbar. Bitte Codex anmelden.'); },
    now = () => new Date(), makeId = randomUUID,
  }) {
    if (!path || typeof path !== 'string') throw new TypeError('IdeaBoard requires a state path');
    if (typeof analyze !== 'function') throw new TypeError('IdeaBoard requires an analyzer');
    if (typeof readLink !== 'function') throw new TypeError('IdeaBoard requires a link reader');
    this.path = path;
    this.analyze = analyze;
    this.reflect = reflect;
    this.research = research;
    this.readLink = readLink;
    this.now = now;
    this.makeId = makeId;
    this.pending = Promise.resolve();
    this.history = [];
    this.lanes = { analysis: { task: null, requested: false }, research: { task: null, requested: false } };
    this.researching = null;
    this.generation = 0;
    this.writes = 0;
    this.cache = null;
    this.stopped = false;
  }

  // Ändert sich bei jedem eigenen Schreiben und wenn die Datei von außen ersetzt wird.
  revision() {
    try {
      return `${this.generation}:${this.writes}:${fileKey(this.path, statSync(this.path))}`;
    } catch {
      return `${this.generation}:${this.writes}:-`;
    }
  }

  snapshot() {
    const revision = this.revision();
    const state = this.#peek();
    return {
      revision,
      ideas: structuredClone(state.ideas.filter((idea) => !idea.deletedAt)),
      trash: structuredClone(state.ideas.filter((idea) => idea.deletedAt)),
      canUndo: this.history.length > 0,
      rooms: structuredClone(state.rooms ?? []),
      reflections: structuredClone(state.reflections ?? []),
    };
  }

  execute(command) {
    return this.#enqueue(async () => {
      const before = this.#peek();
      const handler = this.#handler(command);
      const result = await handler.run(command);
      if (handler.undoable) this.#remember(before, this.#peek(), command.type);
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

  // Eigene Änderungen landen im Undo-Verlauf; KI-Aufträge, Wiederholungen und Undo selbst nicht.
  #commands = {
    capture: { run: (command) => this.#capture(command), undoable: true },
    roomCreate: { run: (command) => this.#roomCommand(command), undoable: true },
    roomRename: { run: (command) => this.#roomCommand(command), undoable: true },
    roomMembers: { run: (command) => this.#roomCommand(command), undoable: true },
    roomArchive: { run: (command) => this.#roomCommand(command), undoable: true },
    roomRestore: { run: (command) => this.#roomCommand(command), undoable: true },
    reflect: { run: (command) => this.#startReflection(command), undoable: false },
    retryReflection: { run: (command) => this.#retryReflection(command), undoable: false },
    acceptReflection: { run: (command) => this.#acceptReflection(command), undoable: true },
    research: { run: (command) => this.#startResearch(command), undoable: false },
    acceptResearch: { run: (command) => this.#acceptResearch(command), undoable: true },
    answer: { run: (command) => this.#answer(command), undoable: true },
    mergeTags: { run: (command) => this.#mergeTags(command), undoable: true },
    reanalyzeAll: { run: () => this.#reanalyzeAll(), undoable: false },
    cancelReanalysis: { run: () => this.#cancelReanalysis(), undoable: false },
    retry: { run: (command) => this.#retry(command), undoable: false },
    retopic: { run: (command) => this.#retopic(command), undoable: true },
    retag: { run: (command) => this.#retag(command), undoable: true },
    renametag: { run: (command) => this.#renameTag(command), undoable: true },
    delete: { run: (command) => this.#delete(command), undoable: true },
    restore: { run: (command) => this.#restore(command), undoable: true },
    edit: { run: (command) => this.#edit(command), undoable: true },
    undo: { run: () => this.#undo(), undoable: false },
    move: { run: (command) => this.#move(command), undoable: true },
    connect: { run: (command) => this.#connect(command), undoable: true },
    disconnect: { run: (command) => this.#connect(command), undoable: true },
  };

  #handler(command) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new IdeaBoardValidationError('command must be an object');
    }
    if (!Object.hasOwn(this.#commands, command.type)) throw new IdeaBoardValidationError(`unsupported command: ${clean(command.type, '(empty)')}`);
    return this.#commands[command.type];
  }

  #retry(command) {
    const state = this.#read();
    const idea = this.#active(state, command.id);
    this.#queueIdea(idea);
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #retryReflection(command) {
    const state = this.#read();
    const reflection = (state.reflections ?? []).find((item) => item.id === command.id);
    if (!reflection || reflection.status !== 'failed') throw new IdeaBoardValidationError('Keine fehlgeschlagene Auswertung gefunden.');
    reflection.status = 'pending'; reflection.error = null;
    this.#write(state);
    return { reflection: structuredClone(reflection) };
  }

  async #capture(command) {
    // keep bewahrt einen Link als Text auf; alles andere außer Links ist ohnehin Text.
    const keep = command.keep === true;
    const input = typeof command.input === 'string' ? command.input.replace(/\r\n?/g, '\n').trim() : '';
    if (!input) throw new IdeaBoardValidationError('Bitte eine Notiz, einen Text oder einen Link eingeben.');
    if (input.length > MAX_TEXT) throw new IdeaBoardValidationError(`Text überschreitet ${MAX_TEXT} Zeichen.`);

    const state = this.#read();
    const room = command.roomId ? this.#room(state, command.roomId) : null;
    // Nicht lesbare Adressen wie „http://[“ bleiben Text.
    const isLink = !keep && isLinkInput(input);
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
      // Ältere Gedanken können noch source 'note' tragen; neue sind 'link' oder 'text'.
      source: isLink ? 'link' : 'text',
      url: isLink ? input : null,
      input,
      createdAt,
      updatedAt: createdAt,
      engine: 'Analyse ausstehend', analysisState: 'pending', analysisRevision: 1,
      manualFields: [...(command.title ? ['title'] : []), ...(parent || command.topic ? ['topic'] : [])],
      parentId: parent?.id ?? null, relations: [], notes: '',
    };
    state.ideas.unshift(idea);
    if (room) { room.ideaIds = [...new Set([...room.ideaIds, idea.id])]; room.updatedAt = createdAt; }
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #remember(before, after, commandType) {
    const patches = [];
    const undoFields = ['mergeTags', 'renametag'].includes(commandType) ? [...USER_FIELDS, 'keywords'] : USER_FIELDS;
    const previousIdeas = byId(before.ideas);
    const previousRooms = byId(before.rooms);
    for (const idea of after.ideas) {
      const previous = previousIdeas.get(idea.id);
      if (!previous) { patches.push({ id: idea.id, captured: true }); continue; }
      const fields = undoFields.filter((key) => !equal(previous[key], idea[key]));
      if (fields.length) patches.push({
        id: idea.id, analysisResultRevision: idea.analysisResultRevision,
        fields: fields.map((key) => ({ key, before: previous[key], after: idea[key] })),
      });
    }
    for (const room of after.rooms ?? []) {
      const previous = previousRooms.get(room.id);
      if (!previous) { patches.push({ id: room.id, collection: 'rooms', captured: true }); continue; }
      const fields = ['question', 'ideaIds', 'archivedAt'].filter((key) => !equal(previous[key], room[key]));
      if (fields.length) patches.push({ id: room.id, collection: 'rooms', fields: fields.map((key) => ({ key, before: previous[key], after: room[key] })) });
    }
    if (patches.length) this.history.push(structuredClone(patches));
    if (this.history.length > 50) this.history.shift();
  }

  #undo() {
    const patches = this.history.at(-1);
    if (!patches) throw new IdeaBoardValidationError('Nichts zum Rückgängigmachen.');
    const state = this.#read();
    for (const patch of patches) {
      const idea = (state[patch.collection ?? 'ideas'] ?? []).find((item) => item.id === patch.id);
      if (!idea || patch.fields?.some((field) => field.key !== 'keywords' && !equal(idea[field.key], field.after))) {
        throw new IdeaBoardValidationError('Der Gedanke wurde inzwischen anderweitig geändert.');
      }
      if (patch.captured) idea[patch.collection === 'rooms' ? 'archivedAt' : 'deletedAt'] = this.now().toISOString();
      else for (const field of patch.fields) {
        // Neuere Analyse-Vorschläge bleiben erhalten; nur die eigenen Tag-Änderungen werden zurückgenommen.
        if (field.key === 'keywords' && (idea.analysisResultRevision !== patch.analysisResultRevision || !equal(idea.keywords, field.after))) continue;
        if (field.before === undefined) delete idea[field.key];
        else idea[field.key] = structuredClone(field.before);
      }
      if (patch.fields?.some((field) => field.key === 'input')) this.#queueIdea(idea);
      idea.updatedAt = this.now().toISOString();
    }
    this.#write(state);
    this.history.pop();
    return { undone: true, ...(patches[0].collection === 'rooms' ? { focusRoomId: patches[0].id } : { focusId: patches[0].id }) };
  }

  #queueIdea(idea) {
    idea.analysisRevision = (idea.analysisRevision ?? 0) + 1;
    idea.analysisState = 'pending';
    idea.analysisWarning = null;
    delete idea.reanalyze;
  }

  resumeAnalysis() {
    for (const name of Object.keys(this.lanes)) this.#startLane(name);
  }

  // Analysen und Recherchen laufen in getrennten Spuren: Eine lange Recherche hält neue Gedanken nicht auf.
  #startLane(name) {
    if (this.stopped) return;
    const lane = this.lanes[name];
    if (lane.task) { lane.requested = true; return; }
    lane.requested = false;
    lane.task = (name === 'research' ? this.#researchPending() : this.#analyzePending()).catch((error) => {
      // Leave pending work durable on disk failure. Retry or restart can resume it.
      this.lastAnalysisError = error.message;
    }).finally(() => {
      lane.task = null;
      if (lane.requested) this.#startLane(name);
    });
  }

  async whenIdle() {
    await this.pending;
    this.resumeAnalysis();
    for (let tasks; (tasks = Object.values(this.lanes).map((lane) => lane.task).filter(Boolean)).length;) await Promise.all(tasks);
    await this.pending;
  }

  stop() { this.stopped = true; this.generation += 1; }

  async #analyzePending() {
    while (!this.stopped) {
      await this.pending;
      const state = this.#peek();
      const reflection = (state.reflections ?? []).find((item) => item.status === 'pending');
      if (reflection) { await this.#analyzeReflection(structuredClone(reflection)); continue; }
      // Ein Gedanke in Recherche wartet, damit eine neue Analyse ihm nicht die recherchierte Quelle verändert.
      const idea = state.ideas.find((item) => !item.deletedAt && item.analysisState === 'pending' && item.id !== this.researching);
      if (!idea) return;
      await this.#analyzeIdea(idea, state);
      this.#startLane('research');
    }
  }

  async #researchPending() {
    while (!this.stopped) {
      await this.pending;
      // Eine Recherche wartet nur auf die Analyse desselben Gedankens und baut auf ihrer Zusammenfassung auf.
      const idea = this.#peek().ideas.find((item) => !item.deletedAt && item.research?.status === 'pending' && item.analysisState !== 'pending');
      if (!idea) return;
      this.researching = idea.id;
      try { await this.#runResearch(idea); } finally { this.researching = null; }
      this.#startLane('analysis');
    }
  }

  async #analyzeIdea(idea, state) {
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
        existingTags: knownTags(state),
      });
    } catch (error) { failure = error.message || 'Analyse fehlgeschlagen.'; }
    await this.#enqueue(() => {
      if (this.stopped || generation !== this.generation) return;
      const current = this.#read();
      const target = current.ideas.find((item) => item.id === idea.id);
      if (!target || target.deletedAt || target.analysisRevision !== revision || target.analysisState !== 'pending') return;
      const refresh = target.reanalyze === 'ready';
      delete target.reanalyze;
      if (refresh && (failure || result.warning)) {
        // Eine Neu-Analyse ersetzt eine fertige Analyse nie durch einen Fehler oder die lokale Ersatz-Analyse.
        target.analysisState = 'ready';
        target.analysisWarning = `Neu-Analyse nicht möglich${failure ? `: ${failure.replace(/[.\s]+$/, '')}` : ', weil Codex nicht verfügbar war'}. Die bisherige Analyse bleibt.`;
        this.#write(current);
        return;
      }
      if (failure) {
        target.analysisState = 'failed';
        target.analysisWarning = failure;
      } else {
        const analysis = normalizedAnalysis(result.analysis ?? result, idea.title);
        analysis.keywords = preferExistingTags(analysis.keywords, knownTags(current));
        for (const [key, value] of Object.entries(analysis)) {
          if (!(target.manualFields ?? []).includes(key)) target[key] = value;
        }
        target.engine = clean(result.engine, 'Lokale Analyse');
        target.analysisState = 'ready';
        target.analysisResultRevision = revision ?? 0;
        target.analysisWarning = clean(result.warning) || null;
      }
      target.updatedAt = this.now().toISOString();
      this.#write(current);
    });
  }

  #active(state, id) {
    const idea = state.ideas.find((item) => item.id === clean(id) && !item.deletedAt);
    if (!idea) throw new IdeaBoardValidationError('Gedanke wurde nicht gefunden.');
    return idea;
  }

  #room(state, id) {
    const room = (state.rooms ?? []).find((item) => item.id === id && !item.archivedAt);
    if (!room) throw new IdeaBoardValidationError('Arbeitsraum wurde nicht gefunden.');
    return room;
  }

  #roomCommand(command) {
    const state = this.#read();
    state.rooms ??= [];
    const stamp = this.now().toISOString();
    let room;
    if (command.type === 'roomCreate') {
      const question = clean(command.question);
      if (!question || question.length > 240) throw new IdeaBoardValidationError('Bitte eine Arbeitsfrage mit höchstens 240 Zeichen eingeben.');
      room = { id: this.makeId(), question, ideaIds: [], createdAt: stamp, updatedAt: stamp };
      state.rooms.push(room);
    } else if (command.type === 'roomRestore') {
      room = state.rooms.find((item) => item.id === command.id && item.archivedAt);
      if (!room) throw new IdeaBoardValidationError('Archivierter Arbeitsraum wurde nicht gefunden.');
      delete room.archivedAt;
    } else {
      room = this.#room(state, command.id);
      if (command.type === 'roomRename') {
        const question = clean(command.question);
        if (!question || question.length > 240) throw new IdeaBoardValidationError('Bitte eine Arbeitsfrage mit höchstens 240 Zeichen eingeben.');
        room.question = question;
      } else if (command.type === 'roomArchive') room.archivedAt = stamp;
      else {
        const { add = [], remove = [] } = command;
        if (![add, remove].every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string' && id.trim()))) throw new IdeaBoardValidationError('Ungültige Gedankenauswahl.');
        for (const id of add) this.#active(state, id);
        const excluded = new Set(remove);
        room.ideaIds = [...new Set([...room.ideaIds, ...add])].filter((id) => !excluded.has(id));
      }
    }
    room.updatedAt = stamp;
    this.#write(state);
    return { room: structuredClone(room) };
  }

  #startReflection(command) {
    const state = this.#read();
    if (!Object.hasOwn(REFLECTION_KINDS, command.kind)) throw new IdeaBoardValidationError('Unbekannte Auswertung.');
    if (!Array.isArray(command.ideaIds) || command.ideaIds.some((id) => typeof id !== 'string')) throw new IdeaBoardValidationError('Bitte Gedanken auswählen.');
    const ids = [...new Set(command.ideaIds)];
    if (ids.length < 2 || ids.length > 12) throw new IdeaBoardValidationError('Bitte 2 bis 12 Gedanken auswählen.');
    const ideas = ids.map((id) => this.#active(state, id));
    const room = command.roomId ? this.#room(state, command.roomId) : null;
    if (room && ids.some((id) => !room.ideaIds.includes(id))) throw new IdeaBoardValidationError('Die Auswahl gehört nicht vollständig zu diesem Arbeitsraum.');
    state.reflections ??= [];
    if (state.reflections.filter((item) => item.status === 'pending').length >= 5) throw new IdeaBoardValidationError('Es warten bereits fünf Auswertungen. Bitte kurz warten.');
    const reflection = {
      id: this.makeId(), roomId: room?.id ?? null, question: room?.question ?? '', kind: command.kind,
      sources: reflectionSources(ideas), status: 'pending', summary: '', findings: [],
      createdAt: this.now().toISOString(), engine: null, error: null,
    };
    state.reflections.unshift(reflection);
    this.#write(state);
    return { reflection: structuredClone(reflection) };
  }

  async #analyzeReflection(reflection) {
    const generation = this.generation;
    let result; let failure;
    try {
      const value = await this.reflect({ kind: reflection.kind, question: reflection.question, sources: reflection.sources });
      result = { ...validateReflection(value, reflection.sources.map((source) => source.id), reflection.kind), engine: clean(value.engine, 'KI-Auswertung') };
    } catch (error) { failure = error.message || 'KI-Auswertung fehlgeschlagen.'; }
    await this.#enqueue(() => {
      if (this.stopped || generation !== this.generation) return;
      const state = this.#read();
      const target = (state.reflections ?? []).find((item) => item.id === reflection.id && item.status === 'pending');
      if (!target) return;
      if (failure) { target.status = 'failed'; target.error = failure; }
      else { Object.assign(target, result); target.status = 'ready'; target.error = null; }
      this.#write(state);
    });
  }

  #startResearch(command) {
    const state = this.#read();
    const idea = this.#active(state, command.id);
    if (idea.research?.status === 'pending') throw new IdeaBoardValidationError('Die Recherche läuft bereits.');
    if (state.ideas.filter((item) => !item.deletedAt && item.research?.status === 'pending').length >= 5) throw new IdeaBoardValidationError('Es warten bereits fünf Recherchen. Bitte kurz warten.');
    // Ein früheres Ergebnis bleibt sichtbar, bis das neue da ist; der eigene Wortlaut bleibt unberührt.
    idea.research = { summary: '', findings: [], engine: null, completedAt: null, ...idea.research, status: 'pending', requestedAt: this.now().toISOString(), error: null };
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  async #runResearch(idea) {
    const generation = this.generation;
    const { requestedAt } = idea.research;
    const source = researchSource(idea);
    let result; let failure;
    try {
      const value = await this.research({ source });
      result = { ...validateResearch(value), engine: clean(value.engine, 'KI-Recherche') };
    } catch (error) { failure = error.message || 'Recherche fehlgeschlagen.'; }
    await this.#enqueue(() => {
      if (this.stopped || generation !== this.generation) return;
      const state = this.#read();
      const target = state.ideas.find((item) => item.id === idea.id && !item.deletedAt);
      if (target?.research?.status !== 'pending' || target.research.requestedAt !== requestedAt) return;
      if (['input', 'notes', 'title', 'summary', 'keyPoints', 'url'].some((key) => !equal(idea[key], target[key]))) {
        failure = 'Der Gedanke wurde während der Recherche geändert. Bitte erneut recherchieren.';
      }
      if (failure) Object.assign(target.research, { status: 'failed', error: failure });
      else Object.assign(target.research, result, { resultId: this.makeId(), source, status: 'ready', error: null, completedAt: this.now().toISOString() });
      this.#write(state);
    });
  }

  // Ein Recherche-Befund wird einmalig ein eigener Gedanke, der auf der Frage aufbaut und in ihren Räumen liegt.
  #acceptResearch(command) {
    const state = this.#read();
    const question = this.#active(state, command.id);
    const research = question.research;
    const finding = research?.findings?.[command.index];
    if (!Number.isInteger(command.index) || command.index < 0 || !finding) throw new IdeaBoardValidationError('Befund wurde nicht gefunden.');
    const { resultId } = research;
    if (typeof command.resultId !== 'string' || command.resultId !== resultId) throw new IdeaBoardValidationError('Die Recherche hat sich geändert. Bitte den aktuellen Befund auswählen.');
    const origin = { ideaId: question.id, resultId, completedAt: research.completedAt ?? null, index: command.index };
    const sameOrigin = (idea) => idea.researchOrigin?.ideaId === origin.ideaId
      && idea.researchOrigin.resultId === resultId && idea.researchOrigin.index === origin.index;
    const rooms = (state.rooms ?? []).filter((room) => !room.archivedAt && room.ideaIds.includes(question.id));
    const stamp = this.now().toISOString();
    const existing = state.ideas.find(sameOrigin);
    if (existing) {
      if (existing.deletedAt) {
        delete existing.deletedAt;
        existing.updatedAt = stamp;
        for (const room of rooms) if (!room.ideaIds.includes(existing.id)) { room.ideaIds.push(existing.id); room.updatedAt = stamp; }
        this.#write(state);
      }
      return { idea: structuredClone(existing) };
    }
    const idea = {
      id: this.makeId(), title: clean(finding.text).slice(0, 160), summary: finding.text, input: finding.text,
      source: 'text', url: null, notes: '', topic: question.topic, keyPoints: [], keywords: [], tags: [],
      createdAt: stamp, updatedAt: stamp, analysisState: 'ready', engine: research.engine,
      manualFields: ['title', 'summary', 'topic'], parentId: null,
      researchOrigin: { ...origin, sources: structuredClone(finding.sources) },
      relations: [{ targetId: question.id, type: 'builds' }],
    };
    state.ideas.unshift(idea);
    for (const room of rooms) { room.ideaIds.push(idea.id); room.updatedAt = stamp; }
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #answer(command) {
    const state = this.#read();
    const idea = this.#active(state, command.id);
    if (typeof command.answered !== 'boolean') throw new IdeaBoardValidationError('Ungültiger Fragenstatus.');
    idea.answeredAt = command.answered ? this.now().toISOString() : null;
    idea.updatedAt = this.now().toISOString();
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  // Legt mehrere Tags in einem Schritt zusammen; Schlagwort-Vorschläge ziehen mit, damit die alte Variante nicht wiederkommt.
  #mergeTags(command) {
    const tags = Array.isArray(command.tags) ? [...new Set(command.tags.map(cleanTag).filter(Boolean))] : [];
    const into = cleanTag(command.into);
    if (tags.length < 2 || !tags.some((tag) => sameTag(tag, into))) throw new IdeaBoardValidationError('Bitte mindestens zwei Tags und ein Ziel aus der Gruppe wählen.');
    const state = this.#read();
    const changed = this.#replaceTags(state, tags, into);
    return { tag: into, changed };
  }

  #replaceTags(state, tags, into) {
    const merged = (tag) => tags.some((item) => sameTag(item, tag));
    const swap = (list) => {
      const next = [];
      for (const tag of list) {
        const value = merged(tag) ? into : tag;
        if (!next.some((known) => sameTag(known, value))) next.push(value);
      }
      return next;
    };
    const stamp = this.now().toISOString();
    let changed = 0;
    let found = false;
    for (const idea of state.ideas) {
      if (idea.deletedAt) continue;
      if (tagsOf(idea).some(merged)) found = true;
      const keywords = swap(idea.keywords ?? []);
      if (!equal(keywords, idea.keywords ?? [])) { idea.keywords = keywords; idea.updatedAt = stamp; }
      const tagList = swap(tagsOf(idea));
      if (equal(tagList, tagsOf(idea))) continue;
      idea.tags = tagList;
      idea.updatedAt = stamp;
      changed += 1;
    }
    if (!found) throw new IdeaBoardValidationError('Tag wurde nicht gefunden.');
    this.#write(state);
    return changed;
  }

  // Alle fertigen Gedanken noch einmal analysieren, etwa nach einem Modellwechsel.
  #reanalyzeAll() {
    const state = this.#read();
    let queued = 0;
    for (const idea of state.ideas) {
      if (idea.deletedAt || idea.analysisState === 'pending') continue;
      const previousState = idea.analysisState === 'failed' ? 'failed' : 'ready';
      this.#queueIdea(idea);
      idea.reanalyze = previousState;
      queued += 1;
    }
    if (!queued) throw new IdeaBoardValidationError('Keine Gedanken zum Neu-Analysieren.');
    this.#write(state);
    return { queued };
  }

  #cancelReanalysis() {
    const state = this.#read();
    let stopped = 0;
    for (const idea of state.ideas) {
      if (!idea.reanalyze || idea.analysisState !== 'pending') continue;
      // Eine neue Revision verwirft auch eine gerade laufende Analyse.
      idea.analysisRevision = (idea.analysisRevision ?? 0) + 1;
      idea.analysisState = idea.reanalyze;
      if (idea.reanalyze === 'failed') idea.analysisWarning = 'Neu-Analyse abgebrochen.';
      delete idea.reanalyze;
      stopped += 1;
    }
    if (!stopped) throw new IdeaBoardValidationError('Keine Neu-Analyse aktiv.');
    this.#write(state);
    return { stopped };
  }

  #acceptReflection(command) {
    const state = this.#read();
    const reflection = (state.reflections ?? []).find((item) => item.id === command.id && item.status === 'ready');
    const finding = reflection?.findings[command.index];
    if (!Number.isInteger(command.index) || command.index < 0 || !finding) throw new IdeaBoardValidationError('Vorschlag wurde nicht gefunden.');
    const existing = state.ideas.find((idea) => idea.reflectionOrigin?.id === reflection.id && idea.reflectionOrigin.index === command.index);
    if (existing) {
      if (existing.deletedAt) {
        delete existing.deletedAt;
        existing.updatedAt = this.now().toISOString();
        const room = (state.rooms ?? []).find((item) => item.id === reflection.roomId && !item.archivedAt);
        if (room && !room.ideaIds.includes(existing.id)) { room.ideaIds.push(existing.id); room.updatedAt = existing.updatedAt; }
        this.#write(state);
      }
      return { idea: structuredClone(existing) };
    }
    const stamp = this.now().toISOString();
    const idea = {
      id: this.makeId(), title: clean(finding.text).slice(0, 160), summary: finding.text, input: finding.text,
      source: 'text', url: null, notes: '', topic: 'Auswertungen', keyPoints: [], keywords: [], tags: [],
      createdAt: stamp, updatedAt: stamp, analysisState: 'ready', engine: reflection.engine,
      manualFields: ['title', 'summary', 'topic'], parentId: null,
      reflectionOrigin: { id: reflection.id, index: command.index },
      relations: finding.sourceIds.map((targetId) => ({ targetId, type: 'builds' })),
    };
    state.ideas.unshift(idea);
    const room = (state.rooms ?? []).find((item) => item.id === reflection.roomId && !item.archivedAt);
    if (room) { room.ideaIds.push(idea.id); room.updatedAt = stamp; }
    this.#write(state);
    return { idea: structuredClone(idea) };
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
    const target = command.parentId ? this.#active(state, command.parentId) : null;
    let parent = target;
    const visited = new Set([idea.id]);
    while (parent) {
      if (visited.has(parent.id)) throw new IdeaBoardValidationError('Ein Zweig kann nicht unter sich selbst liegen.');
      visited.add(parent.id);
      parent = state.ideas.find((item) => item.id === parent.parentId);
    }
    idea.parentId = target?.id ?? null;
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
    // Eindeutige Schreibvarianten angleichen; mögliche Mehrzahlformen bleiben zur Prüfung getrennt.
    idea.tags = preferExistingTags(normalizedTags(command.tags), knownTags(state));
    idea.updatedAt = this.now().toISOString();
    this.#write(state);
    return { idea: structuredClone(idea) };
  }

  #renameTag(command) {
    const from = cleanTag(command.from);
    const to = cleanTag(command.to);
    if (!from || !to) throw new IdeaBoardValidationError('Tag darf nicht leer sein.');
    const state = this.#read();
    const existing = state.ideas.filter((idea) => !idea.deletedAt).flatMap(tagsOf).find((tag) => sameTag(tag, to) && tag !== from);
    const target = existing ?? to;
    const merged = !!existing && !sameTag(from, to);
    const changed = this.#replaceTags(state, [from], target);
    return { tag: target, merged, changed };
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
    if (samePath(path, this.path)) return { ...this.snapshot(), created: false, action: 'unchanged' };
    const created = !existsSync(path);
    const current = this.#read();
    let state = current;
    if (!created && mode === 'open') state = this.#readFrom(path);
    if (!created && mode === 'merge') {
      const target = this.#readFrom(path);
      const currentIds = new Set(current.ideas.map((idea) => idea.id).filter((id) => typeof id === 'string'));
      state = {
        ...target, ...current,
        version: 1,
        ideas: [...current.ideas, ...importedIdeas(target.ideas.filter((idea) => !currentIds.has(idea.id)))],
        rooms: mergeById(current.rooms, target.rooms),
        reflections: mergeById(current.reflections, importedReflections(target.reflections)),
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
    for (const idea of importedIdeas(imported.ideas)) {
      if (knownIds.has(idea.id)) {
        skipped += 1;
        continue;
      }
      knownIds.add(idea.id);
      additions.push(idea);
    }
    const state = { ...current, version: 1, ideas: [...current.ideas, ...additions], rooms: mergeById(current.rooms, imported.rooms), reflections: mergeById(current.reflections, importedReflections(imported.reflections)) };
    const importedRooms = state.rooms.length - (current.rooms?.length ?? 0);
    const reflectionCount = state.reflections.length - (current.reflections?.length ?? 0);
    if (additions.length || importedRooms || reflectionCount) this.#write(state);
    return {
      ...this.snapshot(),
      imported: additions.length,
      skipped,
      importedRooms, importedReflections: reflectionCount,
    };
  }

  // Die Datei wird nur neu gelesen und geprüft, wenn sie sich geändert hat. Der Zwischenstand wird nie verändert;
  // wer ändern will, holt sich mit #read() eine eigene Kopie.
  #peek() {
    const stats = statSync(this.path, { throwIfNoEntry: false });
    if (!stats) return emptyState();
    const key = fileKey(this.path, stats);
    if (this.cache?.key !== key) this.cache = { key, state: this.#readFrom(this.path) };
    return this.cache.state;
  }

  #read() {
    return structuredClone(this.#peek());
  }

  #readFrom(path) {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    this.#validateState(parsed);
    normalizeResearchIds(parsed.ideas);
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
      // Links landen im href der Oberfläche; nur http(s) ist erlaubt.
      if (idea.url != null && (typeof idea.url !== 'string' || !webUrl(idea.url))) {
        throw new IdeaBoardValidationError('Die Datendatei enthält einen ungültigen Link.');
      }
      if (idea.relations !== undefined && (!Array.isArray(idea.relations) || idea.relations.some((edge) => !edge
        || typeof edge.targetId !== 'string' || !edge.targetId.trim() || !RELATIONS.has(edge.type)))) {
        throw new IdeaBoardValidationError('Die Datendatei enthält ungültige Verbindungen.');
      }
      if (idea.manualFields !== undefined && (!Array.isArray(idea.manualFields)
        || idea.manualFields.some((field) => !['title', 'summary', 'topic'].includes(field)))) {
        throw new IdeaBoardValidationError('Die Datendatei enthält ungültige Bearbeitungsdaten.');
      }
      if (idea.research !== undefined) {
        const research = idea.research;
        let valid = !!research && typeof research === 'object' && ['pending', 'ready', 'failed'].includes(research.status) && typeof research.requestedAt === 'string'
          && (research.resultId === undefined || (typeof research.resultId === 'string' && !!research.resultId.trim()));
        if (valid) try { validateResearch(research); } catch { valid = false; }
        if (!valid) throw new IdeaBoardValidationError('Die Datendatei enthält eine ungültige Recherche.');
      }
      if (idea.researchOrigin !== undefined) {
        const origin = idea.researchOrigin;
        let valid = !!origin && typeof origin.ideaId === 'string' && Number.isInteger(origin.index) && origin.index >= 0
          && (origin.resultId === undefined || (typeof origin.resultId === 'string' && !!origin.resultId.trim()));
        if (valid) try { validSources(origin.sources); } catch { valid = false; }
        if (!valid) throw new IdeaBoardValidationError('Die Datendatei enthält einen ungültigen Recherche-Befund.');
      }
      if (idea.answeredAt != null && typeof idea.answeredAt !== 'string') {
        throw new IdeaBoardValidationError('Die Datendatei enthält einen ungültigen Fragenstatus.');
      }
    }
    for (const key of ['rooms', 'reflections']) {
      if (state[key] !== undefined && (!Array.isArray(state[key]) || state[key].some((item) => !item || typeof item.id !== 'string' || !item.id.trim()))) {
        throw new IdeaBoardValidationError('Die Datendatei enthält ungültige Arbeitsräume oder Auswertungen.');
      }
    }
    for (const room of state.rooms ?? []) {
      if (typeof room.question !== 'string' || !room.question.trim() || room.question.length > 240
        || !Array.isArray(room.ideaIds) || room.ideaIds.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new IdeaBoardValidationError('Die Datendatei enthält einen ungültigen Arbeitsraum.');
      }
    }
    for (const reflection of state.reflections ?? []) {
      if (!Object.hasOwn(REFLECTION_KINDS, reflection.kind) || !['pending', 'ready', 'failed'].includes(reflection.status)
        || typeof reflection.question !== 'string' || reflection.question.length > 240
        || !Array.isArray(reflection.sources) || reflection.sources.length < 2 || reflection.sources.length > 12
        || reflection.sources.some((source) => !source || typeof source.id !== 'string' || !source.id
          || ['title', 'summary', 'input', 'notes'].some((key) => typeof source[key] !== 'string'))
        || new Set(reflection.sources.map((source) => source.id)).size !== reflection.sources.length) {
        throw new IdeaBoardValidationError('Die Datendatei enthält eine ungültige Auswertung.');
      }
      if (reflection.status === 'ready') {
        try { validateReflection(reflection, reflection.sources.map((source) => source.id), reflection.kind); }
        catch { throw new IdeaBoardValidationError('Die Datendatei enthält ungültige Quellenverweise.'); }
      }
    }
  }

  #write(state) {
    atomicReplaceText(this.path, `${JSON.stringify(state, null, 2)}\n`);
    this.writes += 1;
    const saved = structuredClone(state);
    normalizeResearchIds(saved.ideas);
    try { this.cache = { key: fileKey(this.path, statSync(this.path)), state: saved }; } catch { this.cache = null; }
  }
}
