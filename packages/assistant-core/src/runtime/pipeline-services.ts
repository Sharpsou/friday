import {
  OllamaClient,
  type AnswerAudit,
  type AnswerPlan,
  type AuditUnit,
  type AxisEvidence,
  type EvidenceDossier,
  type FrozenPage,
} from '../foundation.js';
import type {
  ChatEngineInput,
  ChatEngineResult,
} from '../runtime-contracts.js';
import type {
  DiscoveryBundle,
  RuntimePageReader,
  VerifiedChatEngineOptions,
} from './runtime-types.js';
export interface PipelineServices {
  readonly options: VerifiedChatEngineOptions;
  readonly ollama: Pick<OllamaClient, 'generate' | 'embed'>;
  readonly auditorModel: string;
  readonly seed: number;
  contextualizeInput(
    input: ChatEngineInput,
    generate: (
      request: Parameters<OllamaClient['generate']>[0],
    ) => Promise<string>,
  ): Promise<ChatEngineInput>;
  routeAndPlan(
    input: ChatEngineInput,
    generate: (
      request: Parameters<OllamaClient['generate']>[0],
    ) => Promise<string>,
    unified?: boolean,
  ): Promise<{ route: 'local' | 'web'; plan: AnswerPlan | null }>;
  readonly writerModel: string;
  discoverBundle(
    queries: string[],
    signal: AbortSignal,
    sourceOffset?: number,
    recent?: boolean,
    budget?: {
      remaining: number;
      remainingPages?: number;
      visited?: Set<string>;
    },
    enforceQuality?: boolean,
  ): Promise<DiscoveryBundle>;
  readonly pageReader: RuntimePageReader;
  select(
    question: string,
    queries: string[],
    pages: FrozenPage[],
    signal: AbortSignal,
  ): Promise<EvidenceDossier>;
  discoverPages(
    queries: string[],
    signal: AbortSignal,
    sourceOffset?: number,
    recent?: boolean,
    budget?: {
      remaining: number;
      remainingPages?: number;
      visited?: Set<string>;
    },
  ): Promise<FrozenPage[]>;
  noEvidenceFallback(
    plan: AnswerPlan,
    modelCalls: number,
    fallbackCode: string,
  ): ChatEngineResult;
  write(
    input: ChatEngineInput,
    dossier: EvidenceDossier,
    generate: (
      request: Parameters<OllamaClient['generate']>[0],
    ) => Promise<string>,
    plan?: AnswerPlan,
    assignments?: AxisEvidence[],
    requestedResourceTypes?: string[],
  ): Promise<string>;
  audit(
    input: ChatEngineInput,
    answer: string,
    dossier: EvidenceDossier,
    generate: (
      request: Parameters<OllamaClient['generate']>[0],
    ) => Promise<string>,
    axes?: AnswerPlan['axes'],
    assignments?: AxisEvidence[],
    maxAttempts?: number,
  ): Promise<{ units: AuditUnit[]; audit: AnswerAudit; auditError: boolean }>;
  evidenceFallback(
    plan: AnswerPlan,
    assignments: AxisEvidence[],
    dossier: EvidenceDossier,
    modelCalls: number,
    status: 'abstained' | 'audit_error',
    fallbackCode: string,
    audit?: AnswerAudit,
  ): ChatEngineResult;
}
