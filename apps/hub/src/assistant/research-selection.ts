import type { AssistantMode } from '@friday/contracts';

import type { TavilyEvidence } from './tavily-search.js';

type WebMode = Exclude<AssistantMode, 'local'>;

export interface ResearchSelection {
  complete: boolean;
  coveredAspects: number;
  selected: TavilyEvidence[];
  totalAspects: number;
  totalCandidates: number;
}

interface AssessedEvidence {
  baseScore: number;
  coveredAspects: Set<number>;
  domain: string;
  evidence: TavilyEvidence;
  relevant: boolean;
}

type ResearchProfile =
  'academic' | 'explanatory' | 'local' | 'official' | 'practical' | 'technical';

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
  const aspects = (queries.length > 0 ? queries : [question]).slice(
    0,
    mode === 'web_light' ? 2 : 6,
  );
  const temporal = questionNeedsFreshness(question);
  const profile = researchProfile(question);
  const assessed = candidates.map((evidence) =>
    assessEvidence(question, aspects, evidence, temporal, profile),
  );
  const maximum = mode === 'web_light' ? 5 : 8;
  const selected: AssessedEvidence[] = [];
  const covered = new Set<number>();
  const domainCounts = new Map<string, number>();
  const remaining = [...assessed];

  while (selected.length < maximum && remaining.length > 0) {
    const ranked = remaining
      .map((candidate, index) => {
        const newCoverage = [...candidate.coveredAspects].filter(
          (aspect) => !covered.has(aspect),
        ).length;
        const domainCount = domainCounts.get(candidate.domain) ?? 0;
        return {
          candidate,
          index,
          score: candidate.baseScore + newCoverage * 0.12 - domainCount * 0.2,
        };
      })
      .filter(({ candidate }) => (domainCounts.get(candidate.domain) ?? 0) < 2)
      .sort(
        (left, right) => right.score - left.score || left.index - right.index,
      );
    const next = ranked[0]?.candidate;
    if (!next) break;
    remaining.splice(remaining.indexOf(next), 1);
    selected.push(next);
    for (const aspect of next.coveredAspects) covered.add(aspect);
    domainCounts.set(next.domain, (domainCounts.get(next.domain) ?? 0) + 1);
  }

  const requiredSources = mode === 'web_light' ? 3 : 6;
  const requiredDomains = mode === 'web_light' ? 2 : 3;
  const requiredAspects = Math.max(1, Math.ceil(aspects.length * 0.75));
  return {
    complete:
      selected.filter(({ relevant }) => relevant).length >= requiredSources &&
      new Set(selected.map(({ domain }) => domain)).size >= requiredDomains &&
      covered.size >= requiredAspects,
    coveredAspects: covered.size,
    selected: selected.map(({ evidence }) => evidence),
    totalAspects: aspects.length,
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

export function questionNeedsFreshness(question: string): boolean {
  const normalized = normalize(question);
  return /\b(?:actualite|actuel(?:le|les|s)?|aujourd['’]?hui|demain|hier|maintenant|recent(?:e|es|s)?|derni(?:er|ere|ers|eres)|cette\s+(?:semaine|annee)|ce\s+(?:mois|jour)|en\s+ce\s+moment|a\s+ce\s+jour|latest|newest|recent|currently|today|tomorrow|yesterday|now)\b/u.test(
    normalized,
  );
}

function assessEvidence(
  question: string,
  aspects: string[],
  evidence: TavilyEvidence,
  temporal: boolean,
  profile: ResearchProfile,
): AssessedEvidence {
  const url = new URL(evidence.url);
  const domain = url.hostname.toLowerCase();
  const searchable = `${evidence.title} ${evidence.title} ${evidence.content.slice(0, 6_000)}`;
  const questionRelevance = coverage(question, searchable);
  const aspectScores = aspects.map((aspect) => coverage(aspect, searchable));
  const coveredAspects = new Set(
    aspectScores
      .map((score, index) => ({ index, score }))
      .filter(({ score }) => score >= 0.22)
      .map(({ index }) => index),
  );
  const providerRelevance = clamp(evidence.relevanceScore ?? 0.5);
  const density = clamp(Math.log10(Math.max(10, evidence.content.length)) / 4);
  const provenance = provenanceScore(domain, evidence.format, profile);
  const freshness = temporal ? freshnessScore(evidence.publishedAt) : 0.5;
  const domainFit = coverage(question, domain.replace(/[.-]/gu, ' '));
  return {
    baseScore:
      questionRelevance * 0.32 +
      Math.max(0, ...aspectScores) * 0.2 +
      providerRelevance * 0.16 +
      provenance * 0.12 +
      density * 0.08 +
      freshness * (temporal ? 0.1 : 0.02) +
      domainFit * 0.02,
    coveredAspects,
    domain,
    evidence,
    relevant: questionRelevance >= 0.15 || coveredAspects.size > 0,
  };
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

function provenanceScore(
  domain: string,
  format: TavilyEvidence['format'],
  profile: ResearchProfile,
): number {
  if (format === 'video_transcript') return 0.3;
  const official =
    domain.endsWith('.gov') ||
    domain.endsWith('.gouv.fr') ||
    domain.endsWith('.europa.eu');
  const scholarly =
    domain.endsWith('.edu') ||
    domain.endsWith('.ac.uk') ||
    domain === 'doi.org' ||
    domain.endsWith('.doi.org') ||
    domain === 'arxiv.org' ||
    domain.endsWith('.arxiv.org') ||
    domain === 'pubmed.ncbi.nlm.nih.gov';
  const technical =
    domain === 'github.com' ||
    domain.endsWith('.github.com') ||
    domain === 'npmjs.com' ||
    domain.endsWith('.npmjs.com') ||
    domain === 'developer.mozilla.org' ||
    domain === 'docs.python.org' ||
    domain === 'huggingface.co';
  const reference =
    domain.includes('wikipedia.org') || domain.endsWith('.britannica.com');
  const localOfficial =
    official ||
    domain.includes('openstreetmap.org') ||
    /(?:mairie|tourisme|office-tourisme|metropole)/u.test(domain);

  if (profile === 'academic') {
    if (scholarly) return 1;
    if (official) return 0.85;
    if (reference) return 0.55;
  } else if (profile === 'technical') {
    if (technical) return 1;
    if (official || scholarly) return 0.8;
    if (reference) return 0.6;
  } else if (profile === 'official') {
    if (official) return 1;
    if (scholarly) return 0.75;
  } else if (profile === 'local') {
    if (localOfficial) return 1;
    if (reference) return 0.65;
  } else if (profile === 'explanatory') {
    if (reference) return 0.9;
    if (scholarly || official) return 0.8;
  } else if (profile === 'practical') {
    if (official || scholarly || technical) return 0.72;
    if (reference) return 0.6;
  }
  if (domain.endsWith('.org')) return 0.65;
  return 0.5;
}

function researchProfile(question: string): ResearchProfile {
  const input = normalize(question);
  if (
    /\b(?:etudes?|publications?|articles?\s+scientifiques?|recherche|preuve|essai\s+clinique|meta-analyse|doi|arxiv|pubmed)\b/u.test(
      input,
    )
  )
    return 'academic';
  if (
    /\b(?:documentation|api|sdk|code|bibliotheque|framework|typescript|javascript|python|npm|github|logiciel|version)\b/u.test(
      input,
    )
  )
    return 'technical';
  if (
    /\b(?:loi|reglement|demarche|administratif|impot|aide\s+publique|service\s+public|autorite|officiel)\b/u.test(
      input,
    )
  )
    return 'official';
  if (
    /\b(?:ou\s+aller|autour\s+de|pres\s+de|adresse|itineraire|horaire|ouvert|visiter|ville|restaurant|sortie)\b/u.test(
      input,
    )
  )
    return 'local';
  if (
    /\b(?:comment\s+faire|conseil|choisir|comparatif|avis|idees?|astuce|recette|acheter)\b/u.test(
      input,
    )
  )
    return 'practical';
  return 'explanatory';
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
