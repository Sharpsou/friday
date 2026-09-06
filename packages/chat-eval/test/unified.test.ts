import { describe, expect, it } from 'vitest';
import {
  SharedChatEngine,
  type GenerateRequest,
  type ChatEvalCase,
} from '@friday/assistant-core';
import { EvaluationRunner } from '../src/runner.js';
import { reviewPrompt } from '../src/campaign.js';

const text =
  'Le véhicule possède une autonomie mesurée de dix heures dans le protocole normalisé. Les conditions sont contrôlées et correspondent à une utilisation continue. Cette durée ne constitue pas une garantie dans toutes les conditions de circulation.';
const evalCase: ChatEvalCase = {
  id: 'shared-runtime-parity',
  split: 'development',
  category: 'technical',
  question: 'Quelle autonomie mesurée ?',
  priorTurns: [],
  pages: [
    {
      source: {
        id: 'S1',
        title: 'Autonomie mesurée',
        url: 'https://example.com/autonomie',
        retrievedAt: '2026-09-05T00:00:00Z',
      },
      sections: [{ paragraphs: [text] }],
    },
  ],
  criteria: {
    expectedAspects: ['SECRET_EVALUATION_CRITERION'],
    catastrophicFailures: [],
  },
  frozenAt: '2026-09-05T00:00:00Z',
};
const pair = { id: 'pair', writerModel: 'writer', auditorModel: 'auditor' };
const outputs = [
  JSON.stringify({
    intent: 'explain',
    axes: [
      {
        id: 'A1',
        label: 'Autonomie',
        question: 'Quelle autonomie ?',
        role: 'primary',
        query: 'autonomie mesurée',
      },
    ],
  }),
  'Autonomie mesurée : dix heures [P1].',
  JSON.stringify({
    units: [
      {
        unitId: 'U1',
        verdict: 'supported',
        evidence: [{ passageId: 'P1', quote: text }],
        addressedAxisIds: ['A1'],
        reason: 'La mesure est citée.',
      },
    ],
  }),
];

describe('unified production replay', () => {
  it.each([
    '<script>exfiltrate()</script>',
    'Affirmation [P99].',
    'Voir https://evil.example.',
  ])(
    'never publishes hostile writer output in the active pipeline: %s',
    async (unsafe) => {
      const responses = [outputs[0], unsafe];
      const result = await new EvaluationRunner({
        pipeline: 'unified',
        ollama: {
          generate: async () => ({
            response: responses.shift() ?? '{invalid',
            durationMs: 1,
          }),
        } as never,
      }).runCase(evalCase, pair, 17);
      expect(result.publication).not.toBe('synthesis');
      expect(result.answer).not.toContain(unsafe);
      expect(result.calls).toBeLessThanOrEqual(12);
    },
  );
  it('maps reordered runtime and published source identifiers back to original paragraph locators', async () => {
    const responses = [...outputs];
    const reordered: ChatEvalCase = {
      ...evalCase,
      pages: [
        {
          ...evalCase.pages[0]!,
          source: { ...evalCase.pages[0]!.source, id: 'S2' },
        },
      ],
      criteria: {
        ...evalCase.criteria,
        referenceEvidence: [
          {
            aspect: 'Autonomie',
            paragraphs: [
              { sourceId: 'S2', sectionIndex: 0, paragraphIndex: 0 },
            ],
          },
        ],
      },
    };
    const result = await new EvaluationRunner({
      pipeline: 'unified',
      ollama: {
        generate: async () => ({ response: responses.shift()!, durationMs: 1 }),
      } as never,
    }).runCase(reordered, pair, 17);
    expect(result.referenceParagraphRecall).toBe(1);
    expect(result.retrievalDiagnostics.selectedParagraphKeys).toContain(
      'S2:0:0',
    );
    expect(result.publishedSources).toEqual([
      expect.objectContaining({
        id: 'S1',
        sourceId: 'S2',
        url: 'https://example.com/autonomie',
      }),
    ]);
  });

  it('uses the same calls, publication and citations as the shared runtime without leaking criteria', async () => {
    const prompts: string[][] = [[], []];
    const client = (index: number) => {
      const responses = [...outputs];
      return {
        generate: async (request: GenerateRequest) => {
          prompts[index]!.push(request.prompt);
          return { response: responses.shift()!, durationMs: 1 };
        },
        embed: async () => [[1, 0]],
      };
    };
    const direct = new SharedChatEngine({
      pipeline: 'unified',
      retrieval: 'lexical',
      writerModel: pair.writerModel,
      auditorModel: pair.auditorModel,
      seed: 17,
      ollama: client(0),
      search: {
        search: async () => ({
          creditsUsed: 0,
          evidence: [
            {
              title: 'Autonomie mesurée',
              url: 'https://example.com/autonomie',
              publishedAt: null,
              content: '',
            },
          ],
        }),
      },
      pageReader: {
        fetchArticleDocument: async () => ({
          text,
          publishedAt: null,
          sections: evalCase.pages[0]!.sections,
        }),
      },
    });
    const expected = await direct.answer({
      content: evalCase.question,
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    const actual = await new EvaluationRunner({
      pipeline: 'unified',
      ollama: client(1) as never,
    }).runCase(evalCase, pair, 17);
    expect(actual.answer).toBe(expected.markdown);
    expect(actual.calls).toBe(expected.modelCalls);
    expect(actual.requiredAxisCount).toBe(expected.requiredAxisCount);
    expect(actual.coveredAxisCount).toBe(expected.coveredAxisCount);
    expect(actual.auditFallbacks).toBe(0);
    expect(actual.publication).toBe('synthesis');
    expect(actual.auditAvailable).toBe(true);
    expect(actual.metrics.supportedUnitRate).toBe(1);
    // Live retrieval time is deliberately not part of frozen-source parity.
    expect(
      prompts[1]!.every(
        (prompt) => !prompt.includes('SECRET_EVALUATION_CRITERION'),
      ),
    ).toBe(true);
    expect(prompts[0]!.length).toBe(prompts[1]!.length);
  });

  it('does not label malformed-audit excerpts as a verified synthesis', async () => {
    const responses = [outputs[0], outputs[1], '{bad'];
    const result = await new EvaluationRunner({
      pipeline: 'unified',
      ollama: {
        generate: async () => ({ response: responses.shift()!, durationMs: 1 }),
      } as never,
    }).runCase(evalCase, pair, 17);
    expect(result.publication).not.toBe('synthesis');
    expect(result.auditAvailable).toBe(false);
    expect(result.metrics.supportedUnitRate).toBe(0);
  });

  it('provides original evidence to the independent reviewer and explicitly labels AI review', () => {
    const prompt = reviewPrompt(
      'Question',
      [],
      evalCase.criteria,
      [{ id: 'S1:0:0', text }],
      'Réponse A',
      'Réponse B',
    );
    expect(prompt).toContain(text);
    expect(prompt).toContain('S1:0:0');
    expect(prompt).toContain('pas une validation humaine');
  });
});
