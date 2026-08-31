import type {
  EvidencePassage,
  EvidenceSource,
  FrozenPage,
} from './contracts.js';

export interface PassageSelectionLimits {
  maxSources: number;
  maxPassages: number;
  maxCharacters: number;
  maxPassagesPerSource?: number;
}
export interface EvidenceDossier {
  sources: EvidenceSource[];
  passages: EvidencePassage[];
  characterCount: number;
  retrievalMode: 'hybrid' | 'lexical_fallback';
  diagnostics: {
    candidateWindows: number;
    queryCount: number;
    lexicalCandidates: number;
    semanticCandidates: number;
    selectedParagraphKeys: string[];
  };
}
export interface EmbeddingProvider {
  embed(input: string[], signal?: AbortSignal): Promise<number[][]>;
}
export const DEFAULT_PASSAGE_LIMITS: PassageSelectionLimits = {
  maxSources: 8,
  maxPassages: 12,
  maxCharacters: 24_000,
  maxPassagesPerSource: 3,
};

const STOP_WORDS = new Set([
  'avec',
  'cette',
  'dans',
  'des',
  'est',
  'les',
  'pour',
  'que',
  'qui',
  'quoi',
  'sur',
  'une',
  'vous',
  'aux',
  'son',
  'ses',
  'leur',
  'leurs',
  'par',
  'plus',
]);
function tokens(value: string): string[] {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('fr-FR')
      .match(/[a-z0-9]{2,}/gu)
      ?.filter((token) => !STOP_WORDS.has(token)) ?? []
  );
}
function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}
function usefulParagraph(value: string): boolean {
  const text = normalized(value);
  return (
    text.length >= 15 &&
    !/^(copier le lien|lien copi[ée]|voir aussi|en savoir plus|accueil|menu|navigation)$/iu.test(
      text,
    )
  );
}
function validateLimits(
  limits: PassageSelectionLimits,
): Required<PassageSelectionLimits> {
  const normalizedLimits = {
    ...limits,
    maxPassagesPerSource: limits.maxPassagesPerSource ?? 3,
  };
  if (
    !Number.isSafeInteger(normalizedLimits.maxSources) ||
    normalizedLimits.maxSources < 1 ||
    normalizedLimits.maxSources > 20 ||
    !Number.isSafeInteger(normalizedLimits.maxPassages) ||
    normalizedLimits.maxPassages < 1 ||
    normalizedLimits.maxPassages > 100 ||
    !Number.isSafeInteger(normalizedLimits.maxCharacters) ||
    normalizedLimits.maxCharacters < 1_000 ||
    normalizedLimits.maxCharacters > 200_000 ||
    !Number.isSafeInteger(normalizedLimits.maxPassagesPerSource) ||
    normalizedLimits.maxPassagesPerSource < 1 ||
    normalizedLimits.maxPassagesPerSource > 12
  )
    throw new Error('INVALID_PASSAGE_LIMITS');
  return normalizedLimits;
}

interface Candidate {
  source: EvidenceSource;
  heading?: string;
  text: string;
  order: number;
  tokenCounts: Map<string, number>;
  length: number;
  paragraphKeys: string[];
}

function candidatesFromPages(pages: FrozenPage[]): Candidate[] {
  const result: Candidate[] = [];
  const seen = new Set<string>();
  let order = 0;
  for (const page of pages) {
    for (const [sectionIndex, section] of page.sections.entries()) {
      const paragraphs = section.paragraphs
        .map(normalized)
        .filter(usefulParagraph);
      for (let start = 0; start < paragraphs.length; start += 1) {
        let text = '';
        for (
          let size = 1;
          size <= 3 && start + size <= paragraphs.length;
          size += 1
        ) {
          const next = paragraphs[start + size - 1]!;
          const joined = text ? `${text}\n${next}` : next;
          if (joined.length > 2_000) break;
          text = joined;
        }
        if (!text || seen.has(`${page.source.id}\0${text}`)) continue;
        seen.add(`${page.source.id}\0${text}`);
        const counts = new Map<string, number>();
        for (const token of tokens(
          `${page.source.title} ${section.heading ?? ''} ${text}`,
        ))
          counts.set(token, (counts.get(token) ?? 0) + 1);
        result.push({
          source: page.source,
          ...(section.heading ? { heading: section.heading } : {}),
          text,
          order: order++,
          tokenCounts: counts,
          length: [...counts.values()].reduce((sum, count) => sum + count, 0),
          paragraphKeys: Array.from(
            { length: text.split('\n').length },
            (_, index) =>
              `${page.source.id}:${sectionIndex.toString()}:${(start + index).toString()}`,
          ),
        });
      }
    }
  }
  return result;
}

