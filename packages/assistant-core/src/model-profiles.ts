import type { GenerateRequest } from './ollama.js';

export type ModelRole = 'planning' | 'preparation' | 'writing' | 'verification';
export type ModelProfile = Pick<
  GenerateRequest,
  | 'contextTokens'
  | 'temperature'
  | 'topK'
  | 'topP'
  | 'repeatPenalty'
  | 'presencePenalty'
  | 'think'
>;
export const MODEL_PROFILE_VERSION = 'explicit-local-v1';
export function modelRole(prompt: string): ModelRole {
  if (prompt.startsWith('PREPARATION=')) return 'preparation';
  if (prompt.startsWith('VERIFICATION=')) return 'verification';
  if (
    prompt.startsWith('REDACTION=') ||
    prompt.includes('PROMPT_VERSION=local-')
  )
    return 'writing';
  return 'planning';
}
export function defaultModelProfile(
  model: string,
  role: ModelRole,
): ModelProfile {
  return {
    contextTokens: 32768,
    temperature: role === 'writing' ? 0.2 : 0,
    topK: model.startsWith('qwen') ? 20 : 64,
    topP: 0.95,
    presencePenalty: 0,
    repeatPenalty: 1,
    think: false,
  };
}
