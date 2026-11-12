import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dateRange, parseCsv, parseObservations, productStats, shiftDate } from '../src/lib/priceData.js';

test('CSV parser accepts quoted commas', () => {
  assert.deepEqual(parseCsv('date,product_name,price\n2026-01-01,"한우, 등심",7000\n'), [
    ['date', 'product_name', 'price'],
    ['2026-01-01', '한우, 등심', '7000'],
  ]);
});

test('legacy duplicate observations reduce to the daily lowest price', () => {
  const observations = parseObservations([
    'date,product_name,price',
    '2026-11-11,한우 등심 1++등급 구이용 (국내산) 100g,20950',
    '2026-11-11,한우 등심 1++등급 구이용 (국내산) 100g,9300',
  ].join('\n'));
  assert.equal(observations.length, 1);
  assert.equal(observations[0].price, 9300);
});

test('legacy grades remain separate products', () => {
  const observations = parseObservations([
    'date,product_name,price',
    '2026-11-11,한우 등심 1+등급 구이용 (국내산) 100g,15800',
    '2026-11-11,한우 등심 1++등급 구이용 (국내산) 100g,9300',
  ].join('\n'));
  assert.equal(observations.length, 2);
});

test('date range is stable and timezone-independent', () => {
  assert.deepEqual(dateRange('2026-11-11', 3), ['2026-11-09', '2026-11-10', '2026-11-11']);
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31');
});

test('price change uses the closest observation at least seven days old', () => {
  const product = { observations: [{ date: '2026-11-01', price: 1000 }, { date: '2026-11-08', price: 1200 }] };
  assert.equal(productStats(product, '2026-11-08').change, 200);
});

test('repository history is SKU-aware and has no duplicate daily observation', () => {
  const rows = parseCsv(fs.readFileSync(new URL('../history/prices.csv', import.meta.url), 'utf8'));
  const [header, ...data] = rows;
  assert.deepEqual(header, ['date', 'product_id', 'product_name', 'price']);
  const keys = new Set();
  for (const [date, productId, name, price] of data) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(productId);
    assert.ok(name);
    assert.match(price, /^[1-9]\d*$/);
    const key = `${date}\u0000${productId}`;
    assert.ok(!keys.has(key), `duplicate observation: ${key}`);
    keys.add(key);
  }
});
