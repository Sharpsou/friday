import { z } from 'zod';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const ContextResolutionSchema = z.strictObject({
  standaloneQuestion: z.string().trim().min(3).max(2_000),
});
// The local Qwen backend rejects string length keywords in its grammar. Zod
// still enforces the complete bounded contract after generation.
export const ContextResolutionJsonSchema = {
  type: 'object',
  properties: {
    standaloneQuestion: { type: 'string' },
  },
  required: ['standaloneQuestion'],
  additionalProperties: false,
} as const;

const FOLLOW_UP_START =
  /^(?:et|mais|sinon|alors|donc|du coup|en \d{4}|en (?:français|anglais|espagnol|allemand|italien|portugais)|uniquement|seulement|plutôt|sans|avec|pourquoi|comment|lequel|laquelle|lesquels|lesquelles|qu['’]en est-il|qu['’]a-t-(?:il|elle)|et concernant|et pour|par rapport à)\b/iu;
const CONTEXT_REFERENCE =
  /\b(?:ça|cela|ceci|celui|celle|ceux|celles|le premier|la première|le second|la seconde|le deuxième|la deuxième|ce point|cette réponse|ces résultats|plus de détails|davantage)\b/iu;
const FOLLOW_UP_ACTION =
  /^(?:continue|développe|détaille|précise|approfondis|compare|résume|reformule|explique)\b/iu;

export function boundedConversationTurns(
  turns: ConversationTurn[],
  maxTurns = 6,
  maxCharacters = 8_000,
): ConversationTurn[] {
  const selected: ConversationTurn[] = [];
  let remaining = maxCharacters;
  for (const turn of turns.slice(-maxTurns).reverse()) {
    if (remaining <= 0) break;
    const content = turn.content.trim().slice(0, Math.min(remaining, 2_000));
    if (!content) continue;
    selected.push({ role: turn.role, content });
    remaining -= content.length;
  }
  return selected.reverse();
}

export function needsConversationResolution(
  question: string,
  priorTurns: ConversationTurn[],
): boolean {
  if (!priorTurns.length) return false;
  const normalized = question.trim();
  if (!normalized || normalized.length > 600) return false;
  return (
    FOLLOW_UP_START.test(normalized) ||
    CONTEXT_REFERENCE.test(normalized) ||
    FOLLOW_UP_ACTION.test(normalized)
  );
}

function urls(value: string): string[] {
  return value.match(/https?:\/\/[^\s<>()\]]+/giu) ?? [];
}

const CONTEXT_ANCHOR_STOP_WORDS = new Set([
  'alors',
  'comme',
  'debut',
  'defini',
  'demande',
  'donne',
  'faire',
  'faut',
  'trouve',
  'veux',
  'avec',
  'dans',
  'pour',
  'mais',
  'cette',
  'cela',
  'etc',
]);

function anchorTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('fr-FR')
      .match(/[a-z0-9]{4,}/gu)
      ?.filter((token) => !CONTEXT_ANCHOR_STOP_WORDS.has(token))
      .map((token) =>
        token.length > 5 && token.endsWith('s') ? token.slice(0, -1) : token,
      ) ?? [],
  );
}

function latestUserAnchorTokens(priorTurns: ConversationTurn[]): Set<string> {
  const latest = [...priorTurns]
    .reverse()
    .find(({ role, content }) => role === 'user' && content.trim());
  return latest ? anchorTokens(latest.content) : new Set();
}

export function parseContextResolution(
  raw: string,
  currentQuestion: string,
  priorTurns: ConversationTurn[] = [],
): string {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('CONTEXT_INVALID_JSON');
  }
  const parsed = ContextResolutionSchema.parse(value);
  const allowedUrls = new Set(urls(currentQuestion));
  if (urls(parsed.standaloneQuestion).some((url) => !allowedUrls.has(url)))
    throw new Error('CONTEXT_GENERATED_URL_FORBIDDEN');
  const anchors = latestUserAnchorTokens(priorTurns);
  if (anchors.size) {
    const outputTokens = anchorTokens(parsed.standaloneQuestion);
    const retained = [...anchors].filter((token) => outputTokens.has(token));
    if (retained.length < Math.min(2, anchors.size))
      throw new Error('CONTEXT_TOPIC_DRIFT');
  }
  return parsed.standaloneQuestion;
}

export function fallbackContextualQuestion(
  question: string,
  priorTurns: ConversationTurn[],
): string {
  const previousUserQuestions = boundedConversationTurns(priorTurns)
    .filter(({ role }) => role === 'user')
    .slice(-3)
    .map(({ content }) => content.replace(/https?:\/\/\S+/giu, '').trim())
    .filter(Boolean);
  if (!previousUserQuestions.length) return question.trim().slice(0, 2_000);
  return [
    `Demandes précédentes : ${previousUserQuestions.join(' | ')}`,
    `Demande actuelle : ${question.trim()}`,
  ]
    .join('\n')
    .slice(0, 2_000);
}
