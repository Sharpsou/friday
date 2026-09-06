import type { VerifiedChatEngineOptions } from '@friday/assistant-core';
import { type EvaluationDecision, type FunctionalOutcome } from './audit.js';
import {
  type AnswerAudit,
  type EvidenceSource,
  type FrozenPage,
} from './contracts.js';
import { type AutomatedMetrics } from './metrics.js';
import { type OllamaClient } from './ollama.js';
import {
  type EmbeddingProvider,
  type EvidenceDossier,
  type PassageSelectionLimits,
} from './passages.js';
import { PROMPT_VERSIONS } from './prompts.js';

export interface ModelPair {
  id: string;
  writerModel: string;
  auditorModel: string;
  profiles?: VerifiedChatEngineOptions['profiles'];
  modelsByRole?: VerifiedChatEngineOptions['modelsByRole'];
}

export interface TargetedResearch {
  (input: {
    caseId: string;
    question: string;
    missingAspects: string[];
    signal: AbortSignal;
  }): Promise<FrozenPage[]>;
}

export interface EvaluationRunnerOptions {
  ollama: OllamaClient;
  targetedResearch?: TargetedResearch;
  passageLimits?: PassageSelectionLimits;
  maxModelCalls?: number;
  embeddings?: EmbeddingProvider;
  axesEnabled?: boolean;
  pipeline?: 'unified' | 'axes' | 'legacy';
}

export interface EvaluationResult {
  pipeline?: 'unified' | 'axes' | 'legacy';
  publication?:
    | 'synthesis'
    | 'extractive'
    | 'discovery'
    | 'unverified'
    | 'abstained'
    | 'clarification';
  auditAvailable?: boolean;
  publishedSources?: Array<{
    id: string;
    sourceId: string | null;
    title: string;
    url: string;
  }>;
  fallbackCode?: string | null;
  caseId: string;
  pairId: string;
  seed: number;
  answer: string;
  decision: EvaluationDecision;
  audit: AnswerAudit;
  metrics: AutomatedMetrics;
  sourceIds: EvidenceSource['id'][];
  calls: number;
  researchUsed: boolean;
  revisionUsed: boolean;
  auditFallbacks: number;
  outcome: FunctionalOutcome;
  retrievalMode: EvidenceDossier['retrievalMode'];
  retrievalDiagnostics: EvidenceDossier['diagnostics'];
  referenceParagraphRecall: number | null;
  retrievalDimensionCoverage: number | null;
  elapsedMs: number;
  plannedAxisCount: number;
  requiredAxisCount: number;
  coveredAxisCount: number;
  promptVersions: typeof PROMPT_VERSIONS;
}
