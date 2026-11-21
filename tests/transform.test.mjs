import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform, splitDescription, wearsForRange, normalizeDate, slugify } from '../scripts/lib/transform.mjs';

const crate = (id, name, type, date, extra = {}) => ({ id, name, type, first_sale_date: date, market_hash_name: name, rental: false, image: 'https://example.com/c.png', ...extra });
const rarity = { id: 'rarity_ancient_weapon', name: 'Covert', color: '#eb4b4b' };

const fixture = {
  crates: [
    crate('crate-1', 'Test Case', 'Case', '2020/01/02'),
    crate('crate-2', 'Austin 2025 Test Souvenir Package', 'Souvenir', null),
    crate('crate-4', 'Old Souvenir Package', 'Souvenir', '2021-05-06'),
    crate('crate-3', 'Sealed Test Terminal', null, null),
  ],
  collections: [
    { id: 'collection-set-a', name: 'The A Collection', release_date: '2020-01-01', crates: [{ id: 'crate-1' }], image: 'https://example.com/a.png' },
    { id: 'collection-set-t', name: 'The T Collection', release_date: '2026-03-11', crates: [{ id: 'crate-3' }], image: null },
    { id: 'collection-set-m', name: 'The Map Collection', release_date: '2014-01-01', crates: [{ id: 'crate-2' }], image: null },
  ],
  skins: [
    {
      id: 'skin-1',
      name: 'AK-47 | Test',
      description: 'A rifle.\\n\\n<i>Flavor text</i>',
      weapon: { id: 'weapon_ak47', weapon_id: 7, name: 'AK-47' },
      category: { id: 'x', name: 'Rifles' },
      pattern: { id: 'cu_test', name: 'Test' },
      min_float: 0.1,
      max_float: 0.4,
      rarity,
      stattrak: true,
      souvenir: true, // wrong upstream on purpose: no souvenir package
      paint_index: '123',
      collections: [{ id: 'collection-set-a' }],
      crates: [{ id: 'crate-1' }],
      team: { id: 'terrorists' },
      legacy_model: false,
      image: 'https://example.com/s.png',
      market_hash_name: 'should not be copied',
    },
    {
      id: 'skin-2',
      name: '★ Karambit',
      description: null,
      weapon: { id: 'weapon_knife_karambit', weapon_id: 507, name: 'Karambit' },
      category: { id: 'y', name: 'Knives' },
      pattern: null,
      min_float: null,
      max_float: null,
      rarity,
      stattrak: true,
      paint_index: null,
      crates: [{ id: 'crate-3' }],
      team: { id: 'both' },
      legacy_model: false,
      image: null,
    },
    {
      id: 'skin-3',
      name: 'AWP | Souvenir Thing',
      description: 'Plain',
      weapon: { id: 'weapon_awp', weapon_id: 9, name: 'AWP' },
      category: { id: 'x', name: 'Rifles' },
      pattern: { id: 'sp_x', name: 'Souvenir Thing' },
      min_float: 0,
      max_float: 0.08,
      rarity: { id: 'rarity_rare_weapon', name: 'Mil-Spec Grade', color: '#4b69ff' },
      stattrak: false,
      souvenir: false,
      paint_index: '9',
      collections: [],
      crates: [{ id: 'crate-2' }, { id: 'crate-4' }],
      team: { id: 'counter-terrorists' },
      legacy_model: true,
      image: 'https://example.com/a.png',
    },
  ],
};

test('helpers', () => {
  assert.equal(normalizeDate('2019/10/2'), '2019-10-02');
  assert.equal(normalizeDate(null), null);
  assert.equal(slugify('M4A1-S'), 'm4a1-s');
  assert.deepEqual(wearsForRange(0, 0.08), ['FN', 'MW']);
  assert.deepEqual(wearsForRange(0.06, 0.8), ['FN', 'MW', 'FT', 'WW', 'BS']);
  assert.deepEqual(wearsForRange(0.45, 1), ['BS']);
  assert.deepEqual(wearsForRange(null, null), []);
  assert.deepEqual(splitDescription('Body.\\n\\n<i>Quote</i>'), { description: 'Body.', flavor: 'Quote' });
  assert.deepEqual(splitDescription('<b>Bold</b> text'), { description: 'Bold text', flavor: null });
});

test('transform normalizes skins and strips market data', () => {
  const out = transform(fixture, { generatedAt: 'now' });
  assert.equal(out.counts.skins, 3);
  assert.ok(!JSON.stringify(out).includes('market_hash_name'));
  assert.ok(!JSON.stringify(out).includes('should not be copied'));

  const ak = out.skins.find((s) => s.id === '1');
  assert.equal(ak.weapon, 'ak-47');
  assert.equal(ak.paintIndex, 123);
  assert.equal(ak.souvenir, false, 'souvenir is derived from souvenir packages');
  assert.equal(ak.team, 't');
  assert.equal(ak.released, '2020-01-01');
  assert.deepEqual(ak.wears, ['MW', 'FT', 'WW']);
  assert.equal(ak.flavor, 'Flavor text');
  assert.deepEqual(ak.collections, ['set-a']);
  assert.deepEqual(ak.crates, ['1']);

  const knife = out.skins.find((s) => s.id === '2');
  assert.equal(knife.finish, null);
  assert.deepEqual(knife.wears, []);
  assert.equal(knife.released, '2026-03-11', 'terminal date falls back to its collection');
  assert.equal(out.crates['3'].type, 'Terminal');

  const awp = out.skins.find((s) => s.id === '3');
  assert.equal(awp.souvenir, true);
  assert.equal(awp.team, 'ct');
  assert.equal(awp.legacyModel, true);
  assert.equal(awp.released, '2021-05-06');
  assert.equal(out.crates['2'].firstSaleDate, null, 'souvenir packages do not inherit the map collection date');
  assert.equal(out.crates['2'].year, '2025', 'souvenir year comes from the event name');

  assert.deepEqual(Object.keys(out.rarities), ['milspec', 'covert']);
  assert.deepEqual(out.collections['set-a'].skins, ['1']);
});

test('committed dataset is well formed', async () => {
  const data = JSON.parse(await readFile(new URL('../data/skins.json', import.meta.url), 'utf8'));
  assert.ok(data.skins.length > 2000, 'has the full skin list');
  const ids = new Set();
  for (const s of data.skins) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    assert.ok(data.weapons[s.weapon], `unknown weapon ${s.weapon}`);
    assert.ok(data.rarities[s.rarity], `unknown rarity ${s.rarity}`);
    for (const c of s.collections) assert.ok(data.collections[c], `unknown collection ${c}`);
    for (const c of s.crates) assert.ok(data.crates[c], `unknown crate ${c}`);
  }
  // No market-related fields anywhere (free text such as "price tag" in a game description is fine).
  const keys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) keys.add(k.toLowerCase()), walk(x);
  };
  walk(data);
  for (const k of keys) assert.ok(!/market|price|listing|volume|rental/.test(k), `market-related field ${k}`);
  assert.ok(!JSON.stringify(data).includes('steamcommunity.com/market'), 'links to the Steam market');
});
