import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { implementationFingerprint } from './campaign.js';
import type { Corpus } from './contracts.js';
import { loadFrozenCorpus, privateCorpusRoot } from './corpus.js';
import type { EvaluationResult } from './evaluation-types.js';

export interface ReviewedAttempt {
  caseId: string;
  seed: number;
  retrieval: 'lexical' | 'hybrid';
  result?: Pick<
    EvaluationResult,
    'answer' | 'publication' | 'elapsedMs' | 'referenceParagraphRecall'
  >;
}
export const CodexReviewsSchema = z.strictObject({
  reviewer: z.literal('Codex'),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  reviews: z
    .array(
      z.strictObject({
        caseId: z.string(),
        seed: z.union([z.literal(17), z.literal(29), z.literal(43)]),
        retrieval: z.enum(['lexical', 'hybrid']),
        answerHash: z.string().regex(/^[a-f0-9]{64}$/u),
        coveredAspects: z.array(z.number().int().min(0).max(19)).max(20),
        usefulness: z.number().int().min(1).max(5),
        writingQuality: z.number().int().min(1).max(5),
        constructed: z.boolean(),
        importantError: z.boolean(),
        criticalFailure: z.boolean(),
        notes: z.string().trim().min(1).max(2000),
      }),
    )
    .length(120),
});
export type CodexReviews = z.infer<typeof CodexReviewsSchema>;
export const answerFingerprint = (answer: string) =>
  createHash('sha256').update(answer).digest('hex');

export async function reviewCodexCampaign(root: string, runId: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,99}$/u.test(runId))
    throw new Error('INVALID_RUN_ID');
  const safeRoot = privateCorpusRoot(root);
  const directory = join(safeRoot, 'results', runId);
  const corpus = await loadFrozenCorpus(safeRoot);
  const manifest = JSON.parse(
    await readFile(join(directory, 'manifest.json'), 'utf8'),
  ) as { codeHash: string; corpusHash: string; hostileCorpusPassed: boolean };
  const progress = JSON.parse(
    await readFile(join(directory, 'campaign.json'), 'utf8'),
  ) as { fingerprint: string; attempts: ReviewedAttempt[] };
  if (
    answerFingerprint(JSON.stringify(manifest)) !== progress.fingerprint ||
    manifest.codeHash !== (await implementationFingerprint()) ||
    manifest.corpusHash !==
      answerFingerprint(await readFile(join(safeRoot, 'corpus.json'), 'utf8'))
  )
    throw new Error('CAMPAIGN_REVIEW_INPUT_CHANGED');
  const reviews = CodexReviewsSchema.parse(
    JSON.parse(await readFile(join(directory, 'codex-review.json'), 'utf8')),
  );
  const gate = assessCodexReviews({
    corpus,
    attempts: progress.attempts,
    reviews,
    fingerprint: progress.fingerprint,
    hostileCorpusPassed: manifest.hostileCorpusPassed === true,
  });
  await writeFile(
    join(directory, 'codex-gate.json'),
    `${JSON.stringify({ fingerprint: progress.fingerprint, ...gate }, null, 2)}\n`,
    'utf8',
  );
  return gate;
}
const key = (row: { caseId: string; seed: number; retrieval: string }) =>
  `${row.caseId}:${row.seed}:${row.retrieval}`;
const percentile95 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * 0.95) - 1)
  ] ?? 0;

