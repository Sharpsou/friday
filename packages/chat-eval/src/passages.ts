import type {
  EvidencePassage,
  EvidenceSource,
  FrozenPage,
} from './contracts.js';

export interface PassageSelectionLimits {
  maxSources: number;
  maxPassages: number;
  maxCharacters: number;
}

export interface EvidenceDossier {
  sources: EvidenceSource[];
  passages: EvidencePassage[];
  characterCount: number;
}

export const DEFAULT_PASSAGE_LIMITS: PassageSelectionLimits = {
  maxSources: 8,
  maxPassages: 12,
  maxCharacters: 24_000,
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

function lexicalScore(
  questionTokens: Set<string>,
  title: string,
  heading: string | undefined,
  text: string,
): number {
  const occurrences = new Map<string, number>();
  for (const token of tokens(text)) {
    occurrences.set(token, (occurrences.get(token) ?? 0) + 1);
  }
  const titleTokens = new Set(tokens(title));
  const headingTokens = new Set(tokens(heading ?? ''));
  let score = 0;
  for (const token of questionTokens) {
    score += Math.min(occurrences.get(token) ?? 0, 4);
    if (headingTokens.has(token)) score += 2;
    if (titleTokens.has(token)) score += 1;
  }
  return score;
}

function validateLimits(limits: PassageSelectionLimits): void {
  if (
    !Number.isSafeInteger(limits.maxSources) ||
    !Number.isSafeInteger(limits.maxPassages) ||
    !Number.isSafeInteger(limits.maxCharacters) ||
    limits.maxSources < 1 ||
    limits.maxSources > 20 ||
    limits.maxPassages < 1 ||
    limits.maxPassages > 100 ||
    limits.maxCharacters < 1_000 ||
    limits.maxCharacters > 200_000
  ) {
    throw new Error('INVALID_PASSAGE_LIMITS');
  }
}

export function selectEvidencePassages(
  question: string,
  pages: FrozenPage[],
  limits: PassageSelectionLimits = DEFAULT_PASSAGE_LIMITS,
): EvidenceDossier {
  validateLimits(limits);
  const questionTokens = new Set(tokens(question));
  const candidates = pages.flatMap((page, pageIndex) =>
    page.sections.flatMap((section, sectionIndex) =>
      section.paragraphs.map((text, paragraphIndex) => ({
        source: page.source,
        heading: section.heading,
        text,
        order: [pageIndex, sectionIndex, paragraphIndex] as const,
        score: lexicalScore(
          questionTokens,
          page.source.title,
          section.heading,
          text,
        ),
      })),
    ),
  );

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.order[0] - right.order[0] ||
      left.order[1] - right.order[1] ||
      left.order[2] - right.order[2],
  );

  const chosen: typeof candidates = [];
  const selectedSources = new Set<string>();
  let characterCount = 0;

  const addCandidate = (candidate: (typeof candidates)[number]): boolean => {
    if (chosen.includes(candidate)) return false;
    const introducesSource = !selectedSources.has(candidate.source.id);
    if (introducesSource && selectedSources.size >= limits.maxSources) {
      return false;
    }
    const separatorSize = chosen.length === 0 ? 0 : 1;
    if (
      characterCount + candidate.text.length + separatorSize >
      limits.maxCharacters
    ) {
      return false;
    }
    chosen.push(candidate);
    selectedSources.add(candidate.source.id);
    characterCount += candidate.text.length + separatorSize;
    return true;
  };

  // A first pass gives distinct sources a fair chance before filling by score.
  for (const candidate of candidates) {
    if (chosen.length >= limits.maxPassages) break;
    if (!selectedSources.has(candidate.source.id)) addCandidate(candidate);
  }
  for (const candidate of candidates) {
    if (chosen.length >= limits.maxPassages) break;
    addCandidate(candidate);
  }

  const sources = pages
    .map(({ source }) => source)
    .filter(({ id }) => selectedSources.has(id));
  const passages = chosen.map(({ source, heading, text }, index) => ({
    id: `P${(index + 1).toString()}` as EvidencePassage['id'],
    sourceId: source.id,
    ...(heading === undefined ? {} : { heading }),
    text,
  }));
  return { sources, passages, characterCount };
}

export function resolvePassageSources(
  passageIds: EvidencePassage['id'][],
  dossier: EvidenceDossier,
): EvidenceSource[] {
  const sourceById = new Map(
    dossier.sources.map((source) => [source.id, source]),
  );
  const passageById = new Map(
    dossier.passages.map((passage) => [passage.id, passage]),
  );
  const resolved: EvidenceSource[] = [];
  const seen = new Set<string>();
  for (const passageId of passageIds) {
    const passage = passageById.get(passageId);
    if (!passage) throw new Error('UNKNOWN_PASSAGE_REFERENCE');
    const source = sourceById.get(passage.sourceId);
    if (!source) throw new Error('UNKNOWN_SOURCE_REFERENCE');
    if (!seen.has(source.id)) {
      seen.add(source.id);
      resolved.push(source);
    }
  }
  return resolved;
}
