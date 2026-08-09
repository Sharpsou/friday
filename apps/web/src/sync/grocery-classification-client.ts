import {
  GroceryClassificationApplyRequestSchema,
  GroceryClassificationApplyResponseSchema,
  GroceryClassificationJobSchema,
  GroceryClassificationPullResponseSchema,
  type GroceryClassificationApplyRequest,
  type GroceryClassificationApplyResponse,
  type GroceryClassificationJob,
} from '@friday/contracts';

import {
  applyGroceryClassificationChanges,
  getGroceryClassificationCursor,
} from '../db/grocery-classification-repository.js';
import { AuthenticationRequiredError } from './sync-client.js';

const CLASSIFICATION_REQUEST_TIMEOUT_MS = 5_000;

export class GroceryClassificationJobNotFoundError extends Error {}

function requestSignal(): AbortSignal {
  return AbortSignal.timeout(CLASSIFICATION_REQUEST_TIMEOUT_MS);
}

async function parseResponse<T>(
  response: Response,
  parser: { parse(value: unknown): T },
): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthenticationRequiredError('Authentification requise.');
    }
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      payload?.message ?? `Classement refusé (${response.status.toString()}).`,
    );
  }
  return parser.parse(await response.json());
}

export async function startGroceryClassification(): Promise<GroceryClassificationJob> {
  const response = await fetch('/api/groceries/classification-proposals', {
    method: 'POST',
    signal: requestSignal(),
  });
  return parseResponse(response, GroceryClassificationJobSchema);
}

export async function getGroceryClassificationJob(
  jobId: string,
): Promise<GroceryClassificationJob> {
  const response = await fetch(
    `/api/groceries/classification-proposals/${encodeURIComponent(jobId)}`,
    { signal: requestSignal() },
  );
  if (response.status === 404) {
    throw new GroceryClassificationJobNotFoundError('Job introuvable.');
  }
  return parseResponse(response, GroceryClassificationJobSchema);
}

export async function cancelGroceryClassification(
  jobId: string,
): Promise<GroceryClassificationJob> {
  const response = await fetch(
    `/api/groceries/classification-proposals/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST', signal: requestSignal() },
  );
  return parseResponse(response, GroceryClassificationJobSchema);
}

export async function applyGroceryClassification(
  input: GroceryClassificationApplyRequest,
): Promise<GroceryClassificationApplyResponse> {
  const payload = GroceryClassificationApplyRequestSchema.parse(input);
  const response = await fetch('/api/groceries/classifications/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: requestSignal(),
  });
  return parseResponse(response, GroceryClassificationApplyResponseSchema);
}

export async function syncGroceryClassifications(): Promise<void> {
  const cursor = await getGroceryClassificationCursor();
  const response = await fetch(
    `/api/groceries/classifications?after=${cursor.toString()}`,
    { signal: requestSignal() },
  );
  const payload = await parseResponse(
    response,
    GroceryClassificationPullResponseSchema,
  );
  await applyGroceryClassificationChanges(payload);
}
