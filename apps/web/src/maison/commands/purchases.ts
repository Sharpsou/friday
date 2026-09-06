import type {
  GroceryItemRecord,
  MaisonQuantity,
  MaisonRecord,
  StockEntry,
} from '@friday/contracts';
import {
  listMaisonRecords,
  maisonFields,
  saveMaisonCommand,
} from '../../db/maison-repository.js';
import { productForLabel } from './products.js';
import { stockMovement } from './stock.js';

export interface PurchaseInput {
  item: GroceryItemRecord;
  label: string;
  quantity: MaisonQuantity | null;
  location: StockEntry['location'];
  ignored: boolean;
}

export async function receivePurchases(inputs: PurchaseInput[]): Promise<void> {
  const records = await listMaisonRecords();
  const existing = new Set(records.map((r) => r.id));
  const writes: MaisonRecord[] = [];
  for (const input of inputs) {
    if (!input.item.checkedAt) throw new Error('Cet article n’est pas acheté.');
    if (
      records.some(
        (r) =>
          r.kind === 'receipt' &&
          r.groceryItemId === input.item.id &&
          r.checkedAt === input.item.checkedAt,
      )
    )
      continue;
    let stockId: string | null = null;
    if (!input.ignored) {
      const product = await productForLabel(input.label, records);
      const stock: StockEntry = {
        ...(await maisonFields()),
        kind: 'stock',
        productId: product.id,
        preparationId: null,
        label: product.name,
        quantity: input.quantity,
        location: input.location,
        status: input.quantity?.milli === 0 ? 'empty' : 'present',
        confirmedAt: new Date().toISOString(),
        expiresOn: null,
        threshold: null,
      };
      stockId = stock.id;
      writes.push(
        stock,
        await stockMovement(stock, stock, 'purchase', input.item.id),
      );
    }
    writes.push({
      ...(await maisonFields()),
      kind: 'receipt',
      groceryItemId: input.item.id,
      checkedAt: input.item.checkedAt,
      stockId,
      ignored: input.ignored,
    });
  }
  if (writes.length)
    await saveMaisonCommand([
      ...records.filter((r) => !existing.has(r.id)),
      ...writes,
    ]);
}
