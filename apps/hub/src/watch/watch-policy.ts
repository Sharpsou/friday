import {
  type WatchDiscoveryRequest,
  type WatchSourceKind,
  type WatchThemeProposal,
} from '@friday/contracts';
import type { DiscoveryCandidate } from './watch-records.js';

export const FETCH_INTERVAL_MS = 6 * 60 * 60_000;

export const RETENTION_MS = 183 * 24 * 60 * 60_000;

export function uniqueKeywords(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, 30);
}

export function sanitizeSuggestionQuery(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[email retiré]')
    .replace(/(?:\+33|0)[1-9](?:[ .-]?\d{2}){4}/gu, '[téléphone retiré]')
    .slice(0, 400);
}

export function sourceReason(kind: WatchSourceKind): string {
  const labels: Record<WatchSourceKind, string> = {
    official: 'Source officielle directement liée au sujet.',
    research: 'Source de recherche ou publication scientifique.',
    specialized_press: 'Média journalistique spécialisé dans le domaine.',
    general_press:
      'Rubrique technologique ou scientifique d’un média généraliste.',
    community: 'Source communautaire complémentaire.',
  };
  return labels[kind];
}

export function diversifyCandidates(
  candidates: DiscoveryCandidate[],
  maximum: number,
): DiscoveryCandidate[] {
  const selected: DiscoveryCandidate[] = [];
  const usedOrigins = new Set<string>();
  const byKind = new Map<WatchSourceKind, DiscoveryCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.status !== 'validated') continue;
    const list = byKind.get(candidate.kind) ?? [];
    list.push(candidate);
    byKind.set(candidate.kind, list);
  }
  for (const kind of [
    'official',
    'research',
    'specialized_press',
    'general_press',
    'community',
  ] as const) {
    for (const candidate of byKind.get(kind) ?? []) {
      const origin = new URL(candidate.siteUrl).origin;
      if (usedOrigins.has(origin)) continue;
      selected.push(candidate);
      usedOrigins.add(origin);
      break;
    }
  }
  for (const candidate of candidates.toSorted((a, b) => b.score - a.score)) {
    if (selected.length >= maximum) break;
    if (candidate.status !== 'validated') continue;
    const origin = new URL(candidate.siteUrl).origin;
    if (usedOrigins.has(origin)) continue;
    selected.push(candidate);
    usedOrigins.add(origin);
  }
  return selected;
}

export function tokenSimilarity(left: string, right: string): number {
  const tokens = (value: string) =>
    new Set(
      normalize(value)
        .split(/[^a-z0-9]+/u)
        .filter((token) => token.length >= 3),
    );
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

export function watchTopicBudget(
  sourceCount: number,
  trackedConceptCount: number,
): number {
  const signalCount =
    Math.max(0, sourceCount) + Math.max(0, trackedConceptCount);
  return Math.min(8, Math.max(5, 4 + Math.ceil(Math.sqrt(signalCount) / 2)));
}

export function watchConceptBudget(topicBudget: number): number {
  return Math.min(32, Math.max(20, Math.round(topicBudget) * 4));
}

const LATIN_WATCH_LANGUAGES = new Set([
  'ca',
  'cs',
  'da',
  'de',
  'en',
  'es',
  'fi',
  'fr',
  'hu',
  'id',
  'it',
  'nl',
  'no',
  'pl',
  'pt',
  'ro',
  'sk',
  'sv',
  'tr',
  'vi',
]);

export function matchesConfiguredWatchLanguage(
  text: string,
  configuredLanguages: string[],
): boolean {
  if (
    configuredLanguages.some(
      (language) => !LATIN_WATCH_LANGUAGES.has(language.split('-')[0] ?? ''),
    )
  )
    return true;
  const letters = [...text].filter((character) =>
    /\p{Letter}/u.test(character),
  );
  if (letters.length < 12) return true;
  const nonLatin = letters.filter(
    (character) => !/\p{Script=Latin}/u.test(character),
  ).length;
  return nonLatin / letters.length <= 0.45;
}

export function fallbackWatchThemes(
  input: Pick<WatchDiscoveryRequest, 'name' | 'question'>,
): WatchThemeProposal[] {
  const scope = input.question.trim().slice(0, 240);
  return [
    ['Actualités principales', 'Les changements directement liés à la veille.'],
    ['Applications et usages', 'Les applications concrètes et leurs usages.'],
    ['Outils et méthodes', 'Les outils, méthodes et pratiques utiles.'],
    [
      'Acteurs et initiatives',
      'Les organisations, projets et initiatives du domaine.',
    ],
    [
      'Risques et réglementation',
      'Les risques, limites, règles et enjeux de fiabilité.',
    ],
    [
      'Recherche et innovations',
      'Les travaux de recherche et innovations émergentes.',
    ],
  ].map(([title, summary]) => ({
    title: `${title} · ${input.name}`.slice(0, 120),
    summary: `${summary} Périmètre : ${scope}`.slice(0, 500),
  }));
}

export function stableWatchThemes(
  themes: WatchThemeProposal[],
  input: Pick<WatchDiscoveryRequest, 'name' | 'question'>,
): WatchThemeProposal[] {
  const selected = new Map<string, WatchThemeProposal>();
  for (const theme of themes) {
    const title = theme.title.trim().slice(0, 120);
    const summary = theme.summary.trim().slice(0, 500);
    if (title.length < 3 || summary.length < 3) continue;
    selected.set(normalize(title), { title, summary });
    if (selected.size >= 8) break;
  }
  for (const fallback of fallbackWatchThemes(input)) {
    if (selected.size >= 5) break;
    selected.set(normalize(fallback.title), fallback);
  }
  return [...selected.values()].slice(0, 8);
}

export function selectBalancedWatchCandidates<
  Candidate extends { source_id: string },
>(candidates: Candidate[], maximum: number): Candidate[] {
  if (maximum <= 0) return [];
  const bySource = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const source = bySource.get(candidate.source_id) ?? [];
    source.push(candidate);
    bySource.set(candidate.source_id, source);
  }
  const selected: Candidate[] = [];
  let round = 0;
  while (selected.length < maximum) {
    let added = false;
    for (const source of bySource.values()) {
      const candidate = source[round];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length >= maximum) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

export function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr');
}
