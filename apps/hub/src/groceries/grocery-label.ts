import { createHash } from 'node:crypto';

export function normalizeGroceryLabel(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function groceryLabelFingerprint(label: string): string {
  return createHash('sha256')
    .update(normalizeGroceryLabel(label))
    .digest('hex');
}
