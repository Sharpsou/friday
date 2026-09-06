import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { waitForIdleChat, implementationFingerprint } from './campaign.js';
import {
  OllamaClient,
  SharedChatEngine,
  extractStructuredDocument,
  defaultModelProfile,
  type ChatEvalCase,
} from '@friday/assistant-core';

const corpusRoot =
  process.env.DEV_CORPUS_ROOT ?? 'D:/FridayData/evaluations/chat-foundation-v2';
const codeHash = await implementationFingerprint();
const output = process.argv[2];
if (!output || !/^[A-Z]:[\\/]/iu.test(output))
  throw new Error('ABSOLUTE_PRIVATE_OUTPUT_REQUIRED');
await mkdir(output, { recursive: true });
const corpus = JSON.parse(
  await readFile(join(corpusRoot, 'corpus.json'), 'utf8'),
) as { cases: ChatEvalCase[] };
const client = new OllamaClient({ timeoutMs: 120000 });
const ids = (
  process.env.DEV_CASES ?? 'dev-current-events,dev-high-risk,dev-explanation'
).split(',');
if (
  ids.length > 5 ||
  new Set(ids).size !== ids.length ||
  ids.some((id) => !corpus.cases.some((c) => c.id === id))
)
  throw new Error('SELECT_ONE_TO_FIVE_KNOWN_CASES');
