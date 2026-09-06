import type { ChatSource } from '@friday/contracts';
import {
  citedPassageIds,
  resolvePassageSources,
  splitAuditUnits,
  UnitAuditOutputSchema,
  validateUnitAuditReferences,
  type AnswerPlan,
  type AuditUnit,
  type EvidenceDossier,
  type EvidencePassage,
  type UnitAuditOutput,
} from '../foundation.js';

export function normalizeGeneratedMarkdown(markdown: string): string {
  return markdown
    .replace(
      /^(?:#{1,6}\s*|\*\*)?(?:axes?\s+)?(?:requis(?:e|es)?|utiles?|required|useful)(?:\*\*)?\s*$/gimu,
      '',
    )
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/giu, '$1')
    .replace(/https?:\/\/[^\s<>()\]]+/giu, '')
    .replace(/\((P[1-9]\d*(?:\s*,\s*P[1-9]\d*)+)\)/gu, (_all, ids: string) =>
      ids
        .split(/\s*,\s*/u)
        .map((id) => `[${id}]`)
        .join(' '),
    )
    .replace(/\[(P[1-9]\d*(?:\s*[,;]\s*P[1-9]\d*)+)\]/gu, (_all, ids: string) =>
      ids
        .split(/\s*[,;]\s*/u)
        .map((id) => `[${id}]`)
        .join(' '),
    )
    .trim();
}

export function dedupeResolvedSourceCitations(markdown: string): string {
  return markdown.replace(/(\[S[1-9]\d*\])(?:\s+\1)+/gu, '$1');
}

export function validateMarkdown(
  markdown: string,
  passages: EvidencePassage[],
): string {
  const answer = normalizeGeneratedMarkdown(markdown);
  if (!answer || answer.length > 100_000)
    throw new Error('MODEL_ANSWER_SIZE_INVALID');
  if (/https?:\/\//iu.test(answer))
    throw new Error('MODEL_OUTPUT_URL_FORBIDDEN');
  if (/<\/?[a-z][^>]*>/iu.test(answer))
    throw new Error('MODEL_OUTPUT_HTML_FORBIDDEN');
  const known = new Set(passages.map(({ id }) => id));
  if (
    [...answer.matchAll(/\[(P[1-9]\d*)\]/gu)].some(
      (match) => !known.has(match[1] as EvidencePassage['id']),
    )
  )
    throw new Error('MODEL_OUTPUT_UNKNOWN_PASSAGE');
  if (/[[(]\s*P[1-9]\d*/iu.test(answer.replace(/\[(P[1-9]\d*)\]/gu, '')))
    throw new Error('MODEL_OUTPUT_MALFORMED_PASSAGE');
  splitAuditUnits(answer);
  return answer;
}

export function parseAudit(
  raw: string,
  units: AuditUnit[],
  passages: EvidencePassage[],
  axes: AnswerPlan['axes'] = [],
): UnitAuditOutput {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('AUDIT_INVALID_JSON');
  }
  return validateUnitAuditReferences(
    UnitAuditOutputSchema.parse(value),
    units,
    passages,
    axes,
  );
}

export function safeAuditFailureCode(error: unknown): string {
  if (error instanceof Error && /^AUDIT_[A-Z_]+$/u.test(error.message))
    return error.message;
  if (error instanceof Error && error.name === 'ZodError')
    return 'AUDIT_SCHEMA_INVALID';
  return 'AUDIT_VALIDATION_FAILED';
}

export function resolveAnswer(
  answer: string,
  dossier: EvidenceDossier,
): { markdown: string; sources: ChatSource[] } {
  const cited = citedPassageIds(answer);
  const passageMap = new Map(
    dossier.passages.map((passage) => [passage.id, passage]),
  );
  const sources = resolvePassageSources(cited, dossier);
  const exposed = new Map(
    sources.map((source, index) => [source.id, `S${(index + 1).toString()}`]),
  );
  const markdown = dedupeResolvedSourceCitations(
    answer.replace(/\[(P[1-9]\d*)\]/gu, (_all, passageId: string) => {
      const passage = passageMap.get(passageId as EvidencePassage['id']);
      if (!passage) throw new Error('UNKNOWN_PASSAGE_REFERENCE');
      return `[${exposed.get(passage.sourceId)!}]`;
    }),
  );
  if (/[[(]\s*P[1-9]\d*/iu.test(markdown))
    throw new Error('UNRESOLVED_PASSAGE_REFERENCE');
  return {
    markdown,
    sources: sources.map((source) => ({
      id: exposed.get(source.id)!,
      title: source.title,
      url: source.url,
      domain: new URL(source.url).hostname,
      publishedAt: source.publishedAt ?? null,
      retrievedAt: source.retrievedAt,
      evidenceLevel: 'readable',
    })),
  };
}

export function highRiskNotice(question: string): string {
  return /\b(?:avc|santé|maladie|urgence|secours|médical|médecin|sympt[oô]me|traitement|médicament|juridique|avocat|droit|finance|financier|investir|placement|crédit|impôt)\b/iu.test(
    question,
  )
    ? '\n\n_Information générale : pour une décision médicale, juridique ou financière importante, vérifiez ces éléments auprès d’un professionnel qualifié._'
    : '';
}
