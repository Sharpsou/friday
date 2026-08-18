import { InferenceStatusSchema, type InferenceStatus } from '@friday/contracts';

export async function getInferenceStatus(): Promise<InferenceStatus> {
  const response = await fetch('/api/inference/status');
  if (!response.ok)
    throw new Error(
      `État de l’IA indisponible (${response.status.toString()}).`,
    );
  return InferenceStatusSchema.parse(await response.json());
}
