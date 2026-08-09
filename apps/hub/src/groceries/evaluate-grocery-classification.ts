import {
  GROCERY_CLASSIFICATION_EVAL_CORPUS,
  GROCERY_CLASSIFICATION_MODEL_CHALLENGE,
} from './grocery-classification-eval-corpus.js';
import { classifyKnownGroceryLabel } from './grocery-classification-rules.js';
import { OllamaClassificationEngine } from './ollama-classification-engine.js';

const BATCH_SIZE = 30;
const MINIMUM_FAMILY_ACCURACY = 0.9;
const MINIMUM_AISLE_ACCURACY = 0.8;
const MAXIMUM_WARM_P95_MS = 8_000;
const MINIMUM_MODEL_CHALLENGE_ACCURACY = 0.75;
const MAXIMUM_MODEL_CHALLENGE_MS = 60_000;

const engine = new OllamaClassificationEngine({
  ...(process.env.FRIDAY_OLLAMA_URL
    ? { baseUrl: process.env.FRIDAY_OLLAMA_URL }
    : {}),
  ...(process.env.FRIDAY_GROCERY_CLASSIFICATION_MODEL
    ? { model: process.env.FRIDAY_GROCERY_CLASSIFICATION_MODEL }
    : {}),
  ...(process.env.FRIDAY_GROCERY_CLASSIFICATION_TIMEOUT_MS
    ? {
        timeoutMs: Number.parseInt(
          process.env.FRIDAY_GROCERY_CLASSIFICATION_TIMEOUT_MS,
          10,
        ),
      }
    : {}),
});
const controller = new AbortController();

await engine.classify(['pommes'], controller.signal);

let correctFamilies = 0;
let correctAisles = 0;
let ruleMatches = 0;
const durations: number[] = [];
for (
  let offset = 0;
  offset < GROCERY_CLASSIFICATION_EVAL_CORPUS.length;
  offset += BATCH_SIZE
) {
  const batch = GROCERY_CLASSIFICATION_EVAL_CORPUS.slice(
    offset,
    offset + BATCH_SIZE,
  );
  const results = new Array(batch.length);
  const unresolvedIndexes: number[] = [];
  batch.forEach((entry, index) => {
    const known = classifyKnownGroceryLabel(entry.label);
    if (known) {
      results[index] = { ...known, confidence: 0.98 };
      ruleMatches += 1;
    } else {
      unresolvedIndexes.push(index);
    }
  });
  const startedAt = performance.now();
  if (unresolvedIndexes.length > 0) {
    const modelResults = await engine.classify(
      unresolvedIndexes.map((index) => batch[index]!.label),
      controller.signal,
    );
    unresolvedIndexes.forEach((index, resultIndex) => {
      results[index] = modelResults[resultIndex];
    });
  }
  durations.push(performance.now() - startedAt);
  batch.forEach((expected, index) => {
    const actual = results[index];
    if (actual?.storeFamilyId === expected.storeFamilyId) correctFamilies += 1;
    if (
      actual?.storeFamilyId === expected.storeFamilyId &&
      actual.aisleId === expected.aisleId
    ) {
      correctAisles += 1;
    }
  });
}

const familyAccuracy =
  correctFamilies / GROCERY_CLASSIFICATION_EVAL_CORPUS.length;
const aisleAccuracy = correctAisles / GROCERY_CLASSIFICATION_EVAL_CORPUS.length;
const orderedDurations = durations.toSorted((left, right) => left - right);
const p95Index = Math.max(0, Math.ceil(orderedDurations.length * 0.95) - 1);
const warmP95Ms = orderedDurations[p95Index] ?? Number.POSITIVE_INFINITY;
const challengeStartedAt = performance.now();
const challengeResults = await engine.classify(
  GROCERY_CLASSIFICATION_MODEL_CHALLENGE.map(({ label }) => label),
  controller.signal,
);
const modelChallengeMs = performance.now() - challengeStartedAt;
const modelChallengeAccuracy =
  GROCERY_CLASSIFICATION_MODEL_CHALLENGE.filter(
    (expected, index) =>
      challengeResults[index]?.storeFamilyId === expected.storeFamilyId &&
      challengeResults[index]?.aisleId === expected.aisleId,
  ).length / GROCERY_CLASSIFICATION_MODEL_CHALLENGE.length;

console.log(
  JSON.stringify(
    {
      cases: GROCERY_CLASSIFICATION_EVAL_CORPUS.length,
      familyAccuracy,
      aisleAccuracy,
      warmP95Ms: Math.round(warmP95Ms),
      ruleCoverage: ruleMatches / GROCERY_CLASSIFICATION_EVAL_CORPUS.length,
      modelCases: GROCERY_CLASSIFICATION_EVAL_CORPUS.length - ruleMatches,
      modelChallengeCases: GROCERY_CLASSIFICATION_MODEL_CHALLENGE.length,
      modelChallengeAccuracy,
      modelChallengeMs: Math.round(modelChallengeMs),
      gates: {
        familyAccuracy: MINIMUM_FAMILY_ACCURACY,
        aisleAccuracy: MINIMUM_AISLE_ACCURACY,
        warmP95Ms: MAXIMUM_WARM_P95_MS,
        modelChallengeAccuracy: MINIMUM_MODEL_CHALLENGE_ACCURACY,
        modelChallengeMs: MAXIMUM_MODEL_CHALLENGE_MS,
      },
    },
    null,
    2,
  ),
);

if (
  familyAccuracy < MINIMUM_FAMILY_ACCURACY ||
  aisleAccuracy < MINIMUM_AISLE_ACCURACY ||
  warmP95Ms > MAXIMUM_WARM_P95_MS ||
  modelChallengeAccuracy < MINIMUM_MODEL_CHALLENGE_ACCURACY ||
  modelChallengeMs > MAXIMUM_MODEL_CHALLENGE_MS
) {
  process.exitCode = 1;
}
