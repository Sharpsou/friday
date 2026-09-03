import {
  AnswerPlanSchema,
  type AnswerAxis,
  type AnswerPlan,
  type EvidencePassage,
} from './contracts.js';
import type { EvidenceDossier } from './passages.js';

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function words(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(' ')
      .filter((word) => word.length >= 3),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / new Set([...left, ...right]).size;
}

export function fallbackAnswerPlan(question: string): AnswerPlan {
  const normalized = question.trim().slice(0, 300) || 'Répondre à la demande';
  return {
    intent: 'other',
    axes: [
      {
        id: 'A1',
        label: 'Réponse principale',
        question: normalized,
        role: 'primary',
        query: normalized,
      },
    ],
  };
}

export function parseAnswerPlan(raw: string, question: string): AnswerPlan {
  try {
    return AnswerPlanSchema.parse(JSON.parse(raw));
  } catch {
    return fallbackAnswerPlan(question);
  }
}

export interface AxisEvidence {
  axis: AnswerAxis;
  passageIds: EvidencePassage['id'][];
}

export function assignEvidenceToAxes(
  plan: AnswerPlan,
  dossier: EvidenceDossier,
): AxisEvidence[] {
  const datedSources = new Set(
    dossier.sources
      .filter(({ publishedAt }) => Boolean(publishedAt))
      .map(({ id }) => id),
  );
  const passageById = new Map(
    dossier.passages.map((passage) => [passage.id, passage]),
  );
  return plan.axes.map((axis, index) => {
    const queryIndex = dossier.diagnostics.queries.findIndex(
      (query) => normalize(query) === normalize(axis.question),
    );
    const ranked =
      dossier.diagnostics.queryPassageIds[
        queryIndex >= 0 ? queryIndex : index + 1
      ] ??
      dossier.diagnostics.queryPassageIds[0] ??
      [];
    const axisWords = words(`${axis.label} ${axis.question}`);
    const matched = ranked.filter((id) => {
      const passage = passageById.get(id);
      if (!passage) return false;
      if (plan.intent === 'recent' && !datedSources.has(passage.sourceId))
        return false;
      return (
        jaccard(axisWords, words(`${passage.heading ?? ''} ${passage.text}`)) >
        0
      );
    });
    return { axis, passageIds: matched.slice(0, 4) };
  });
}

export function mergeRedundantAxes(
  assignments: AxisEvidence[],
): AxisEvidence[] {
  const merged: AxisEvidence[] = [];
  for (const candidate of assignments) {
    const duplicate = merged.find((current) => {
      const questionOverlap = jaccard(
        words(current.axis.question),
        words(candidate.axis.question),
      );
      const currentPassages = new Set(current.passageIds);
      const evidenceOverlap = candidate.passageIds.length
        ? candidate.passageIds.filter((id) => currentPassages.has(id)).length /
          Math.min(current.passageIds.length || 1, candidate.passageIds.length)
        : 0;
      return (
        normalize(current.axis.question) ===
          normalize(candidate.axis.question) ||
        (questionOverlap >= 0.9 && evidenceOverlap >= 0.5)
      );
    });
    if (!duplicate) {
      merged.push(candidate);
      continue;
    }
    duplicate.passageIds = [
      ...new Set([...duplicate.passageIds, ...candidate.passageIds]),
    ].slice(0, 4);
    if (candidate.axis.role === 'primary') duplicate.axis.role = 'primary';
  }
  return merged;
}

export function retrievalQueriesForPlan(
  question: string,
  plan: AnswerPlan,
): string[] {
  return [
    question,
    ...plan.axes.map(({ question: axisQuestion }) => axisQuestion),
  ];
}

export function searchQueriesForPlan(
  question: string,
  plan: AnswerPlan,
): string[] {
  return [question, ...plan.axes.map(({ query }) => query)]
    .map((value) => value.trim())
    .filter(
      (value, index, all) => value.length >= 2 && all.indexOf(value) === index,
    )
    .slice(0, 6);
}
