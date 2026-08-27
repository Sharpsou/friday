import type { AssistantMode } from '@friday/contracts';

import type { TavilyEvidence } from './tavily-search.js';

type WebMode = Exclude<AssistantMode, 'local' | 'friday'>;

export type EvidenceAssessmentStatus =
  'sufficient' | 'partial' | 'insufficient';

export interface EvidenceAssessment {
  diversityGap: boolean;
  freshnessGap: boolean;
  relevanceGap: boolean;
  status: EvidenceAssessmentStatus;
}

export type EvidenceFreshness = 'current' | 'recent' | 'background' | 'unknown';

export interface ResearchEvidenceMetadata {
  freshness: EvidenceFreshness;
}

export interface EvidencePassage {
  directness: number;
  end: number;
  score: number;
  start: number;
  text: string;
}

export interface ResearchDocument {
  contentOrigin: NonNullable<TavilyEvidence['contentOrigin']>;
  domain: string;
  evidence: TavilyEvidence;
  freshness: EvidenceFreshness;
  originalCharacters: number;
  passages: EvidencePassage[];
  retainedCharacters: number;
  truncated: boolean;
}

export interface ResearchSelection {
  assessment: EvidenceAssessment;
  complete: boolean;
  documents: ResearchDocument[];
  selected: TavilyEvidence[];
  totalCandidates: number;
}

export type ResearchFreshness = 'none' | 'recent' | 'current';

export interface ResearchTemporalContext {
  explicitYears: number[];
  freshness: ResearchFreshness;
  referenceDate?: string;
}

interface AssessedEvidence {
  baseScore: number;
  document: ResearchDocument;
  relevant: boolean;
}

const MAX_PASSAGE_CHARACTERS = 1_300;
const PASSAGE_OVERLAP = 180;
const MAX_PASSAGES_PER_SOURCE = 3;
const MAX_SELECTED_CHARACTERS_PER_SOURCE = 4_500;

const STOP_WORDS = new Set([
  'avec',
  'cette',
  'dans',
  'des',
  'est',
  'les',
  'leur',
  'leurs',
  'mais',
  'par',
  'pas',
  'plus',
  'pour',
  'que',
  'qui',
  'sont',
  'sur',
  'une',
  'and',
  'for',
  'from',
  'the',
  'this',
  'with',
]);

export function selectResearchEvidence(
  question: string,
  queries: string[],
  candidates: TavilyEvidence[],
  mode: WebMode,
): ResearchSelection {
  const discoveryQueries = queries.slice(0, mode === 'web_light' ? 2 : 6);
  const temporal = questionNeedsFreshness(question);
  const uniqueCandidates = candidates.filter(
    (candidate, index, all) =>
      all.findIndex((other) =>
        areDuplicateResearchEvidence(candidate, other),
      ) === index,
  );
  const metadata = describeResearchEvidence(question, uniqueCandidates);
  const assessed = uniqueCandidates.map((evidence, index) =>
    assessEvidence(
      question,
      discoveryQueries,
      evidence,
      temporal,
      metadata[index]!,
    ),
  );
  const maximum = mode === 'web_light' ? 5 : 8;
  const selected: AssessedEvidence[] = [];
  const domainCounts = new Map<string, number>();
  const remaining = assessed.filter((candidate) => candidate.relevant);

  while (selected.length < maximum && remaining.length > 0) {
    const ranked = remaining
      .map((candidate, index) => {
        const domainCount = domainCounts.get(candidate.document.domain) ?? 0;
        return {
          candidate,
          index,
          score: candidate.baseScore - domainCount * 0.2,
        };
      })
      .filter(
        ({ candidate }) =>
          (domainCounts.get(candidate.document.domain) ?? 0) < 2,
      )
      .sort(
        (left, right) => right.score - left.score || left.index - right.index,
      );
    const next = ranked[0]?.candidate;
    if (!next) break;
    remaining.splice(remaining.indexOf(next), 1);
    selected.push(next);
    domainCounts.set(
      next.document.domain,
      (domainCounts.get(next.document.domain) ?? 0) + 1,
    );
  }

  const selectedDocuments = selected.map(({ document }) => document);
  const requiredSources = mode === 'web_light' ? 2 : 3;
  const requiredDomains = 2;
  const domains = new Set(selectedDocuments.map(({ domain }) => domain));
  const relevanceGap = selected.length < requiredSources;
  const diversityGap = selected.length > 0 && domains.size < requiredDomains;
  const temporalRequirement = researchTemporalContext(question).freshness;
  const freshnessGap =
    temporal &&
    !selectedDocuments.some((document) =>
      isTimelyForProof(document, temporalRequirement),
    );
  const complete = !relevanceGap && !diversityGap && !freshnessGap;
  const assessment: EvidenceAssessment = {
    diversityGap,
    freshnessGap,
    relevanceGap,
    status: complete
      ? 'sufficient'
      : selected.length > 0
        ? 'partial'
        : 'insufficient',
  };

  return {
    assessment,
    complete,
    documents: selectedDocuments,
    selected: selectedDocuments.map((document) => document.evidence),
    totalCandidates: candidates.length,
  };
}

