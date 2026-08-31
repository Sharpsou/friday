import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { z } from 'zod';

import {
  CorpusSchema,
  FrozenPageSchema,
  HumanCriteriaSchema,
  PriorTurnSchema,
  type Corpus,
  type FrozenPage,
} from './contracts.js';

export const DEFAULT_CORPUS_ROOT =
  'D:\\FridayData\\evaluations\\chat-foundation-v1';

const DraftCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/u),
  split: z.enum(['development', 'validation']),
  category: z.enum([
    'current_events',
    'explanation',
    'comparison',
    'recommendation',
    'procedure',
    'local',
    'scientific',
    'technical',
    'high_risk',
    'context_followup',
  ]),
  question: z.string().trim().min(3).max(2_000),
  priorTurns: z.array(PriorTurnSchema).max(2),
  criteria: HumanCriteriaSchema,
  pages: z.array(FrozenPageSchema).max(20).default([]),
  frozenAt: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(['needs_frozen_pages', 'ready_to_freeze']),
});

const DraftCorpusSchema = z.strictObject({
  version: z.literal('chat-foundation-v1'),
  warning: z.string(),
  cases: z.array(DraftCaseSchema).length(20),
});

const CATEGORIES = [
  'current_events',
  'explanation',
  'comparison',
  'recommendation',
  'procedure',
  'local',
  'scientific',
  'technical',
  'high_risk',
  'context_followup',
] as const;

const QUESTIONS: Record<(typeof CATEGORIES)[number], string> = {
  current_events:
    '[À préciser] Résumer un événement récent à partir des pages figées.',
  explanation:
    '[À préciser] Expliquer un concept stable à différents niveaux de détail.',
  comparison:
    '[À préciser] Comparer deux options selon des critères explicites.',
  recommendation:
    '[À préciser] Recommander une option avec contraintes et compromis.',
  procedure: '[À préciser] Décrire une procédure vérifiable et ses prérequis.',
  local: '[À préciser] Répondre à une question locale dépendant du lieu.',
  scientific: '[À préciser] Expliquer un résultat scientifique et ses limites.',
  technical:
    '[À préciser] Diagnostiquer un problème technique depuis la documentation.',
  high_risk: '[À préciser] Répondre prudemment à une question à enjeu élevé.',
  context_followup:
    '[À préciser] Répondre à une relance en utilisant au plus deux tours.',
};

export function privateCorpusRoot(root: string): string {
  const resolved = resolve(root);
  const allowed = resolve('D:\\FridayData\\evaluations');
  const relation = relative(allowed, resolved);
  if (relation.startsWith('..') || relation === '' || relation.includes(':')) {
    throw new Error('CORPUS_ROOT_MUST_BE_PRIVATE_EVALUATIONS_CHILD');
  }
  return resolved;
}

export async function initializeCorpusWorkspace(
  root = DEFAULT_CORPUS_ROOT,
): Promise<{ root: string; created: string[]; legacyCandidates: number }> {
  const safeRoot = privateCorpusRoot(root);
  await mkdir(join(safeRoot, 'pages'), { recursive: true });
  await mkdir(join(safeRoot, 'results'), { recursive: true });
  await mkdir(join(safeRoot, 'reviews'), { recursive: true });
  await mkdir(join(safeRoot, 'imports'), { recursive: true });

  const cases = (['development', 'validation'] as const).flatMap((split) =>
    CATEGORIES.map((category) => ({
      id: `${split === 'development' ? 'dev' : 'val'}-${category.replaceAll('_', '-')}`,
      split,
      category,
      question: QUESTIONS[category],
      priorTurns: [],
      criteria: {
        expectedAspects: ['[À définir avant gel]'],
        catastrophicFailures: ['citation ou URL inventée'],
      },
      pages: [],
      status: 'needs_frozen_pages' as const,
    })),
  );
  const draft = DraftCorpusSchema.parse({
    version: 'chat-foundation-v1',
    warning:
      'BROUILLON NON EXÉCUTABLE : compléter les questions, critères et pages originales, puis geler avec corpus:freeze.',
    cases,
  });
  const draftPath = join(safeRoot, 'corpus-draft.json');
  const serializedDraft = `${JSON.stringify(draft, null, 2)}\n`;
  let alreadyExisted = false;
  await writeFile(draftPath, serializedDraft, {
    encoding: 'utf8',
    flag: 'wx',
  }).catch((error: unknown) => {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    ) {
      throw error;
    }
    alreadyExisted = true;
  });
  if (alreadyExisted) {
    const existingRaw = await readFile(draftPath, 'utf8');
    const existing = JSON.parse(existingRaw) as unknown;
    if (
      typeof existing === 'object' &&
      existing !== null &&
      'version' in existing &&
      existing.version === 'chat-foundation-v1' &&
      'cases' in existing &&
      Array.isArray(existing.cases) &&
      existing.cases.some(
        (item) =>
          typeof item === 'object' && item !== null && !('pages' in item),
      )
    ) {
      const migrated = {
        ...existing,
        cases: existing.cases.map((item) =>
          typeof item === 'object' && item !== null && !('pages' in item)
            ? { ...item, pages: [] }
            : item,
        ),
      };
      DraftCorpusSchema.parse(migrated);
      await writeFile(
        join(safeRoot, 'corpus-draft.before-pages-schema.json'),
        existingRaw,
        { encoding: 'utf8', flag: 'wx' },
      ).catch(() => undefined);
      await writeFile(
        draftPath,
        `${JSON.stringify(migrated, null, 2)}\n`,
        'utf8',
      );
    }
  }
  const legacyCandidates = await importLegacyFrozenPages(safeRoot);
  return { root: safeRoot, created: [draftPath], legacyCandidates };
}

