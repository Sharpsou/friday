import type { MaisonRecord, Product } from '@friday/contracts';
import { maisonFields } from '../../db/maison-repository.js';

export async function productForLabel(
  label: string,
  records: MaisonRecord[],
): Promise<Product> {
  const name = label.trim();
  const exact = records.find(
    (r): r is Product =>
      r.kind === 'product' && !r.deletedAt && r.name === name,
  );
  if (exact) return exact;
  const product: Product = {
    ...(await maisonFields()),
    kind: 'product',
    name,
    aliases: [],
    conversions: [],
  };
  records.push(product);
  return product;
}
