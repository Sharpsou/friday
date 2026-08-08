export interface EncryptedEnvelope {
  ciphertext: string;
  iv: string;
  schemaVersion: 1;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function generateDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptJson(
  key: CryptoKey,
  value: unknown,
  additionalData: string,
): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(additionalData),
      tagLength: 128,
    },
    key,
    plaintext,
  );

  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    schemaVersion: 1,
  };
}

export async function decryptJson<T>(
  key: CryptoKey,
  envelope: EncryptedEnvelope,
  additionalData: string,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv),
      additionalData: encoder.encode(additionalData),
      tagLength: 128,
    },
    key,
    fromBase64(envelope.ciphertext),
  );

  return JSON.parse(decoder.decode(plaintext)) as T;
}