export function shouldContinueDeepResearch(
  question: string,
  queries: string[],
  candidates: TavilyEvidence[],
): boolean {
  if (candidates.length >= 24) return false;
  return !selectResearchEvidence(question, queries, candidates, 'web_deep')
    .complete;
}

export function selectPageReadCandidates(
  selection: ResearchSelection,
  candidates: TavilyEvidence[],
  maximum = 2,
): TavilyEvidence[] {
  const selectedUrls = new Set(selection.selected.map(({ url }) => url));
  return candidates
    .filter(
      (candidate) =>
        selectedUrls.has(candidate.url) &&
        candidate.format !== 'video_transcript' &&
        candidate.contentOrigin !== 'page_read' &&
        new URL(candidate.url).protocol === 'https:',
    )
    .sort((left, right) => {
      const leftNeed =
        Number(Boolean(left.truncated)) + Number(left.content.length < 4_000);
      const rightNeed =
        Number(Boolean(right.truncated)) + Number(right.content.length < 4_000);
      return rightNeed - leftNeed;
    })
    .slice(0, maximum);
}

export function correctiveResearchQuery(
  question: string,
  assessment: EvidenceAssessment,
): string | null {
  if (assessment.status === 'sufficient') return null;
  const parts = [question];
  if (assessment.diversityGap) parts.push('confirmation indépendante');
  if (assessment.freshnessGap) parts.push(new Date().getFullYear().toString());
  if (assessment.relevanceGap) parts.push('source détaillée');
  return parts.join(' ');
}

export function questionNeedsFreshness(question: string): boolean {
  return researchTemporalContext(question).freshness !== 'none';
}

export function researchTemporalContext(
  question: string,
  now = new Date(),
): ResearchTemporalContext {
  const normalized = normalize(question);
  const explicitYears = [
    ...new Set(
      (question.match(/\b(?:18|19|20|21)\d{2}\b/gu) ?? []).map(Number),
    ),
  ];
  const current =
    /\b(?:actualite|actuel(?:le|les|s)?|aujourd['’]?hui|demain|hier|maintenant|ce\s+(?:mois|jour)|en\s+ce\s+moment|a\s+ce\s+jour|currently|today|tomorrow|yesterday|now)\b/u.test(
      normalized,
    );
  const recent =
    /\b(?:recent(?:e|es|s)?|derni(?:er|ere|ers|eres)|cette\s+(?:semaine|annee)|latest|newest|recent)\b/u.test(
      normalized,
    );
  const freshness: ResearchFreshness = current
    ? 'current'
    : recent
      ? 'recent'
      : 'none';
  return {
    explicitYears,
    freshness,
    ...(freshness === 'none' ? {} : { referenceDate: civilDate(now) }),
  };
}

export function normalizeTemporalResearchQueries(
  question: string,
  queries: string[],
  maximumQueries: number,
  now = new Date(),
): string[] {
  const context = researchTemporalContext(question, now);
  const currentYear = now.getFullYear();
  const explicitYears = new Set(context.explicitYears);
  const normalized = queries
    .map((query) => query.replace(/\s+/gu, ' ').trim().slice(0, 500))
    .filter(Boolean)
    .map((query) =>
      query.replace(/\b(?:18|19|20|21)\d{2}\b/gu, (rawYear) => {
        const year = Number(rawYear);
        if (context.freshness === 'none') return rawYear;
        if (explicitYears.size > 0) return rawYear;
        if (context.freshness === 'current') return currentYear.toString();
        return year >= currentYear - 1 && year <= currentYear
          ? rawYear
          : currentYear.toString();
      }),
    )
    .filter((query, index, all) => all.indexOf(query) === index)
    .slice(0, Math.max(1, maximumQueries));

  if (
    context.freshness === 'none' ||
    explicitYears.size > 0 ||
    normalized.length === 0 ||
    normalized.some((query) =>
      new RegExp(`\\b${currentYear.toString()}\\b`, 'u').test(query),
    )
  )
    return normalized;

  const target = normalized.length > 1 ? 1 : 0;
  normalized[target] = `${normalized[target] ?? ''} ${currentYear.toString()}`
    .trim()
    .slice(0, 500);
  return normalized;
}

export function describeResearchEvidence(
  question: string,
  evidence: TavilyEvidence[],
  now = new Date(),
): ResearchEvidenceMetadata[] {
  const temporal = researchTemporalContext(question, now);
  return evidence.map((source) => ({
    freshness: evidenceFreshness(source, temporal, now),
  }));
}

export function cleanResearchUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/iu.test(key))
        url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/u, '');
    return url.toString();
  } catch {
    return null;
  }
}