function bm25Ranks(queries: string[], candidates: Candidate[]): number[][] {
  const averageLength =
    candidates.reduce((sum, candidate) => sum + candidate.length, 0) /
    Math.max(candidates.length, 1);
  const documentFrequency = new Map<string, number>();
  for (const candidate of candidates)
    for (const token of candidate.tokenCounts.keys())
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  return queries.map((query) => {
    const queryTokens = [...new Set(tokens(query))];
    return candidates
      .map((candidate, index) => {
        let score = 0;
        for (const token of queryTokens) {
          const frequency = candidate.tokenCounts.get(token) ?? 0;
          if (frequency === 0) continue;
          const df = documentFrequency.get(token) ?? 0;
          const idf = Math.log(1 + (candidates.length - df + 0.5) / (df + 0.5));
          score +=
            idf *
            ((frequency * 2.2) /
              (frequency +
                1.2 *
                  (0.25 +
                    (0.75 * candidate.length) / Math.max(averageLength, 1))));
        }
        return { index, score };
      })
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          candidates[left.index]!.order - candidates[right.index]!.order,
      )
      .map(({ index }) => index);
  });
}

function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  return leftNorm === 0 || rightNorm === 0
    ? -1
    : dot / Math.sqrt(leftNorm * rightNorm);
}

function reciprocalRanks(rankings: number[][], take = 36): Map<number, number> {
  const scores = new Map<number, number>();
  for (const ranking of rankings)
    ranking
      .slice(0, take)
      .forEach((candidateIndex, rank) =>
        scores.set(
          candidateIndex,
          (scores.get(candidateIndex) ?? 0) + 1 / (60 + rank + 1),
        ),
      );
  return scores;
}

function buildDossier(
  candidates: Candidate[],
  queries: string[],
  lexicalRankings: number[][],
  semanticRankings: number[][],
  limitsInput: PassageSelectionLimits,
  mode: EvidenceDossier['retrievalMode'],
): EvidenceDossier {
  const limits = validateLimits(limitsInput);
  const fused = reciprocalRanks([...lexicalRankings, ...semanticRankings]);
  const ordered = [...fused.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] || candidates[a[0]]!.order - candidates[b[0]]!.order,
    )
    .map(([index]) => index);
  const reserved = [
    ...new Set(
      queries
        .flatMap((_, queryIndex) => [
          lexicalRankings[queryIndex]?.[0],
          semanticRankings[queryIndex]?.[0],
        ])
        .filter((value): value is number => value !== undefined),
    ),
  ];
  const selected: number[] = [];
  const sourceCounts = new Map<string, number>();
  let characterCount = 0;
  const add = (index: number): void => {
    if (selected.includes(index) || selected.length >= limits.maxPassages)
      return;
    const candidate = candidates[index]!;
    const candidateTokens = new Set(candidate.tokenCounts.keys());
    const nearDuplicate = selected.some((selectedIndex) => {
      const previous = candidates[selectedIndex]!;
      if (previous.source.id !== candidate.source.id) return false;
      const previousTokens = new Set(previous.tokenCounts.keys());
      const intersection = [...candidateTokens].filter((token) =>
        previousTokens.has(token),
      ).length;
      const union = new Set([...candidateTokens, ...previousTokens]).size;
      return union > 0 && intersection / union >= 0.8;
    });
    if (nearDuplicate) return;
    const sourceCount = sourceCounts.get(candidate.source.id) ?? 0;
    if (sourceCount >= limits.maxPassagesPerSource) return;
    if (sourceCount === 0 && sourceCounts.size >= limits.maxSources) return;
    const increment = candidate.text.length + (selected.length ? 1 : 0);
    if (characterCount + increment > limits.maxCharacters) return;
    selected.push(index);
    sourceCounts.set(candidate.source.id, sourceCount + 1);
    characterCount += increment;
  };
  reserved.forEach(add);
  ordered.forEach(add);
  const passages = selected.map((index, passageIndex) => {
    const candidate = candidates[index]!;
    return {
      id: `P${(passageIndex + 1).toString()}` as EvidencePassage['id'],
      sourceId: candidate.source.id,
      ...(candidate.heading ? { heading: candidate.heading } : {}),
      text: candidate.text,
    };
  });
  const sourceIds = new Set(passages.map(({ sourceId }) => sourceId));
  return {
    sources: candidates
      .map(({ source }) => source)
      .filter(
        (source, index, all) =>
          sourceIds.has(source.id) &&
          all.findIndex((item) => item.id === source.id) === index,
      ),
    passages,
    characterCount,
    retrievalMode: mode,
    diagnostics: {
      candidateWindows: candidates.length,
      queryCount: queries.length,
      lexicalCandidates: Math.min(36, candidates.length),
      semanticCandidates: semanticRankings.length
        ? Math.min(36, candidates.length)
        : 0,
      selectedParagraphKeys: [
        ...new Set(
          selected.flatMap((index) => {
            const candidate = candidates[index]!;
            return candidate.paragraphKeys;
          }),
        ),
      ],
    },
  };
}

