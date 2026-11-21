import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildEntry, normalize, parseQuery, search } from '../assets/search.js';

const data = JSON.parse(await readFile(new URL('../data/skins.json', import.meta.url), 'utf8'));
const entries = data.skins.map((skin) => ({ skin, entry: buildEntry(skin, data) }));
const top = (q, n = 1) =>
  search(entries, q)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((r) => r.skin.name + (r.skin.phase ? ` (${r.skin.phase})` : ''));

test('normalize and parse', () => {
  assert.equal(normalize('★ M4A1-S | Hot Rod'), 'm4a1 s hot rod');
  assert.deepEqual(parseQuery('#44 karambit').paintIndexes, [44]);
  assert.deepEqual(parseQuery('#44 karambit').tokens, ['karambit']);
});

test('exact names rank first', () => {
  assert.deepEqual(top('AK-47 | Redline'), ['AK-47 | Redline']);
  assert.deepEqual(top('awp dragon lore'), ['AWP | Dragon Lore']);
});

test('punctuation and spacing are optional', () => {
  assert.deepEqual(top('ak47 redline'), ['AK-47 | Redline']);
  assert.deepEqual(top('m4a1s hot rod'), ['M4A1-S | Hot Rod']);
});

test('nicknames resolve to weapons', () => {
  assert.ok(top('deagle blaze')[0].startsWith('Desert Eagle | Blaze'));
  assert.ok(top('bfk fade')[0].startsWith('★ Butterfly Knife | Fade'));
});

test('phases, collections and paint indexes are searchable', () => {
  assert.ok(top('karambit doppler ruby')[0].includes('(Ruby)'));
  const huntsman = search(entries, 'huntsman collection').map((r) => r.skin);
  assert.ok(huntsman.some((s) => s.name === 'Tec-9 | Isaac'));
  const ch = search(entries, '#44').map((r) => r.skin);
  assert.ok(ch.length > 0 && ch.every((s) => s.paintIndex === 44));
});

test('every token has to match', () => {
  assert.equal(search(entries, 'redline zzzz').length, 0);
});
