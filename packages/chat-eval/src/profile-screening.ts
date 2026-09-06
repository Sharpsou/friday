import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitForIdleChat } from './campaign.js';
import {
  OllamaClient,
  auditSynthesis,
  defaultModelProfile,
  type EvidenceDossier,
  type AnswerPlan,
} from '@friday/assistant-core';

const root = process.argv[2];
if (!root || !/^[A-Z]:[\\/]/iu.test(root))
  throw new Error('ABSOLUTE_PRIVATE_OUTPUT_REQUIRED');
await mkdir(root, { recursive: true });
const models = [
  'gemma4:e2b-it-qat',
  'gemma4:e4b-it-qat',
  'qwen3.5:4b',
  'qwen3.5:9b-q4_K_M',
  'ministral-3:3b',
  'ministral-3:8b',
  'granite4.1:3b',
  'lfm2.5:8b',
];
const plan: AnswerPlan = {
  intent: 'explain',
  axes: [
    {
      id: 'A1',
      role: 'primary',
      label: 'Accès',
      question: 'Quand l’accès est-il possible ?',
      query: 'conditions accès',
    },
  ],
};
const original =
  'Sans identité de confiance, l’accès aux sauvegardes est impossible. Le contrôle Alpha vérifie les erreurs de structure. Le contrôle Beta peut modifier le schéma. La durée mesurée est de dix heures uniquement en usage continu normalisé.';
const dossier: EvidenceDossier = {
  sources: [],
  passages: [{ id: 'P1', sourceId: 'S1', text: original }],
  characterCount: original.length,
  retrievalMode: 'lexical_fallback',
  diagnostics: {
    candidateWindows: 1,
    queryCount: 1,
    lexicalCandidates: 1,
    semanticCandidates: 0,
    selectedParagraphKeys: [],
    queryPassageIds: [['P1']],
    queries: [],
  },
};
const answer =
  'Sans identité de confiance, l’accès aux sauvegardes est impossible. [P1]\n\nSans identité de confiance, l’accès aux sauvegardes est possible. [P1]\n\nLe contrôle Alpha modifie le schéma. [P1]\n\nLa durée est garantie à dix heures dans toutes les conditions. [P1]';
const client = new OllamaClient({
  timeoutMs: 90000,
  fetchImplementation: async (url, init) => {
    const response = await fetch(url, init);
    if (!response.ok)
      await writeFile(
        join(root, 'transport-error.json'),
        JSON.stringify(
          {
            body: JSON.parse(String(init?.body)),
            error: await response.clone().text(),
          },
          null,
          2,
        ),
      );
    return response;
  },
});
const results: unknown[] = [];
for (const model of models.filter(
  (m) => !process.env.SCREEN_MODEL || m === process.env.SCREEN_MODEL,
)) {
  const info = await fetch('http://127.0.0.1:11434/api/show', {
    method: 'POST',
    body: JSON.stringify({ model }),
  }).then((r) => r.json());
  for (const contextTokens of [8192, 16384, 32768]) {
    const started = Date.now();
    try {
      const audit = await auditSynthesis(
        'Explique ces conditions.',
        answer,
        plan,
        dossier,
        async (request) => {
          await waitForIdleChat('D:/FridayData/friday.sqlite');
          const generated = await client.generate({
            ...request,
            ...defaultModelProfile(model, 'verification'),
            contextTokens,
          });
          await writeFile(
            join(
              root,
              `${model.replace(/[^a-z0-9.-]/gi, '_')}-${contextTokens}.json`,
            ),
            JSON.stringify(generated, null, 2),
          );
          return generated.response;
        },
        model,
        AbortSignal.timeout(90000),
        17,
      );
      const pass =
        audit.units.length === 4 &&
        audit.units[0]?.verdict === 'supported' &&
        audit.units
          .slice(1)
          .every((u) => ['unsupported', 'contradicted'].includes(u.verdict));
      results.push({
        model,
        contextTokens,
        elapsedMs: Date.now() - started,
        pass,
        audit,
        details: info.details,
      });
      process.stdout.write(
        JSON.stringify({
          model,
          contextTokens,
          pass,
          elapsedMs: Date.now() - started,
        }) + '\n',
      );
      if (!pass) break;
    } catch (error) {
      results.push({
        model,
        contextTokens,
        elapsedMs: Date.now() - started,
        pass: false,
        error: error instanceof Error ? error.message : 'FAILED',
      });
      process.stdout.write(
        JSON.stringify({ model, contextTokens, error: 'SCREEN_FAILED' }) + '\n',
      );
      break;
    }
    await writeFile(
      join(root, 'verification-screen.json'),
      JSON.stringify(results, null, 2),
    );
  }
  await writeFile(
    join(root, 'verification-screen.json'),
    JSON.stringify(results, null, 2),
  );
}