export function canonicalResearchUrlKey(input: string): string | null {
  const cleaned = cleanResearchUrl(input);
  if (!cleaned) return null;
  const url = new URL(cleaned);
  const hostname = url.hostname.toLowerCase().replace(/^www\./u, '');
  return `${hostname}${url.port ? `:${url.port}` : ''}${url.pathname}${url.search}`;
}

export function normalizedResearchDomain(input: string): string | null {
  const cleaned = cleanResearchUrl(input);
  return cleaned
    ? new URL(cleaned).hostname.toLowerCase().replace(/^www\./u, '')
    : null;
}

export function areDuplicateResearchEvidence(
  left: TavilyEvidence,
  right: TavilyEvidence,
): boolean {
  if (left === right) return true;
  const leftKey = canonicalResearchUrlKey(left.url);
  const rightKey = canonicalResearchUrlKey(right.url);
  if (leftKey && rightKey && leftKey === rightKey) return true;
  const leftTitle = normalizeDocumentText(left.title);
  const rightTitle = normalizeDocumentText(right.title);
  if (!leftTitle || leftTitle !== rightTitle) return false;
  const leftContent = normalizeDocumentText(left.content.slice(0, 4_000));
  const rightContent = normalizeDocumentText(right.content.slice(0, 4_000));
  return leftContent.length >= 120 && leftContent === rightContent;
}

function civilDate(now: Date): string {
  const year = now.getFullYear().toString().padStart(4, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function assessEvidence(
  question: string,
  discoveryQueries: string[],
  evidence: TavilyEvidence,
  temporal: boolean,
  metadata: ResearchEvidenceMetadata,
): AssessedEvidence {
  const domain = normalizedResearchDomain(evidence.url) ?? '';
  const passages = selectPassages(question, discoveryQueries, evidence.content);
  const searchable = `${evidence.title} ${passages.map(({ text }) => text).join(' ')}`;
  const questionRelevance = coverage(question, searchable);
  const discoveryRelevance = Math.max(
    0,
    ...discoveryQueries.map((query) => coverage(query, searchable)),
  );
  const providerRelevance = clamp(evidence.relevanceScore ?? 0.5);
  const density = clamp(Math.log10(Math.max(10, evidence.content.length)) / 4);
  const freshness = temporal ? freshnessScore(evidence.publishedAt) : 0.5;
  const domainFit = coverage(question, domain.replace(/[.-]/gu, ' '));
  const selectedContent = passages
    .map(
      (passage, index) => `PASSAGE ${(index + 1).toString()}\n${passage.text}`,
    )
    .join('\n\n');
  const retainedCharacters = selectedContent.length;
  const originalCharacters =
    evidence.originalCharacters ?? evidence.content.length;
  const selectedEvidence: TavilyEvidence = {
    ...evidence,
    content: selectedContent,
    contentOrigin: 'selected_passages',
    originalCharacters,
    retainedCharacters,
    truncated:
      Boolean(evidence.truncated) ||
      retainedCharacters < evidence.content.length,
  };
  const document: ResearchDocument = {
    contentOrigin:
      evidence.contentOrigin ??
      (evidence.provider === 'exa' ? 'provider_excerpt' : 'provider_raw'),
    domain,
    evidence: selectedEvidence,
    freshness: metadata.freshness,
    originalCharacters,
    passages,
    retainedCharacters,
    truncated: Boolean(selectedEvidence.truncated),
  };
  return {
    baseScore:
      questionRelevance * 0.42 +
      discoveryRelevance * 0.2 +
      providerRelevance * 0.16 +
      density * 0.1 +
      freshness * (temporal ? 0.1 : 0.02) +
      domainFit * 0.02,
    document,
    relevant: questionRelevance >= 0.12 || discoveryRelevance >= 0.2,
  };
}

function selectPassages(
  question: string,
  discoveryQueries: string[],
  content: string,
): EvidencePassage[] {
  const passages = passageCandidates(content).map((candidate) => {
    const questionScore = coverage(question, candidate.text);
    const discoveryScores = discoveryQueries.map((query) =>
      coverage(query, candidate.text),
    );
    const directness = Math.max(questionScore, ...discoveryScores, 0);
    return {
      ...candidate,
      directness,
      score:
        directness * 0.85 + Math.min(1, candidate.text.length / 800) * 0.15,
    };
  });
  const ranked = passages.sort(
    (left, right) => right.score - left.score || left.start - right.start,
  );
  const selected: EvidencePassage[] = [];
  for (const passage of ranked) {
    if (selected.length > 0 && passage.score < 0.3) continue;
    if (selected.some((existing) => overlapRatio(existing, passage) > 0.55))
      continue;
    if (
      selected.reduce((sum, item) => sum + item.text.length, 0) +
        passage.text.length >
      MAX_SELECTED_CHARACTERS_PER_SOURCE
    )
      continue;
    selected.push(passage);
    if (selected.length >= MAX_PASSAGES_PER_SOURCE) break;
  }
  return (selected.length > 0 ? selected : ranked.slice(0, 1)).sort(
    (left, right) => left.start - right.start,
  );
}

function passageCandidates(
  input: string,
): Array<{ end: number; start: number; text: string }> {
  const normalized = input
    .replace(/[\u200b-\u200f\u2028-\u202f\u2060-\u206f]/gu, '')
    .replace(/<!--[^]*?-->/gu, '')
    .replace(/\0/gu, '')
    .trim();
  if (!normalized) return [];
  const result: Array<{ end: number; start: number; text: string }> = [];
  for (let start = 0; start < normalized.length;) {
    const maximumEnd = Math.min(
      normalized.length,
      start + MAX_PASSAGE_CHARACTERS,
    );
    let end = maximumEnd;
    if (maximumEnd < normalized.length) {
      const window = normalized.slice(start, maximumEnd);
      const boundary = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf('! '),
        window.lastIndexOf('? '),
      );
      if (boundary >= Math.floor(MAX_PASSAGE_CHARACTERS * 0.55))
        end = start + boundary + 1;
    }
    const text = normalized.slice(start, end).replace(/\s+/gu, ' ').trim();
    if (text) result.push({ end, start, text });
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - PASSAGE_OVERLAP);
  }
  return result;
}