const writerModel = process.env.DEV_WRITER ?? 'gemma4:e4b-it-qat';
const auditorModel = process.env.DEV_AUDITOR ?? 'qwen3.5:9b-q4_K_M';
const roleModels = {
  planning: process.env.DEV_PLANNER ?? auditorModel,
  preparation: auditorModel,
  writing: writerModel,
  verification: process.env.DEV_VERIFIER ?? auditorModel,
};
const profiles = Object.fromEntries(
  Object.entries(roleModels).map(([role, model]) => [
    role,
    {
      ...defaultModelProfile(model, role as keyof typeof roleModels),
      ...(process.env.DEV_QWEN_SAMPLING === 'instruct' &&
      model.startsWith('qwen3.5:')
        ? {
            temperature: 0.7,
            topP: 0.8,
            topK: 20,
            presencePenalty: 1.5,
            repeatPenalty: 1,
          }
        : {}),
    },
  ]),
);
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify(
    {
      purpose:
        'Five-case diagnostic maximum, no configuration search or qualification campaign',
      codeHash,
      caseIds: ids,
      corpusRoot,
      roleModels,
      profiles,
      retrieval: process.env.DEV_RETRIEVAL === 'hybrid' ? 'hybrid' : 'lexical',
      replayRoot: process.env.DEV_REPLAY_ROOT ?? null,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ),
  { encoding: 'utf8', flag: 'wx' },
);
for (const item of ids.map((id) => corpus.cases.find((c) => c.id === id)!)) {
  const pages = await Promise.all(
    item.pages.map(async (page) => {
      if (!page.snapshot) throw new Error('SNAPSHOT_REQUIRED');
      const raw = await readFile(join(corpusRoot, page.snapshot.file));
      if (
        createHash('sha256').update(raw).digest('hex') !== page.snapshot.sha256
      )
        throw new Error('SNAPSHOT_CHANGED');
      const structured = extractStructuredDocument(
        new JSDOM(raw.toString('utf8')).window.document,
      );
      return { ...page, sections: structured.sections };
    }),
  );
  const replayRoot = process.env.DEV_REPLAY_ROOT;
  const replays: Array<{
    request: unknown;
    response: Awaited<ReturnType<OllamaClient['generate']>>;
  }> = [];
  if (replayRoot) {
    try {
      const log = await readFile(
        join(replayRoot, `${item.id}.trace.jsonl`),
        'utf8',
      );
      for (const line of log.trim().split('\n').filter(Boolean)) {
        const event = JSON.parse(line).event;
        if (event.request && event.response) replays.push(event);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const traces: unknown[] = [];
  const traceFile = join(output, `${item.id}.trace.jsonl`);
  writeFileSync(traceFile, '', { flag: 'wx' });
  const trace = (value: unknown) => {
    const row = { at: new Date().toISOString(), event: value };
    traces.push(row);
    appendFileSync(traceFile, JSON.stringify(row) + '\n');
  };
  const engine = new SharedChatEngine({
    pipeline: 'unified',
    retrieval: process.env.DEV_RETRIEVAL === 'hybrid' ? 'hybrid' : 'lexical',
    writerModel,
    auditorModel,
    profiles,
    modelsByRole: {
      ...(process.env.DEV_PLANNER ? { planning: process.env.DEV_PLANNER } : {}),
      ...(process.env.DEV_VERIFIER
        ? { verification: process.env.DEV_VERIFIER }
        : {}),
    },
    ollama: {
      generate: async (request) => {
        trace({ kind: 'model_request', request });
        if (replays.length) {
          const cached = replays.shift()!;
          const comparable = (value: unknown) =>
            JSON.stringify({ ...(value as object), signal: undefined });
          if (comparable(cached.request) === comparable(request)) {
            trace({
              kind: 'generation_replay',
              origin: replayRoot,
              request,
              response: cached.response,
            });
            return cached.response;
          }
          // Never bind an old answer to a reordered or changed source dossier.
          trace({
            kind: 'replay_skipped',
            reason: 'REQUEST_CHANGED',
            origin: replayRoot,
          });
        }
        await waitForIdleChat('D:/FridayData/friday.sqlite');
        let response;
        try {
          response = await client.generate(request);
        } catch (error) {
          trace({
            request,
            failure: error instanceof Error ? error.message : 'FAILED',
          });
          throw error;
        }
        trace({ request, response });
        return response;
      },
      embed: async (request) => {
        await waitForIdleChat('D:/FridayData/friday.sqlite');
        return client.embed(request);
      },
    },
    search: {
      search: async (query) => {
        trace({
          kind: 'search',
          query,
          urls: pages.map((p) => p.source.url),
          frozen: true,
        });
        return {
          creditsUsed: 0,
          evidence: pages.map((p) => ({
            ...p.source,
            content: '',
            publishedAt: p.source.publishedAt ?? null,
          })),
        };
      },
    },
    pageReader: {
      fetchArticleDocument: async (url) => {
        const page = pages.find((p) => p.source.url === url);
        if (!page) throw new Error('UNFROZEN_URL');
        trace({
          kind: 'page_read',
          url,
          snapshot: page.snapshot,
          sections: page.sections,
        });
        return {
          sections: page.sections,
          text: page.sections.flatMap((s) => s.paragraphs).join('\n\n'),
          publishedAt: page.source.publishedAt ?? null,
        };
      },
    },
    observe: trace,
  });
  const started = Date.now();
  try {
    const result = await engine.answer({
      content: item.question,
      mode: 'web',
      priorTurns: item.priorTurns,
      signal: AbortSignal.timeout(300000),
      updateStage: (stage) => {
        trace({ kind: 'stage', stage });
        process.stdout.write(`${item.id}: ${stage}\n`);
      },
    });
    await writeFile(
      join(output, `${item.id}.json`),
      JSON.stringify(
        {
          purpose:
            'Targeted diagnostic replay, at most five cases, no model selection or independent qualification.',
          profiles,
          corpusRoot,
          codeHash,
          question: item.question,
          pages,
          traces,
          result,
          elapsedMs: Date.now() - started,
        },
        null,
        2,
      ),
      { encoding: 'utf8', flag: 'wx' },
    );
    process.stdout.write(
      JSON.stringify({
        id: item.id,
        status: result.status,
        code: result.fallbackCode,
        calls: result.modelCalls,
        elapsedMs: Date.now() - started,
      }) + '\n',
    );
  } catch (error) {
    await writeFile(
      join(output, `${item.id}.json`),
      JSON.stringify(
        {
          codeHash,
          question: item.question,
          pages,
          traces,
          error: error instanceof Error ? error.message : 'FAILED',
          elapsedMs: Date.now() - started,
        },
        null,
        2,
      ),
      { encoding: 'utf8', flag: 'wx' },
    );
    process.stdout.write(`${item.id}: failed\n`);
  }
}
