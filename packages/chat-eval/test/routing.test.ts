import { describe, expect, it } from 'vitest';

import type { GenerateRequest, GenerateResult } from '../src/ollama.js';

import {
  acceptClassifierRoute,
  routeDeterministically,
  routeQuestion,
} from '../src/routing.js';

describe('selective reinforced routing', () => {
  it.each([
    ['Quel est le prix actuel ?', 'current_information'],
    ['Quel médicament choisir ?', 'high_risk'],
    ['Recommande un ordinateur.', 'recommendation'],
    ['Cherche des sources fiables.', 'source_required'],
  ])('routes %s to web', (question, reason) => {
    expect(routeDeterministically(question)).toMatchObject({
      route: 'web',
      reason,
      decidedBy: 'code',
    });
  });

  it('keeps stable explanation local and labels it unverified', () => {
    expect(routeDeterministically('Explique une pile TCP.')).toMatchObject({
      route: 'local',
      verificationLabel: 'non vérifié par des sources',
    });
  });

  it('strictly bounds an ambiguous classifier result', () => {
    expect(() =>
      acceptClassifierRoute({
        route: 'web',
        reason: 'uncertain_fact',
        queries: ['a', 'b', 'c', 'd'],
      }),
    ).toThrow();
    expect(() =>
      acceptClassifierRoute({
        route: 'local',
        reason: 'stable_explanation',
        queries: ['must not run'],
      }),
    ).toThrow('LOCAL_ROUTE_MUST_NOT_QUERY');
  });

  it('uses the local classifier only for an ambiguous question', async () => {
    const requests: GenerateRequest[] = [];
    const ollama = {
      generate: async (request: GenerateRequest): Promise<GenerateResult> => {
        requests.push(request);
        return {
          response: JSON.stringify({
            route: 'web',
            reason: 'uncertain_fact',
            queries: ['question ambiguë'],
          }),
          durationMs: 1,
        };
      },
    };
    await expect(
      routeQuestion('Quelle est la situation de ce projet ?', {
        ollama: ollama as never,
        model: 'router',
        seed: 17,
      }),
    ).resolves.toMatchObject({ route: 'web', decidedBy: 'classifier' });
    expect(requests).toHaveLength(1);

    await routeQuestion('Explique comment fonctionne TCP.', {
      ollama: ollama as never,
      model: 'router',
      seed: 17,
    });
    expect(requests).toHaveLength(1);
  });
});
