import type {
  GroceryItemRecord,
  MaisonCommand,
  MaisonQuantity,
  ShoppingCoverage,
} from '@friday/contracts';
import {
  convertQuantity,
  coverageIsProtected,
  quantityLabel,
} from '@friday/domain';
import {
  listMaisonRecords,
  maisonFields,
  saveMaisonCommand,
} from '../../db/maison-repository.js';

export interface ShoppingDecision {
  originKey: string;
  productId: string;
  preparationId: string | null;
  ingredientId: string | null;
  label: string;
  quantity: MaisonQuantity | null;
  excluded: boolean;
  existingGroceryId?: string;
}

/** Keep source contributions even when several recipe ingredients share a single grocery row. */
export async function applyShoppingDecisions(
  decisions: ShoppingDecision[],
  groceries: readonly GroceryItemRecord[],
): Promise<void> {
  const records = await listMaisonRecords();
  const coverage = records.filter(
    (r): r is ShoppingCoverage => r.kind === 'coverage' && !r.deletedAt,
  );
  const updated: ShoppingCoverage[] = [];
  const groceryWrites: MaisonCommand['payload']['groceryWrites'] = [];
  const manuallyLinked = new Set<string>();
  for (const d of decisions) {
    const old = coverage.find((c) => c.originKey === d.originKey);
    if (old && coverageIsProtected(old, groceries)) continue;
    const linked = d.existingGroceryId
      ? groceries.find(
          (g) => g.id === d.existingGroceryId && !g.checkedAt && !g.deletedAt,
        )
      : null;
    if (d.existingGroceryId && !linked)
      throw new Error('La course choisie a changé. Rouvrez le bilan.');
    if (linked) {
      if (
        manuallyLinked.has(linked.id) ||
        coverage.some(
          (c) => c.groceryItemId === linked.id && c.originKey !== d.originKey,
        )
      )
        throw new Error(
          'Cette course couvre déjà un autre besoin. Vérifiez les quantités séparément.',
        );
      manuallyLinked.add(linked.id);
    }
    updated.push({
      ...(old ?? (await maisonFields())),
      kind: 'coverage',
      originKey: d.originKey,
      productId: d.productId,
      preparationId: d.preparationId,
      ingredientId: d.ingredientId,
      quantity: d.quantity,
      excluded: d.excluded,
      managed: !linked,
      groceryItemId:
        linked?.id ??
        (old?.quantity?.unit === d.quantity?.unit
          ? (old?.groceryItemId ?? null)
          : null),
      labelSnapshot: linked?.label ?? old?.labelSnapshot ?? d.label,
      quantityTextSnapshot:
        linked?.quantityText ?? old?.quantityTextSnapshot ?? null,
    });
  }
  const all = new Map(coverage.map((c) => [c.originKey, c]));
  for (const c of updated) all.set(c.originKey, c);
  // Recompute all contributions of an affected group, including those outside the selected period.
  const groupKey = (c: ShoppingCoverage) =>
    `${c.productId}:${c.quantity?.unit ?? 'unknown'}`;
  const groups = new Set([
    ...updated.map(groupKey),
    ...coverage
      .filter((c) => updated.some((u) => u.originKey === c.originKey))
      .map(groupKey),
  ]);
  const writes = new Map(updated.map((c) => [c.originKey, c]));
  for (const key of groups) {
    const members = [...all.values()].filter(
      (c) => groupKey(c) === key && !coverageIsProtected(c, groceries),
    );
    const previousMembers = coverage.filter(
      (c) => groupKey(c) === key && !coverageIsProtected(c, groceries),
    );
    const active = members.filter(
      (c) => !c.excluded && (c.quantity === null || c.quantity.milli > 0),
    );
    const priorIds = [
      ...new Set(
        previousMembers
          .map((c) => c.groceryItemId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (!members.length && !priorIds.length) continue;
    const id = priorIds[0] ?? crypto.randomUUID();
    const existing = groceries.find((g) => g.id === id);
    const quantity = active[0]?.quantity
      ? {
          ...active[0].quantity,
          milli: active.reduce((sum, c) => sum + (c.quantity?.milli ?? 0), 0),
        }
      : null;
    const label = (members[0] ?? previousMembers[0])!.labelSnapshot;
    const text = quantity ? quantityLabel(quantity) : null;
    if (active.length || existing)
      groceryWrites.push({
        id,
        baseRevision: existing?.revision ?? 0,
        label,
        quantityText: text,
        deleted: !active.length,
      });
    for (const extra of priorIds.slice(1)) {
      const g = groceries.find((g) => g.id === extra);
      if (g)
        groceryWrites.push({
          id: extra,
          baseRevision: g.revision,
          label: g.label,
          quantityText: g.quantityText,
          deleted: true,
        });
    }
    for (const member of members)
      writes.set(member.originKey, {
        ...member,
        groceryItemId: active.length ? id : null,
        labelSnapshot: label,
        quantityTextSnapshot: text,
      });
  }
  if (writes.size || groceryWrites.length)
    await saveMaisonCommand([...writes.values()], groceryWrites);
}

export function canonicalShoppingQuantity(
  quantity: MaisonQuantity | null,
): MaisonQuantity | null {
  if (!quantity) return null;
  return (
    convertQuantity(
      quantity,
      quantity.unit === 'kg'
        ? 'g'
        : quantity.unit === 'l'
          ? 'ml'
          : quantity.unit,
    ) ?? quantity
  );
}
