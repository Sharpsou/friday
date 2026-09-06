import type {
  ChatAnswerStatus,
  ChatMode,
  ChatRetrievalMode,
  ChatRoute,
  ChatRunStage,
  ChatSource,
} from '@friday/contracts';
import type { ResearchMemory } from './research-memory.js';

export interface ChatEngineInput {
  priorResearch?: ResearchMemory;
  content: string;
  mode: ChatMode;
  priorTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal: AbortSignal;
  updateStage(stage: ChatRunStage): void;
}

export interface ChatEngineResult {
  researchMemory?: ResearchMemory;
  markdown: string;
  status: ChatAnswerStatus;
  route: ChatRoute;
  retrievalMode: ChatRetrievalMode;
  sources: ChatSource[];
  modelCalls: number;
  passageCount: number;
  axisCount?: number;
  requiredAxisCount?: number;
  coveredAxisCount?: number;
  rejectedUnitCount?: number;
  fallbackCode?: string | null;
  discoveredPageCount?: number;
  readablePageCount?: number;
  rejectedPageCount?: number;
  leadCount?: number;
}

export interface ChatEngine {
  answer(input: ChatEngineInput): Promise<ChatEngineResult>;
  webUsage?(
    signal: AbortSignal,
  ): Promise<{ creditsUsed: number; limit: number }>;
}
