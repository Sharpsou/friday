import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DEFAULT_CORPUS_ROOT,
  freezeCorpus,
  initializeCorpusWorkspace,
  loadFrozenCorpus,
} from './corpus.js';
import { OllamaClient } from './ollama.js';
import {
  blindLabel,
  CANDIDATE_MODEL_PAIRS,
  EvaluationRunner,
  type EvaluationResult,
} from './runner.js';

interface EvaluationFailure {
  caseId: string;
  pairId: string;
  seed: number;
  error: string;
}

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
  const split = argument('split') ?? 'development';
  if (split !== 'development' && split !== 'validation') {
    throw new Error('SPLIT_MUST_BE_DEVELOPMENT_OR_VALIDATION');
  }
  const corpus = await loadFrozenCorpus(root);
  const cases = corpus.cases.filter((evalCase) => evalCase.split === split);
  const seeds = [17, 29, 43];
  const client = new OllamaClient();
  const runner = new EvaluationRunner({ ollama: client });
  const results: Array<EvaluationResult | EvaluationFailure> = [];
  for (const evalCase of cases) {
    for (const seed of seeds) {
      for (const pair of CANDIDATE_MODEL_PAIRS) {
        try {
          results.push(await runner.runCase(evalCase, pair, seed));
        } catch (error) {
          results.push({
            caseId: evalCase.id,
            pairId: pair.id,
            seed,
            error: safeErrorCode(error),
          });
        }
      }
    }
  }
  const runId = new Date().toISOString().replaceAll(':', '-');
  const resultDirectory = join(root, 'results', runId);
  const reviewDirectory = join(root, 'reviews', runId);
  await mkdir(resultDirectory, { recursive: true });
  await mkdir(reviewDirectory, { recursive: true });
  await writeFile(
    join(resultDirectory, 'results.json'),
    `${JSON.stringify({ corpusVersion: corpus.version, split, seeds, results }, null, 2)}\n`,
    'utf8',
  );

  const pairIds = CANDIDATE_MODEL_PAIRS.map(({ id }) => id);
  const reviewItems = results
    .filter((result): result is EvaluationResult => 'answer' in result)
    .map((result) => {
      const evalCase = cases.find(({ id }) => id === result.caseId)!;
      return {
        caseId: result.caseId,
        seed: result.seed,
        label: blindLabel(
          String(result.caseId),
          Number(result.seed),
          String(result.pairId),
          pairIds,
        ),
        question: evalCase.question,
        answer: result.answer,
        criteria: evalCase.criteria,
        review: {
          expectedAspectsCovered: null,
          usefulness: null,
          writingQuality: null,
          importantContradiction: null,
          catastrophicFailure: null,
          notes: '',
        },
      };
    });
  await writeFile(
    join(reviewDirectory, 'blind-review.json'),
    `${JSON.stringify(reviewItems, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(resultDirectory, 'blind-key.json'),
    `${JSON.stringify(
      results.map(({ caseId, seed, pairId }) => ({
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
    `${JSON.stringify({ runId, split, cases: cases.length, attempts: results.length })}\n`,
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
  if (command === 'evaluate') {
    await evaluate();
    return;
  }
  throw new Error('USAGE: corpus:init | corpus:freeze | evaluate');
}

await main();
