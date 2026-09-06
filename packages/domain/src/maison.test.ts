import { describe, expect, it } from 'vitest';
import { fixtures, fields } from '../../../tests/fixtures/maison.js';
import {
  parseMilli,
  scaleMilli,
  convertQuantity,
  ingredientNeeds,
  shoppingNeeds,
  validateMaisonState,
  needsRestock,
  latestRecipes,
  restockSuggestions,
} from './maison.js';

describe('Maison quantities and preparation accounting', () => {
  it('suggests restocking once per product and accounts for newer purchase lots', () => {
    const { product, stock } = fixtures();
    stock.status = 'empty';
    stock.quantity = { milli: 0, unit: 'g' };
    stock.threshold = { milli: 100000, unit: 'g' };
    const another = { ...stock, ...fields() };
    expect(restockSuggestions([product, stock, another])).toHaveLength(1);
    another.status = 'present';
    another.quantity = { milli: 500000, unit: 'g' };
    expect(restockSuggestions([product, stock, another])).toHaveLength(0);
  });
  it('rejects contradictory unit correspondences', () => {
    const { product } = fixtures();
    product.conversions = [{ from: 'kg', to: 'g', factorMilli: 500 }];
    expect(() => validateMaisonState([product])).toThrow(/contredit/u);
    product.conversions = [
      { from: 'pack', to: 'piece', factorMilli: 6000 },
      { from: 'piece', to: 'pack', factorMilli: 1000 },
    ];
    expect(() => validateMaisonState([product])).toThrow(/dupliquée/u);
  });
  it('rejects invented leftovers and leaves insufficient portions visible', () => {
    const { records, prep, stock, meal } = fixtures();
    prep.status = 'prepared';
    prep.actualPortionsMilli = 6000;
    stock.productId = null;
    stock.preparationId = prep.id;
    stock.quantity = { milli: 6000, unit: 'portion' };
    meal.status = 'eaten';
    expect(() => validateMaisonState(records)).toThrow(/réellement/u);
    stock.quantity.milli = 2000;
    expect(() => validateMaisonState(records)).toThrow(/restes/u);
    stock.quantity.milli = 3000;
    expect(() => validateMaisonState(records)).not.toThrow();
  });
  it('uses fixed decimals and only compatible or explicitly declared conversions', () => {
    expect(parseMilli('1,025')).toBe(1025);
    expect(() => parseMilli('1.0001')).toThrow();
    expect(() => parseMilli('-1')).toThrow();
    expect(scaleMilli(1000, 3, 2)).toBe(1500);
    expect(convertQuantity({ milli: 500, unit: 'kg' }, 'g')).toEqual({
      milli: 500000,
      unit: 'g',
    });
    expect(convertQuantity({ milli: 1000, unit: 'g' }, 'ml')).toBeNull();
    const { product } = fixtures();
    product.conversions = [{ from: 'pack', to: 'piece', factorMilli: 12000 }];
    expect(
      convertQuantity({ milli: 2000, unit: 'pack' }, 'piece', product)?.milli,
    ).toBe(24000);
  });
  it('counts six portions eaten over two days as a single preparation and reuses its origin across periods', () => {
    const { records } = fixtures();
    const both = shoppingNeeds(
      records,
      '2026-09-07',
      '2026-09-08',
      ['dinner'],
      '2026-09-05',
    );
    expect(both).toHaveLength(1);
    expect(both[0]).toMatchObject({
      quantity: { milli: 600000 },
      reserved: 500000,
      missing: { milli: 100000 },
    });
    expect(
      shoppingNeeds(
        records,
        '2026-09-08',
        '2026-09-09',
        ['dinner'],
        '2026-09-05',
      )[0]?.originKey,
    ).toBe(both[0]?.originKey);
  });
  it('allocates stock to earlier preparations even outside the selected shopping period', () => {
    const { records, prep } = fixtures();
    records.push({
      ...prep,
      ...fields(),
      date: '2026-09-06',
      portionsMilli: 3000,
    });
    const need = shoppingNeeds(
      records,
      '2026-09-07',
      '2026-09-08',
      ['dinner'],
      '2026-09-05',
    )[0];
    expect(need).toMatchObject({
      reserved: 200000,
      missing: { milli: 400000 },
    });
  });
  it('prefers earlier expiry and excludes qualitative, uncertain and expired stocks', () => {
    const { records, stock } = fixtures();
    stock.expiresOn = '2026-09-04';
    records.push(
      { ...stock, ...fields(), expiresOn: null, quantity: null },
      { ...stock, ...fields(), expiresOn: null, status: 'check' },
    );
    expect(ingredientNeeds(records, '2026-09-05')[0]?.reserved).toBe(0);
    const fresh = {
      ...stock,
      ...fields(),
      expiresOn: '2026-09-06',
      quantity: { milli: 100000, unit: 'g' as const },
    };
    records.push(fresh);
    expect(
      ingredientNeeds(records, '2026-09-05')[0]?.allocations[0]?.stockId,
    ).toBe(fresh.id);
  });
  it('keeps unquantified ingredients unknown', () => {
    const { records, recipe } = fixtures();
    recipe.ingredients[0]!.quantity = null;
    expect(ingredientNeeds(records, '2026-09-05')[0]).toMatchObject({
      quantity: null,
      missing: null,
      reserved: 0,
    });
  });
  it('rejects oversubscribed portions, duplicate slots and a meal before cooking', () => {
    const { records, meal } = fixtures();
    expect(() => validateMaisonState(records)).not.toThrow();
    meal.servings[0]!.portionsMilli = 4000;
    expect(() => validateMaisonState(records)).toThrow(/portions/iu);
    meal.servings[0]!.portionsMilli = 3000;
    meal.date = '2026-09-06';
    expect(() => validateMaisonState(records)).toThrow(/précède/iu);
    meal.date = '2026-09-07';
    records.push({ ...meal, ...fields() });
    expect(() => validateMaisonState(records)).toThrow(/existe/iu);
  });
  it('does not count outside or cancelled meals against portions', () => {
    const { records, meal2 } = fixtures();
    meal2.status = 'outside';
    meal2.servings = [];
    expect(() => validateMaisonState(records)).not.toThrow();
  });
  it('new recipe versions do not alter planned ingredients', () => {
    const { records, recipe } = fixtures();
    records.push({ ...recipe, ...fields(), version: 2, ingredients: [] });
    expect(latestRecipes(records)[0]?.version).toBe(2);
    expect(ingredientNeeds(records, '2026-09-05')[0]?.quantity?.milli).toBe(
      600000,
    );
  });
  it('restock is a suggestion from a threshold or low state', () => {
    const { stock } = fixtures();
    expect(needsRestock(stock)).toBe(false);
    stock.status = 'low';
    expect(needsRestock(stock)).toBe(true);
    stock.status = 'check';
    expect(needsRestock(stock)).toBe(false);
  });
});