export function normalizeRetrievalQueries(
  question: string,
  additional: string[] = [],
): string[] {
  const values = [question, ...additional]
    .map(normalized)
    .filter((value) => value.length >= 2 && value.length <= 300);
  return [...new Set(values)].slice(0, 3);
}

async function embedInBatches(
  provider: EmbeddingProvider,
  values: string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let offset = 0; offset < values.length; offset += 32) {
    signal?.throwIfAborted();
    const batch = values.slice(offset, offset + 32);
    const next = await provider.embed(batch, signal);
    if (next.length !== batch.length)
      throw new Error('EMBEDDING_COUNT_MISMATCH');
    vectors.push(...next);
  }
  return vectors;
}

export function selectEvidencePassages(
  question: string,
  pages: FrozenPage[],
  limits: PassageSelectionLimits = DEFAULT_PASSAGE_LIMITS,
): EvidenceDossier {
  const candidates = candidatesFromPages(pages);
  const queries = normalizeRetrievalQueries(question);
  return buildDossier(
    candidates,
    queries,
    bm25Ranks(queries, candidates),
    [],
    limits,
    'lexical_fallback',
  );
}

export async function selectEvidencePassagesHybrid(input: {
  question: string;
  queries?: string[];
  pages: FrozenPage[];
  embeddings?: EmbeddingProvider;
  limits?: PassageSelectionLimits;
  signal?: AbortSignal;
}): Promise<EvidenceDossier> {
  const candidates = candidatesFromPages(input.pages);
  const queries = normalizeRetrievalQueries(input.question, input.queries);
  const lexical = bm25Ranks(queries, candidates);
  if (!input.embeddings || candidates.length === 0)
    return buildDossier(
      candidates,
      queries,
      lexical,
      [],
      input.limits ?? DEFAULT_PASSAGE_LIMITS,
      'lexical_fallback',
    );
  try {
    const vectors = await embedInBatches(
      input.embeddings,
      [
        ...queries,
        ...candidates.map(
          ({ source, heading, text }) =>
            `${source.title}\n${heading ?? ''}\n${text}`,
        ),
      ],
      input.signal,
    );
    const queryVectors = vectors.slice(0, queries.length);
    const candidateVectors = vectors.slice(queries.length);
    const semantic = queryVectors.map((queryVector) =>
      candidateVectors
        .map((candidateVector, index) => ({
          index,
          score: cosine(queryVector!, candidateVector!),
        }))
        .sort(
          (a, b) =>
            b.score - a.score ||
            candidates[a.index]!.order - candidates[b.index]!.order,
        )
        .map(({ index }) => index),
    );
    return buildDossier(
      candidates,
      queries,
      lexical,
      semantic,
      input.limits ?? DEFAULT_PASSAGE_LIMITS,
      'hybrid',
    );
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return buildDossier(
      candidates,
      queries,
      lexical,
      [],
      input.limits ?? DEFAULT_PASSAGE_LIMITS,
      'lexical_fallback',
    );
  }
}

export function resolvePassageSources(
  passageIds: EvidencePassage['id'][],
  dossier: EvidenceDossier,
): EvidenceSource[] {
  const sources = new Map(dossier.sources.map((source) => [source.id, source]));
  const passages = new Map(
    dossier.passages.map((passage) => [passage.id, passage]),
  );
  const resolved: EvidenceSource[] = [];
  const seen = new Set<string>();
  for (const id of passageIds) {
    const passage = passages.get(id);
    if (!passage) throw new Error('UNKNOWN_PASSAGE_REFERENCE');
    const source = sources.get(passage.sourceId);
    if (!source) throw new Error('UNKNOWN_SOURCE_REFERENCE');
    if (!seen.has(source.id)) {
      seen.add(source.id);
      resolved.push(source);
    }
  }
  return resolved;
}
