import type { ChatMode } from '@friday/contracts';
import { type RouteDecision } from '../foundation.js';

const QUERY_STOP_WORDS = new Set([
  'avec',
  'dans',
  'pour',
  'quels',
  'quelle',
  'quelles',
  'comment',
  'autour',
  'court',
  'courte',
  'courtes',
  'exemple',
  'exemples',
  'trouve',
  'trouves',
]);

function relevanceTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('fr-FR')
      .match(/[a-z0-9]{4,}/gu)
      ?.filter((token) => !QUERY_STOP_WORDS.has(token)) ?? [],
  );
}

export function extractReadableParagraphs(
  text: string,
  queries: string[],
): string[] {
  const seen = new Set<string>();
  const paragraphs = text
    .replace(/[\u200B-\u200F\u2060-\u206F]/gu, '')
    .split(/\n{2,}/u)
    .map((value) => value.replace(/\s+/gu, ' ').trim())
    .filter((value) => value.length >= 35)
    .filter((value) => {
      const key = value.toLocaleLowerCase('fr-FR');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 500);
  const body = paragraphs.join(' ');
  if (body.length < 80) return [];
  const expected = relevanceTokens(queries.join(' '));
  if (expected.size === 0) return paragraphs;
  const actual = relevanceTokens(body);
  return [...expected].some((token) => actual.has(token)) ? paragraphs : [];
}

export function explicitResourceTypes(question: string): string[] {
  const resourcePatterns: Array<[RegExp, string]> = [
    [/\bpodcasts?\b/iu, 'podcast'],
    [/\b(?:formations?|cours|bootcamps?)\b/iu, 'formation'],
    [/\b(?:livres?|ouvrages?)\b/iu, 'livre'],
    [/\b(?:vidéos?|cha[iî]nes? youtube)\b/iu, 'vidéo'],
    [/\b(?:produits?|modèles?)\b/iu, 'produit'],
    [/\bservices?\b/iu, 'service'],
    [/\b(?:outils?|logiciels?)\b/iu, 'outil'],
    [/\brestaurants?\b/iu, 'restaurant'],
    [/\b(?:hôtels?|hébergements?)\b/iu, 'hébergement'],
  ];
  return resourcePatterns
    .filter(([pattern]) => pattern.test(question))
    .map(([, label]) => label)
    .slice(0, 4);
}

export function explicitResourceSearchQueries(question: string): string[] {
  return explicitResourceTypes(question).map((label) =>
    `${label} ${question}`.slice(0, 300),
  );
}

export function routeForcedByMode(
  mode: ChatMode,
  question: string,
): RouteDecision | null {
  if (mode === 'friday') return null;
  if (mode === 'local')
    return {
      route: 'local',
      reason: 'writing_or_conversation',
      queries: [],
      decidedBy: 'code',
      verificationLabel: 'non vérifié par des sources',
    };
  return {
    route: 'web',
    reason: 'explicit_web',
    queries: [question],
    decidedBy: 'code',
    verificationLabel: 'sources requises',
  };
}
