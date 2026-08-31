import { z } from 'zod';
import type { OllamaClient } from './ollama.js';
import { routerPrompt } from './prompts.js';

export const RouteClassifierOutputSchema = z.strictObject({
  route: z.enum(['local', 'web']),
  reason: z.enum([
    'explicit_web',
    'current_information',
    'recommendation',
    'high_risk',
    'source_required',
    'uncertain_fact',
    'stable_explanation',
    'writing_or_conversation',
  ]),
  queries: z.array(z.string().trim().min(2).max(300)).max(3),
});
export type RouteClassifierOutput = z.infer<typeof RouteClassifierOutputSchema>;
export const RouteClassifierJsonSchema = z.toJSONSchema(
  RouteClassifierOutputSchema,
);
export interface RouteDecision extends RouteClassifierOutput {
  decidedBy: 'code' | 'classifier';
  verificationLabel: 'sources requises' | 'non vérifié par des sources';
}

const HIGH_RISK =
  /\b(m[ée]dicament|sympt[oô]me|diagnostic|urgence|juridique|avocat|loi|fiscal|imp[oô]t|investir|placement|cr[ée]dit|banque)\b/iu;
const CURRENT =
  /\b(aujourd'hui|actuel|actuelle|derni[eè]re|r[ée]cent|maintenant|prix|horaire|m[ée]t[ée]o|score|version)\b/iu;
const RECOMMENDATION =
  /\b(recommande|conseille|meilleur|choisir|acheter|restaurant|voyage)\b/iu;
const SOURCE_REQUIRED =
  /\b(source|citation|lien|preuve|v[ée]rifie|cherche|recherche|web|internet)\b/iu;
const WRITING =
  /\b(r[ée][ée]cris|reformule|corrige|traduis|imagine|r[ée]dige|bonjour|merci)\b/iu;
const STABLE =
  /\b(explique|d[ée]finis|d[ée]finition|comment fonctionne|pourquoi)\b/iu;
function decision(
  route: 'local' | 'web',
  reason: RouteClassifierOutput['reason'],
  queries: string[] = [],
): RouteDecision {
  return {
    route,
    reason,
    queries,
    decidedBy: 'code',
    verificationLabel:
      route === 'web' ? 'sources requises' : 'non vérifié par des sources',
  };
}
export function routeDeterministically(question: string): RouteDecision | null {
  if (SOURCE_REQUIRED.test(question))
    return decision('web', 'source_required', [question]);
  if (HIGH_RISK.test(question)) return decision('web', 'high_risk', [question]);
  if (CURRENT.test(question))
    return decision('web', 'current_information', [question]);
  if (RECOMMENDATION.test(question))
    return decision('web', 'recommendation', [question]);
  if (WRITING.test(question))
    return decision('local', 'writing_or_conversation');
  if (STABLE.test(question)) return decision('local', 'stable_explanation');
  return null;
}
export function acceptClassifierRoute(input: unknown): RouteDecision {
  const parsed = RouteClassifierOutputSchema.parse(input);
  if (parsed.route === 'local' && parsed.queries.length)
    throw new Error('LOCAL_ROUTE_MUST_NOT_QUERY');
  if (parsed.route === 'web' && !parsed.queries.length)
    throw new Error('WEB_ROUTE_REQUIRES_QUERY');
  return {
    ...parsed,
    decidedBy: 'classifier',
    verificationLabel:
      parsed.route === 'web'
        ? 'sources requises'
        : 'non vérifié par des sources',
  };
}
export async function routeQuestion(
  question: string,
  options: {
    ollama: OllamaClient;
    model: string;
    seed: number;
    signal?: AbortSignal;
  },
): Promise<RouteDecision> {
  const deterministic = routeDeterministically(question);
  if (deterministic) return deterministic;
  const result = await options.ollama.generate({
    model: options.model,
    prompt: routerPrompt(question),
    seed: options.seed,
    format: RouteClassifierJsonSchema,
    maxTokens: 256,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.response);
  } catch {
    throw new Error('ROUTER_INVALID_JSON');
  }
  return acceptClassifierRoute(parsed);
}
