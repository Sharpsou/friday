import { describe, expect, it } from 'vitest';
import {
  assessCodexReviews,
  answerFingerprint,
  type CodexReviews,
  type ReviewedAttempt,
} from '../src/codex-review.js';
import type { Corpus } from '../src/contracts.js';

function fixture() {
  const corpus = {
    cases: Array.from({ length: 20 }, (_, i) => ({
      id: `case-${i}`,
      criteria: { expectedAspects: ['Fait demandé'] },
    })),
  } as unknown as Corpus;
  const attempts: ReviewedAttempt[] = corpus.cases.flatMap((c) =>
    [17, 29, 43].flatMap((seed) =>
      (['lexical', 'hybrid'] as const).map((retrieval) => ({
        caseId: c.id,
        seed,
        retrieval,
        result: {
          answer: 'Réponse documentée.',
          publication: 'synthesis' as const,
          elapsedMs: retrieval === 'hybrid' ? 120 : 100,
          referenceParagraphRecall: retrieval === 'hybrid' ? 0.8 : 0.7,
        },
      })),
    ),
  );
  const fingerprint = 'a'.repeat(64);
  const reviews: CodexReviews = {
    reviewer: 'Codex',
    fingerprint,
    reviews: attempts.map((row) => ({
      caseId: row.caseId,
      seed: row.seed as 17 | 29 | 43,
      retrieval: row.retrieval,
      answerHash: answerFingerprint(row.result!.answer),
      coveredAspects: [0],
      usefulness: 5,
      writingQuality: 5,
      constructed: true,
      importantError: false,
      criticalFailure: false,
      notes: 'Relu contre le paragraphe original.',
    })),
  };
  return { corpus, attempts, reviews, fingerprint, hostileCorpusPassed: true };
}
describe('independent Codex release gate', () => {
  it('requires coverage, construction, factual accuracy and the paired hybrid gain', () => {
    const input = fixture();
    expect(assessCodexReviews(input).selectedRetrieval).toBe('hybrid');
    input.reviews.reviews.find(
      (row) => row.retrieval === 'hybrid',
    )!.importantError = true;
    expect(assessCodexReviews(input).selectedRetrieval).toBe('lexical');
  });
  it('never turns universal abstention into a passing quality score', () => {
    const input = fixture();
    for (const row of input.attempts) row.result!.publication = 'abstained';
    const result = assessCodexReviews(input);
    expect(result.selectedRetrieval).toBeNull();
    expect(
      result.modes.every(
        (mode) => mode.construction === 0 && mode.abstained === 60,
      ),
    ).toBe(true);
  });
  it('binds every reviewed answer and rejects duplicates or changed text', () => {
    const input = fixture();
    input.attempts[0]!.result!.answer = 'Texte remplacé après la revue';
    expect(() => assessCodexReviews(input)).toThrow('REVIEW_ANSWER_CHANGED');
    const other = fixture();
    other.reviews.reviews[0] = other.reviews.reviews[1]!;
    expect(() => assessCodexReviews(other)).toThrow(
      'INCOMPLETE_OR_DUPLICATE_REVIEW',
    );
  });
});
