import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DEFAULT_CORPUS_ROOT,
  freezeCorpus,
  initializeCorpusWorkspace,
  loadFrozenCorpus,
} from './corpus.js';
import { buildFrozenCorpus } from './corpus-build.js';
import { OllamaClient } from './ollama.js';
import {
  blindLabel,
  CANDIDATE_MODEL_PAIRS,
  EvaluationRunner,
  type EvaluationResult,
} from './runner.js';
import { buildReviewArtifacts } from './review.js';
import { runBlindAiReview } from './ai-review.js';

interface EvaluationFailure {
  caseId: string;
  pairId: string;
  seed: number;
  error: string;
}

type StoredResult = EvaluationResult | EvaluationFailure;

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'UNKNOWN_ERROR';
  const code = error.message.split(':', 1)[0] ?? 'UNKNOWN_ERROR';
  return /^[A-Z0-9_]+$/u.test(code) ? code : 'EVALUATION_FAILED';
}

async function evaluate(): Promise<void> {
  const root = argument('root') ?? DEFAULT_CORPUS_ROOT;
  const split = argument('split') ?? 'all';
  if (!['all', 'development', 'validation'].includes(split)) {
    throw new Error('SPLIT_MUST_BE_ALL_DEVELOPMENT_OR_VALIDATION');
  }
  const corpus = await loadFrozenCorpus(root);
  const caseFilter = argument('case');
  const pairFilter = argument('pair');
  const seedFilter = argument('seed');
  const cases = corpus.cases.filter(
    (evalCase) =>
      (split === 'all' || evalCase.split === split) &&
      (caseFilter === undefined || evalCase.id === caseFilter),
  );
  const seeds = seedFilter === undefined ? [17, 29, 43] : [Number(seedFilter)];
  if (seeds.some((seed) => !Number.isSafeInteger(seed))) {
    throw new Error('SEED_MUST_BE_AN_INTEGER');
  }
  const pairs = CANDIDATE_MODEL_PAIRS.filter(
    ({ id }) => pairFilter === undefined || id === pairFilter,
  );
  if (cases.length === 0) throw new Error('NO_MATCHING_CASE');
  if (pairs.length === 0) throw new Error('NO_MATCHING_PAIR');
  const concurrency = Number(argument('concurrency') ?? '1');
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 2
  ) {
    throw new Error('CONCURRENCY_MUST_BE_ONE_OR_TWO');
  }
  const runId =
    argument('run') ?? new Date().toISOString().replaceAll(':', '-');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,99}$/u.test(runId)) {
    throw new Error('INVALID_RUN_ID');
  }
  const resultDirectory = join(root, 'results', runId);
  const reviewDirectory = join(root, 'reviews', runId);
  const resultPath = join(resultDirectory, 'results.json');
  await mkdir(resultDirectory, { recursive: true });
  await mkdir(reviewDirectory, { recursive: true });
  const client = new OllamaClient({
    maxConcurrency: concurrency,
    timeoutMs: 300_000,
  });
  const retrieval = argument('retrieval') ?? 'hybrid';
  if (!['hybrid', 'lexical'].includes(retrieval))
    throw new Error('RETRIEVAL_MUST_BE_HYBRID_OR_LEXICAL');
  const pipeline = argument('pipeline') ?? 'axes';
  if (!['legacy', 'axes'].includes(pipeline))
    throw new Error('PIPELINE_MUST_BE_LEGACY_OR_AXES');
  const runner = new EvaluationRunner({
    ollama: client,
    axesEnabled: pipeline === 'axes',
    ...(retrieval === 'hybrid'
      ? {
          embeddings: {
            embed: async (input: string[], signal?: AbortSignal) =>
              client.embed({
                model: 'qwen3-embedding:0.6b',
                input,
                ...(signal ? { signal } : {}),
              }),
          },
        }
      : {}),
  });
  const previous = await readFile(resultPath, 'utf8')
    .then((raw) => JSON.parse(raw) as { results?: StoredResult[] })
    .catch(() => ({ results: [] as StoredResult[] }));
  const results: StoredResult[] = (previous.results ?? []).filter(
    (result): result is EvaluationResult => 'answer' in result,
  );
  const completed = new Set(
    results.map(
      ({ caseId, pairId, seed }) => `${caseId}\0${pairId}\0${seed.toString()}`,
    ),
  );
  const persist = async (): Promise<void> => {
    await writeFile(
      resultPath,
      `${JSON.stringify({ corpusVersion: corpus.version, split, retrieval, pipeline, seeds, results }, null, 2)}\n`,
      'utf8',
    );
  };
  const jobs: Array<{
    evalCase: (typeof cases)[number];
    pair: (typeof pairs)[number];
    seed: number;
    key: string;
  }> = [];
  for (const evalCase of cases) {
    for (const seed of seeds) {
      for (const pair of pairs) {
        const key = `${evalCase.id}\0${pair.id}\0${seed.toString()}`;
        if (completed.has(key)) continue;
        jobs.push({ evalCase, pair, seed, key });
      }
    }
  }
  for (let offset = 0; offset < jobs.length; offset += concurrency) {
    const batch = jobs.slice(offset, offset + concurrency);
    const outcomes = await Promise.all(
      batch.map(async ({ evalCase, pair, seed, key }) => {
        const startedAt = Date.now();
        let result: StoredResult;
        try {
          result = await runner.runCase(evalCase, pair, seed);
        } catch (error) {
          result = {
            caseId: evalCase.id,
            pairId: pair.id,
            seed,
            error: safeErrorCode(error),
          };
        }
        return { result, key, elapsedMs: Date.now() - startedAt };
      }),
    );
    for (const outcome of outcomes) {
      results.push(outcome.result);
      completed.add(outcome.key);
      process.stdout.write(
        `${JSON.stringify({ caseId: outcome.result.caseId, pairId: outcome.result.pairId, seed: outcome.result.seed, elapsedMs: outcome.elapsedMs, completed: completed.size })}\n`,
      );
    }
    await persist();
  }
  await persist();

  const pairIds = CANDIDATE_MODEL_PAIRS.map(({ id }) => id);
  const successful = results.filter(
    (result): result is EvaluationResult => 'answer' in result,
  );
  const reviewItems = cases.flatMap((evalCase) =>
    seeds.flatMap((seed) => {
      const candidates = successful.filter(
        (result) => result.caseId === evalCase.id && result.seed === seed,
      );
      if (candidates.length !== 2) return [];
      return {
        caseId: evalCase.id,
        seed,
        question: evalCase.question,
        criteria: evalCase.criteria,
        candidates: candidates
          .map((result) => ({
            label: blindLabel(
              result.caseId,
              result.seed,
              result.pairId,
              pairIds,
            ),
            answer: result.answer,
          }))
          .sort((left, right) => left.label.localeCompare(right.label)),
        review: {
          preferred: null,
          a: {
            expectedAspectsCovered: null,
            usefulness: null,
            writingQuality: null,
            importantContradiction: null,
            catastrophicFailure: null,
          },
          b: {
            expectedAspectsCovered: null,
            usefulness: null,
            writingQuality: null,
            importantContradiction: null,
            catastrophicFailure: null,
          },
          notes: '',
        },
      };
    }),
  );
  await writeFile(
    join(reviewDirectory, 'blind-review.json'),
    `${JSON.stringify(reviewItems, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(resultDirectory, 'blind-key.json'),
    `${JSON.stringify(
      successful.map(({ caseId, seed, pairId }) => ({
        caseId,
        seed,
        pairId,
        label:
          pairId === undefined
            ? null
            : blindLabel(String(caseId), Number(seed), String(pairId), pairIds),
      })),
      null,
      2,
    )}\n`,
    'utf8',
  );
  process.stdout.write(
    `${JSON.stringify({ runId, split, cases: cases.length, attempts: results.length, reviewPairs: reviewItems.length })}\n`,
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const root = argument('root') ?? DEFAULT_CORPUS_ROOT;
  if (command === 'corpus:init') {
    const result = await initializeCorpusWorkspace(root);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === 'corpus:freeze') {
    process.stdout.write(
      `${JSON.stringify({ path: await freezeCorpus(root) })}\n`,
    );
    return;
  }
  if (command === 'corpus:build') {
    process.stdout.write(
      `${JSON.stringify(await buildFrozenCorpus({ root }))}\n`,
    );
    return;
  }
  if (command === 'evaluate') {
    await evaluate();
    return;
  }
  if (command === 'review:build') {
    const runId = argument('run');
    if (!runId) throw new Error('REVIEW_RUN_ID_REQUIRED');
    process.stdout.write(
      `${JSON.stringify(await buildReviewArtifacts(root, runId))}\n`,
    );
    return;
  }
  if (command === 'review:ai') {
    const runId = argument('run');
    if (!runId) throw new Error('REVIEW_RUN_ID_REQUIRED');
    const reviewModel = argument('model');
    process.stdout.write(
      `${JSON.stringify(await runBlindAiReview({ root, runId, ...(reviewModel ? { model: reviewModel } : {}) }))}\n`,
    );
    return;
  }
  throw new Error(
    'USAGE: corpus:init | corpus:build | corpus:freeze | evaluate | review:build | review:ai',
  );
}

await main();