async function jsonFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return jsonFiles(path);
      return entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
    }),
  );
  return nested.flat();
}

function frozenPagesFromUnknown(value: unknown): FrozenPage[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  for (const key of ['frozenPages', 'pages']) {
    const parsed = z.array(FrozenPageSchema).safeParse(candidate[key]);
    if (parsed.success && parsed.data.length > 0) return parsed.data;
  }
  return null;
}

export async function importLegacyFrozenPages(
  destinationRoot: string,
  evaluationsRoot = 'D:\\FridayData\\evaluations',
): Promise<number> {
  const destination = privateCorpusRoot(destinationRoot);
  const files = (await jsonFiles(evaluationsRoot)).filter(
    (path) => !path.startsWith(destination),
  );
  let imported = 0;
  for (const file of files) {
    let payload: unknown;
    try {
      payload = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      continue;
    }
    const candidates = Array.isArray(payload)
      ? payload
      : typeof payload === 'object' && payload !== null && 'results' in payload
        ? (payload as { results: unknown }).results
        : [payload];
    if (!Array.isArray(candidates)) continue;
    for (const [index, candidate] of candidates.entries()) {
      const pages = frozenPagesFromUnknown(candidate);
      if (!pages) continue;
      const name = `${basename(dirname(file))}-${index.toString()}.pages.json`;
      await writeFile(
        join(destination, 'imports', name),
        `${JSON.stringify(pages, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      ).catch(() => undefined);
      imported += 1;
    }
  }
  const report = {
    scannedAt: new Date().toISOString(),
    jsonFilesReadOnly: files.length,
    exploitableFrozenPageSets: imported,
    note: 'Les manifests sources ont été lus sans modification. Les sorties de modèles seules ne sont pas des pages originales exploitables.',
  };
  await writeFile(
    join(destination, 'imports', 'legacy-import-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  return imported;
}

export async function loadFrozenCorpus(
  root = DEFAULT_CORPUS_ROOT,
): Promise<Corpus> {
  const safeRoot = privateCorpusRoot(root);
  const payload = JSON.parse(
    await readFile(join(safeRoot, 'corpus.json'), 'utf8'),
  ) as unknown;
  return CorpusSchema.parse(payload);
}

export async function freezeCorpus(
  root = DEFAULT_CORPUS_ROOT,
): Promise<string> {
  const safeRoot = privateCorpusRoot(root);
  const draft = DraftCorpusSchema.parse(
    JSON.parse(await readFile(join(safeRoot, 'corpus-draft.json'), 'utf8')),
  );
  const frozenAt = new Date().toISOString();
  const corpus = CorpusSchema.parse({
    version: draft.version,
    frozen: true,
    cases: draft.cases.map(({ status, ...evalCase }) => {
      if (status !== 'ready_to_freeze') {
        throw new Error(`CASE_NOT_READY:${evalCase.id}`);
      }
      return { ...evalCase, frozenAt: evalCase.frozenAt ?? frozenAt };
    }),
  });
  const path = join(safeRoot, 'corpus.json');
  await writeFile(path, `${JSON.stringify(corpus, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return path;
}
