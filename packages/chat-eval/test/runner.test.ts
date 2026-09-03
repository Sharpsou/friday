import { describe, expect, it } from 'vitest';

import type { ChatEvalCase } from '../src/contracts.js';
import type { GenerateRequest, GenerateResult } from '../src/ollama.js';
import { blindLabel, EvaluationRunner } from '../src/runner.js';

const evalCase: ChatEvalCase = {
  id: 'synthetic-grounding',
  split: 'development',
  category: 'technical',
  question: 'Quelle autonomie est mesurée ?',
  priorTurns: [],
  pages: [
    {
      source: {
        id: 'S1',
        title: 'Protocole synthétique',
        url: 'https://example.com/protocol',
        retrievedAt: '2026-08-30T00:00:00.000Z',
      },
      sections: [
        {
          heading: 'Résultat',
          paragraphs: ['Autonomie mesurée : dix heures.'],
        },
      ],
    },
  ],
  criteria: {
    expectedAspects: ['autonomie mesurée'],
    catastrophicFailures: [],
  },
  frozenAt: '2026-08-30T00:00:00.000Z',
};

describe('EvaluationRunner', () => {
  it('plans and audits bounded axes without exposing evaluation criteria', async () => {
    const responses = [
      JSON.stringify({
        intent: 'explain',
        axes: [
          {
            id: 'A1',
            label: 'Mesure',
            question: 'Quelle autonomie a été mesurée ?',
            role: 'primary',
            query: 'autonomie mesurée protocole',
          },
        ],
      }),
      'L’autonomie mesurée est de dix heures [P1].',
      JSON.stringify({
        units: [
          {
            unitId: 'U1',
            verdict: 'supported',
            passageIds: ['P1'],
            addressedAxisIds: ['A1'],
          },
        ],
      }),
    ];
    const runner = new EvaluationRunner({
      axesEnabled: true,
      ollama: {
        generate: async (): Promise<GenerateResult> => ({
          response: responses.shift()!,
          durationMs: 1,
        }),
      } as never,
    });
    const result = await runner.runCase(
      evalCase,
      { id: 'pair', writerModel: 'writer', auditorModel: 'auditor' },
      7,
    );
    expect(result).toMatchObject({
      decision: 'pass',
      calls: 3,
      plannedAxisCount: 1,
      requiredAxisCount: 1,
      coveredAxisCount: 1,
    });
    expect(result.answer).toContain('[P1]');
  });

  it('publishes only after a separately structured audit', async () => {
    const requests: GenerateRequest[] = [];
    const responses = [
      'L’autonomie mesurée est de dix heures [P1].',
      JSON.stringify({
        units: [{ unitId: 'U1', verdict: 'supported', passageIds: ['P1'] }],
      }),
    ];
    const ollama = {
      generate: async (request: GenerateRequest): Promise<GenerateResult> => {
        requests.push(request);
        return { response: responses.shift()!, durationMs: 1 };
      },
    };
    const runner = new EvaluationRunner({
      ollama: ollama as never,
    });
    const result = await runner.runCase(
      evalCase,
      { id: 'pair', writerModel: 'writer', auditorModel: 'auditor' },
      7,
    );
    expect(result.decision).toBe('pass');
    expect(result.auditFallbacks).toBe(0);
    expect(result.calls).toBe(2);
    expect(result.sourceIds).toEqual(['S1']);
    expect(requests[0]?.format).toBeUndefined();
    expect(requests[1]?.format).toMatchObject({ type: 'object' });
  });

  it('fails closed without recursive JSON repair when the audit is invalid', async () => {
    const responses = [
      'L’autonomie annoncée est de dix heures [P1].',
      '{invalid',
      '{still-invalid',
    ];
    const runner = new EvaluationRunner({
      ollama: {
        generate: async (): Promise<GenerateResult> => ({
          response: responses.shift()!,
          durationMs: 1,
        }),
      } as never,
    });
    const result = await runner.runCase(
      evalCase,
      { id: 'pair', writerModel: 'writer', auditorModel: 'auditor' },
      17,
    );
    expect(result).toMatchObject({
      decision: 'partial',
      calls: 3,
      revisionUsed: false,
      auditFallbacks: 2,
      outcome: 'audit_error',
    });
    expect(result.answer).toContain('Je ne peux pas fournir');
  });

  it('rejects a URL or unknown citation emitted by the writer', async () => {
    const ollama = {
      generate: async (): Promise<GenerateResult> => ({
        response: 'Voir https://evil.example [P99].',
        durationMs: 1,
      }),
    };
    const runner = new EvaluationRunner({ ollama: ollama as never });
    await expect(
      runner.runCase(
        evalCase,
        { id: 'pair', writerModel: 'writer', auditorModel: 'auditor' },
        7,
      ),
    ).rejects.toThrow('MODEL_OUTPUT_URL_FORBIDDEN');
  });

  it('assigns complementary stable A/B labels', () => {
    const pairs = ['pair-one', 'pair-two'];
    expect(blindLabel('case', 17, pairs[0]!, pairs)).not.toBe(
      blindLabel('case', 17, pairs[1]!, pairs),
    );
    expect(blindLabel('case', 17, pairs[0]!, pairs)).toBe(
      blindLabel('case', 17, pairs[0]!, pairs),
    );
  });

  it('performs at most one revision and one final audit', async () => {
    const responses = [
      'Autonomie annoncée : douze heures [P1].',
      JSON.stringify({
        units: [{ unitId: 'U1', verdict: 'contradicted', passageIds: ['P1'] }],
      }),
      'Autonomie mesurée : dix heures [P1].',
      JSON.stringify({
        units: [{ unitId: 'U1', verdict: 'supported', passageIds: ['P1'] }],
      }),
    ];
    const runner = new EvaluationRunner({
      ollama: {
        generate: async (): Promise<GenerateResult> => ({
          response: responses.shift()!,
          durationMs: 1,
        }),
      } as never,
    });
    const result = await runner.runCase(
      evalCase,
      { id: 'pair', writerModel: 'writer', auditorModel: 'auditor' },
      17,
    );
    expect(result).toMatchObject({
      decision: 'pass',
      revisionUsed: true,
      researchUsed: false,
      calls: 4,
    });
  });

  it('performs at most one targeted research before the final draft', async () => {
    const responses = [
      JSON.stringify({
        intent: 'explain',
        axes: [
          {
            id: 'A1',
            label: 'Température ambiante',
            question: 'Quelle température ambiante encadrait le test ?',
            role: 'primary',
            query: 'température ambiante test',
          },
        ],
      }),
      'La preuve initiale est insuffisante.',
      JSON.stringify({
        units: [
          {
            unitId: 'U1',
            verdict: 'unsupported',
            passageIds: [],
            addressedAxisIds: ['A1'],
          },
        ],
      }),
      'Le test a été réalisé à vingt degrés [P2].',
      JSON.stringify({
        units: [
          {
            unitId: 'U1',
            verdict: 'supported',
            passageIds: ['P2'],
            addressedAxisIds: ['A1'],
          },
        ],
      }),
    ];
    let searches = 0;
    const runner = new EvaluationRunner({
      axesEnabled: true,
      ollama: {
        generate: async (): Promise<GenerateResult> => ({
          response: responses.shift()!,
          durationMs: 1,
        }),
      } as never,
      targetedResearch: async () => {
        searches += 1;
        return [
          {
            source: {
              id: 'S2',
              title: 'Conditions du test',
              url: 'https://example.org/measure',
              retrievedAt: '2026-08-30T00:00:00.000Z',
            },
            sections: [
              { paragraphs: ['Le test a été réalisé à vingt degrés.'] },
            ],
          },
        ];
      },
    });
    const result = await runner.runCase(
      evalCase,
      { id: 'pair', writerModel: 'writer', auditorModel: 'auditor' },
      17,
    );
    expect(searches).toBe(1);
    expect(result).toMatchObject({
      decision: 'pass',
      revisionUsed: false,
      researchUsed: true,
      calls: 5,
    });
  });
});