function overlapRatio(left: EvidencePassage, right: EvidencePassage): number {
  const overlap = Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
  return (
    overlap /
    Math.max(1, Math.min(left.end - left.start, right.end - right.start))
  );
}

function coverage(query: string, content: string): number {
  const queryTokens = tokens(query);
  if (queryTokens.size === 0) return 0;
  const contentTokens = tokens(content);
  let matches = 0;
  for (const token of queryTokens) if (contentTokens.has(token)) matches += 1;
  return matches / queryTokens.size;
}

function tokens(input: string): Set<string> {
  return new Set(
    normalize(input)
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter(
        (token) =>
          (token.length >= 3 || /^\d+$/u.test(token)) && !STOP_WORDS.has(token),
      ) ?? [],
  );
}

function normalize(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr');
}

function normalizeDocumentText(input: string): string {
  return normalize(input)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function evidenceFreshness(
  evidence: TavilyEvidence,
  temporal: ResearchTemporalContext,
  now: Date,
): EvidenceFreshness {
  if (temporal.freshness === 'none') return 'unknown';
  if (!evidence.publishedAt) return 'unknown';
  const published = new Date(evidence.publishedAt);
  if (!Number.isFinite(published.valueOf())) return 'unknown';
  if (
    temporal.explicitYears.length > 0 &&
    temporal.explicitYears.includes(published.getFullYear())
  )
    return 'recent';
  const days = Math.max(0, (now.valueOf() - published.valueOf()) / 86_400_000);
  if (days <= 90) return 'current';
  if (days <= 366) return 'recent';
  return 'background';
}

function isTimelyForProof(
  document: ResearchDocument,
  temporal: ResearchFreshness,
): boolean {
  if (temporal === 'none') return true;
  if (document.freshness === 'current') return true;
  if (temporal === 'recent' && document.freshness === 'recent') return true;
  return false;
}

function freshnessScore(publishedAt: string | null): number {
  if (!publishedAt) return 0.25;
  const age = Date.now() - new Date(publishedAt).valueOf();
  if (!Number.isFinite(age)) return 0.25;
  const days = Math.max(0, age / 86_400_000);
  if (days <= 30) return 1;
  if (days <= 180) return 0.8;
  if (days <= 730) return 0.45;
  return 0.15;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
