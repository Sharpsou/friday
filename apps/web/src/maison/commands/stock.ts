import type { StockEntry, StockMovement } from '@friday/contracts';
import {
  listMaisonRecords,
  maisonFields,
  saveMaisonCommand,
} from '../../db/maison-repository.js';

export async function stockMovement(
  stock: StockEntry,
  next: StockEntry,
  reason: StockMovement['reason'],
  sourceId: string | null = null,
  compensatesId: string | null = null,
): Promise<StockMovement> {
  return {
    ...(await maisonFields()),
    kind: 'movement',
    stockId: stock.id,
    reason,
    before: stock.revision ? stock.quantity : null,
    after: next.quantity,
    sourceId,
    compensatesId,
  };
}

export async function saveStock(
  stock: StockEntry,
  reason: StockMovement['reason'] = 'correction',
): Promise<void> {
  const records = await listMaisonRecords();
  const old = records.find(
    (r): r is StockEntry => r.kind === 'stock' && r.id === stock.id,
  ) ?? { ...stock, quantity: null };
  const last = records
    .filter(
      (r): r is StockMovement =>
        r.kind === 'movement' && r.stockId === stock.id,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  await saveMaisonCommand([
    stock,
    await stockMovement(
      old,
      stock,
      old.revision ? reason : 'initial',
      null,
      old.revision && reason === 'correction' ? (last?.id ?? null) : null,
    ),
  ]);
}
