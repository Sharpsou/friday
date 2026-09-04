import { describe, expect, it } from 'vitest';

import {
  boundedConversationTurns,
  fallbackContextualQuestion,
  needsConversationResolution,
  parseContextResolution,
} from '../src/context.js';

const history = [
  {
    role: 'user' as const,
    content: 'Donne-moi les dernières découvertes du télescope James Webb.',
  },
  {
    role: 'assistant' as const,
    content: 'Voici plusieurs résultats astronomiques récents.',
  },
];

describe('conversation context resolution', () => {
  it('detects elliptical follow-ups without rewriting standalone questions', () => {
    expect(
      needsConversationResolution(
        'Et en 2026 ? Quelles sont les découvertes ?',
        history,
      ),
    ).toBe(true);
    expect(
      needsConversationResolution(
        'Quelles découvertes le télescope James Webb a-t-il faites en 2026 ?',
        history,
      ),
    ).toBe(false);
    expect(
      needsConversationResolution('En français les podcasts', [
        {
          role: 'user',
          content: 'Je veux des podcasts sur Deezer à propos de l’agentique.',
        },
      ]),
    ).toBe(true);
  });

  it('rejects a follow-up rewrite that changes the conversation topic', () => {
    const podcastHistory = [
      {
        role: 'user' as const,
        content:
          'Je veux des podcasts sur Deezer à propos de l’agentique et de ses bonnes pratiques.',
      },
      {
        role: 'assistant' as const,
        content: 'Voici quelques pistes de podcasts techniques.',
      },
    ];
    expect(() =>
      parseContextResolution(
        JSON.stringify({
          standaloneQuestion:
            'Quels podcasts permettent d’apprendre la langue française ?',
        }),
        'En français les podcasts',
        podcastHistory,
      ),
    ).toThrow('CONTEXT_TOPIC_DRIFT');
    expect(
      parseContextResolution(
        JSON.stringify({
          standaloneQuestion:
            'Quels podcasts francophones sur Deezer traitent de l’IA agentique et de ses bonnes pratiques ?',
        }),
        'En français les podcasts',
        podcastHistory,
      ),
    ).toContain('agentique');
  });

  it('accepts a strict standalone question and rejects generated URLs', () => {
    expect(
      parseContextResolution(
        JSON.stringify({
          standaloneQuestion:
            'Quelles découvertes le télescope James Webb a-t-il faites en 2026 ?',
        }),
        'Et en 2026 ?',
      ),
    ).toContain('James Webb');
    expect(() =>
      parseContextResolution(
        JSON.stringify({
          standaloneQuestion:
            'Quelles découvertes sont listées sur https://invented.example ?',
        }),
        'Et en 2026 ?',
      ),
    ).toThrow('CONTEXT_GENERATED_URL_FORBIDDEN');
    expect(() =>
      parseContextResolution(
        JSON.stringify({
          standaloneQuestion: 'Question autonome',
          answer: 'Fait injecté',
        }),
        'Et ensuite ?',
      ),
    ).toThrow();
  });

  it('keeps several recent turns bounded and falls back to user text only', () => {
    const bounded = boundedConversationTurns([
      { role: 'user', content: 'Sujet initial' },
      { role: 'assistant', content: 'x'.repeat(10_000) },
      { role: 'user', content: 'Première relance' },
    ]);
    expect(bounded).toHaveLength(3);
    expect(bounded[1]?.content).toHaveLength(2_000);
    const fallback = fallbackContextualQuestion('Et en 2026 ?', history);
    expect(fallback).toContain('télescope James Webb');
    expect(fallback).not.toContain('résultats astronomiques');
  });
});
