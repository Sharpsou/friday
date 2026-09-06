import {
  OllamaClient,
  type AnswerAudit,
  type AuditUnit,
  type EvidenceDossier,
  type FrozenPage,
} from '../foundation.js';
import { type ModelProfile, type ModelRole } from '../model-profiles.js';
import { type SynthesisDossier } from '../synthesis.js';

export interface RuntimeObservation {
  kind:
    | 'evidence'
    | 'audit'
    | 'publication'
    | 'generation'
    | 'preparation'
    | 'failure';
  failure?: { stage: 'writing' | 'auditing'; attempt: number; code: string };
  generation?: {
    model: string;
    role: ModelRole;
    profile: ModelProfile;
    durationMs: number;
    promptTokens?: number;
    outputTokens?: number;
  };
  dossier?: EvidenceDossier;
  synthesisDossier?: SynthesisDossier;
  answer?: string;
  units?: AuditUnit[];
  audit?: AnswerAudit;
  valid?: boolean;
}

export interface RuntimeSearch {
  search(
    query: string,
    depth: 'advanced',
    signal: AbortSignal,
  ): Promise<{
    creditsUsed: number;
    evidence: Array<{
      title: string;
      url: string;
      publishedAt: string | null;
      content: string;
    }>;
  }>;
  usage?(signal: AbortSignal): Promise<{ creditsUsed: number; limit: number }>;
}

export interface RuntimePageReader {
  fetchArticleDocument(
    url: string,
    signal: AbortSignal,
  ): Promise<{
    text: string;
    publishedAt: string | null;
    sections?: FrozenPage['sections'];
    retrievedAt?: string;
  }>;
}

export interface VerifiedChatEngineOptions {
  ollama?: Pick<OllamaClient, 'generate' | 'embed'>;
  search: RuntimeSearch;
  pageReader: RuntimePageReader;
  profiles?: Partial<Record<ModelRole, ModelProfile>>;
  modelsByRole?: Partial<Record<ModelRole, string>>;
  writerModel?: string;
  auditorModel?: string;
  embeddingModel?: string;
  seed?: number;
  axesEnabled?: boolean;
  pipeline?: 'unified' | 'axes';
  retrieval?: 'hybrid' | 'lexical';
  observe?(event: RuntimeObservation): void;
}

interface DiscoveryLead {
  title: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
}

export interface DiscoveryBundle {
  pages: FrozenPage[];
  leads: DiscoveryLead[];
  discoveredCount: number;
  rejectedPageCount: number;
}
