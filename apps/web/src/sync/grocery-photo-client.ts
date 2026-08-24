import {
  GroceryPhotoTranscriptionRequestSchema,
  GroceryPhotoTranscriptionResponseSchema,
  type GroceryPhotoTranscriptionResponse,
} from '@friday/contracts';

const MAX_IMAGE_BYTES = 300_000;
const MAX_IMAGE_DIMENSION = 1600;
const REQUEST_TIMEOUT_MS = 135_000;

async function loadImage(file: File): Promise<{
  image: HTMLImageElement;
  objectUrl: string;
}> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return { image, objectUrl: url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('Cette photo ne peut pas être préparée.')),
      'image/jpeg',
      quality,
    );
  });
}

async function preparePhoto(file: File): Promise<{
  imageBase64: string;
  previewUrl: string;
}> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choisissez une photo de la liste de courses.');
  }
  const { image, objectUrl } = await loadImage(file);
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Préparation de la photo impossible.');
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  let quality = 0.86;
  let blob = await canvasBlob(canvas, quality);
  while (blob.size > MAX_IMAGE_BYTES && quality > 0.46) {
    quality -= 0.1;
    blob = await canvasBlob(canvas, quality);
  }
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error(
      'La photo reste trop volumineuse. Recadrez la feuille et réessayez.',
    );
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  const imageBase64 = btoa(binary);
  return {
    imageBase64,
    previewUrl: `data:image/jpeg;base64,${imageBase64}`,
  };
}

export async function transcribeGroceryPhoto(
  file: File,
  options: {
    onPrepared?: (previewUrl: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<GroceryPhotoTranscriptionResponse & { previewUrl: string }> {
  options.signal?.throwIfAborted();
  const prepared = await preparePhoto(file);
  options.signal?.throwIfAborted();
  options.onPrepared?.(prepared.previewUrl);
  const payload = GroceryPhotoTranscriptionRequestSchema.parse({
    imageBase64: prepared.imageBase64,
    mediaType: 'image/jpeg',
  });
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const response = await fetch('/api/groceries/photo-transcription', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      error?.message ?? `Lecture refusée (${response.status.toString()}).`,
    );
  }
  return {
    ...GroceryPhotoTranscriptionResponseSchema.parse(await response.json()),
    previewUrl: prepared.previewUrl,
  };
}
