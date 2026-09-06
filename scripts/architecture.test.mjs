import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCycles, runtimeSpecifiers } from './architecture.mjs';

test('excludes type-only imports and re-exports but retains runtime loading', () => {
  assert.deepEqual(
    runtimeSpecifiers(`
    import type { A } from './types-a.js';
    import { type B } from './types-b.js';
    export type { C } from './types-c.js';
    export { type D } from './types-d.js';
    import './setup.js';
    import { type E, value } from './mixed.js';
    export * from './barrel.js';
    const lazy = import('./lazy.js');
    const common = require('./common.js');
  `),
    ['./setup.js', './mixed.js', './barrel.js', './lazy.js', './common.js'],
  );
});

test('finds a runtime loop including a dynamic import', () => {
  const graph = new Map([
    ['a', runtimeSpecifiers("import('b')")],
    ['b', runtimeSpecifiers("export * from 'c'")],
    ['c', runtimeSpecifiers("import 'a'")],
  ]);
  assert.deepEqual(findCycles(graph), [['a', 'b', 'c', 'a']]);
});

test('accepts shared dependencies and ignores a reciprocal type-only link', () => {
  const graph = new Map([
    ['a', runtimeSpecifiers("import 'b'; import 'c'")],
    ['b', runtimeSpecifiers("import type { A } from 'a'; import 'c'")],
    ['c', []],
  ]);
  assert.deepEqual(findCycles(graph), []);
});
