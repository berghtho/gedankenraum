import assert from 'node:assert/strict';
import test from 'node:test';

import { codexArguments, createCodexAnalyzer } from './codex-analysis.mjs';

const request = {
  input: 'Tiefe Module konzentrieren Komplexität.',
  source: { kind: 'note', text: 'Tiefe Module konzentrieren Komplexität.', url: null },
  existingTopics: ['Architektur'],
};

test('Codex analyzer uses Luna xhigh through the resolved runtime', async () => {
  const runtime = { executable: 'codex.exe', version: 'codex-cli 0.147.0' };
  let invocation;
  const analyzer = createCodexAnalyzer({
    resolveRuntime: async () => runtime,
    execute: async (value) => {
      invocation = value;
      return {
        title: 'Tiefe Module', summary: 'Sie konzentrieren Komplexität.',
        keyPoints: ['Kleine Interfaces'], keywords: ['Module'], topic: 'Architektur',
      };
    },
  });

  assert.deepEqual(await analyzer.status(), { available: true, engine: 'Codex · gpt-5.6-luna · xhigh' });
  const result = await analyzer.analyze(request);
  assert.equal(invocation.runtime, runtime);
  assert.match(invocation.prompt, /Nutze keine Tools/);
  assert.match(invocation.prompt, /<UNTRUSTED_SOURCE_[a-f0-9]+>/);
  assert.equal(result.analysis.topic, 'Architektur');
  assert.equal(result.engine, 'Codex · gpt-5.6-luna · xhigh');
});

test('Codex prompt requires source-grounded reporting without changing factual status', async () => {
  let prompt;
  const analyzer = createCodexAnalyzer({
    resolveRuntime: async () => ({ executable: 'codex.exe' }),
    execute: async (invocation) => {
      prompt = invocation.prompt;
      return {
        title: 'OpenAI-Incident', summary: 'OpenAI berichtet über einen tatsächlichen Incident.',
        keyPoints: [], keywords: ['Incident'], topic: 'KI',
      };
    },
  });

  await analyzer.analyze({
    input: 'https://www.youtube.com/watch?v=abcdefghijk',
    source: {
      kind: 'link',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      pageTitle: 'OpenAI: Engineering response to a production incident',
      text: 'OpenAI describes an actual production incident and its response.',
    },
    existingTopics: ['KI'],
  });

  assert.match(prompt, /Quellentitel: OpenAI: Engineering response to a production incident/);
  assert.match(prompt, /keine eigene Meinung/i);
  assert.match(prompt, /tatsächlich.*hypothetisch/i);
  assert.match(prompt, /nicht im Quellmaterial belegt/i);
});

test('Codex process arguments fix model and effort and remove interactive tools', () => {
  const args = codexArguments('schema.json', 'result.json');
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-5.6-luna');
  assert.equal(args[args.indexOf('--config') + 1], 'model_reasoning_effort="xhigh"');
  assert.deepEqual(
    args.flatMap((value, index) => value === '--disable' ? [args[index + 1]] : []),
    ['shell_tool', 'browser_use', 'browser_use_external', 'computer_use', 'apps', 'code_mode_host', 'multi_agent'],
  );
});

test('Codex failure is visible and falls back to local analysis', async () => {
  const analyzer = createCodexAnalyzer({
    resolveRuntime: async () => { throw new Error('nicht angemeldet'); },
    fallback: {
      analyze: async () => ({
        analysis: { title: 'Lokal', summary: 'Fallback', keyPoints: [], keywords: [], topic: 'Unsortiert' },
        engine: 'Lokale Analyse',
      }),
    },
  });

  assert.deepEqual(await analyzer.status(), {
    available: false, engine: 'Lokale Analyse', reason: 'nicht angemeldet',
  });
  const result = await analyzer.analyze(request);
  assert.equal(result.engine, 'Lokale Analyse');
  assert.match(result.warning, /nicht angemeldet/);
});

test('stopping an active analysis aborts it without creating a local result', async () => {
  let signal;
  let started;
  const running = new Promise((resolve) => { started = resolve; });
  const analyzer = createCodexAnalyzer({
    resolveRuntime: async () => ({ executable: 'codex.exe' }),
    execute: async (invocation) => {
      signal = invocation.signal;
      started();
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  });
  const analysis = analyzer.analyze(request);
  await running;
  await analyzer.stop();
  await assert.rejects(analysis, /Gedankenraum wird beendet/);
  assert.equal(signal.aborted, true);
});

test('shutdown prevents analysis that is still resolving Codex or starts later', async () => {
  let releaseRuntime;
  let executed = false;
  const analyzer = createCodexAnalyzer({
    resolveRuntime: async () => new Promise((resolve) => { releaseRuntime = resolve; }),
    execute: async () => { executed = true; },
  });
  const pending = analyzer.analyze(request);
  await new Promise((resolve) => setImmediate(resolve));
  await analyzer.stop();
  releaseRuntime({ executable: 'codex.exe' });
  await assert.rejects(pending, /Gedankenraum wird beendet/);
  await assert.rejects(() => analyzer.analyze(request), /Gedankenraum wird beendet/);
  assert.equal(executed, false);
});