/** Scores come from Codex's actual source review, never from the runtime's own verdicts. */
export function assessCodexReviews(input: {
  corpus: Corpus;
  attempts: ReviewedAttempt[];
  reviews: CodexReviews;
  fingerprint: string;
  hostileCorpusPassed: boolean;
}) {
  const review = CodexReviewsSchema.parse(input.reviews);
  if (review.fingerprint !== input.fingerprint)
    throw new Error('REVIEW_FINGERPRINT_MISMATCH');
  const expected = new Set(
    input.corpus.cases.flatMap((c) =>
      [17, 29, 43].flatMap((seed) =>
        ['lexical', 'hybrid'].map((retrieval) =>
          key({ caseId: c.id, seed, retrieval }),
        ),
      ),
    ),
  );
  const attempts = new Map(input.attempts.map((row) => [key(row), row]));
  const scores = new Map(review.reviews.map((row) => [key(row), row]));
  if (
    expected.size !== 120 ||
    input.attempts.length !== 120 ||
    attempts.size !== 120 ||
    scores.size !== 120 ||
    [...expected].some((id) => !attempts.has(id) || !scores.has(id))
  )
    throw new Error('INCOMPLETE_OR_DUPLICATE_REVIEW');
  for (const score of review.reviews) {
    const attempt = attempts.get(key(score))!;
    if (score.answerHash !== answerFingerprint(attempt.result?.answer ?? ''))
      throw new Error('REVIEW_ANSWER_CHANGED');
    const count = input.corpus.cases.find((c) => c.id === score.caseId)!
      .criteria.expectedAspects.length;
    if (
      new Set(score.coveredAspects).size !== score.coveredAspects.length ||
      score.coveredAspects.some((index) => index >= count)
    )
      throw new Error('INVALID_COVERED_ASPECT');
  }
  const modes = (['lexical', 'hybrid'] as const).map((retrieval) => {
    const rows = input.attempts.filter((row) => row.retrieval === retrieval);
    const respondable = rows.filter(
      (row) =>
        (input.corpus.cases.find((c) => c.id === row.caseId)!.criteria
          .expectedOutcome ?? 'answer') === 'answer',
    );
    const applicable = respondable.map((row) => scores.get(key(row))!);
    const totalAspects = respondable.reduce(
      (sum, row) =>
        sum +
        input.corpus.cases.find((c) => c.id === row.caseId)!.criteria
          .expectedAspects.length,
      0,
    );
    const coverage = totalAspects
      ? applicable.reduce(
          (sum, score) => sum + score.coveredAspects.length,
          0,
        ) / totalAspects
      : 0;
    const quality = applicable.length
      ? applicable.filter(
          (score) => score.usefulness >= 4 && score.writingQuality >= 4,
        ).length / applicable.length
      : 0;
    const construction = respondable.length
      ? respondable.filter(
          (row) =>
            row.result?.publication === 'synthesis' &&
            scores.get(key(row))!.constructed,
        ).length / respondable.length
      : 0;
    const failures: string[] = [];
    if (rows.some((row) => !row.result)) failures.push('GENERATION_FAILED');
    if (
      rows.some((row) => {
        const expected = input.corpus.cases.find((c) => c.id === row.caseId)!
          .criteria.expectedOutcome;
        return (
          expected &&
          expected !== 'answer' &&
          row.result?.publication !==
            (expected === 'abstention' ? 'abstained' : 'clarification')
        );
      })
    )
      failures.push('EXPECTED_OUTCOME_NOT_MET');
    if (
      rows.some(
        (row) =>
          scores.get(key(row))!.importantError ||
          scores.get(key(row))!.criticalFailure,
      )
    )
      failures.push('FACTUAL_OR_CRITICAL_ERROR');
    if (coverage < 0.8) failures.push('COVERAGE_BELOW_80');
    if (quality < 0.8) failures.push('QUALITY_BELOW_80');
    if (construction < 0.9) failures.push('CONSTRUCTION_BELOW_90');
    if (!input.hostileCorpusPassed) failures.push('HOSTILE_TESTS_NOT_PASSED');
    const recalls = rows
      .map((row) => row.result?.referenceParagraphRecall)
      .filter(
        (value): value is number => value !== null && value !== undefined,
      );
    return {
      retrieval,
      passed: failures.length === 0,
      failures,
      coverage,
      quality,
      construction,
      clarified: rows.filter(
        (row) => row.result?.publication === 'clarification',
      ).length,
      abstained: rows.filter((row) => row.result?.publication === 'abstained')
        .length,
      referenceRecall: recalls.length
        ? recalls.reduce((a, b) => a + b, 0) / recalls.length
        : 0,
      p95Ms: percentile95(
        rows.flatMap((row) => (row.result ? [row.result.elapsedMs] : [])),
      ),
    };
  });
  const [lexical, hybrid] = modes;
  const hybridEligible =
    hybrid!.passed &&
    hybrid!.referenceRecall - lexical!.referenceRecall >= 0.05 &&
    lexical!.p95Ms > 0 &&
    hybrid!.p95Ms / lexical!.p95Ms <= 1.25;
  return {
    reviewer: 'Codex',
    modes,
    hybridEligible,
    selectedRetrieval: hybridEligible
      ? 'hybrid'
      : lexical!.passed
        ? 'lexical'
        : null,
  };
}
