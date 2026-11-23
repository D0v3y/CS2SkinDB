import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildEntry, matchesName, normalize, parseQuery, parseTerm, search, splitTerms } from '../assets/search.js';

const data = JSON.parse(await readFile(new URL('../data/skins.json', import.meta.url), 'utf8'));
const entries = data.skins.map((skin) => ({ skin, entry: buildEntry(skin, data) }));
const top = (q, n = 1) =>
  search(entries, q)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((r) => r.skin.name + (r.skin.phase ? ` (${r.skin.phase})` : ''));

test('normalize and parse', () => {
  assert.equal(normalize('★ M4A1-S | Hot Rod'), 'm4a1 s hot rod');
  assert.deepEqual(parseTerm('#44 karambit').paintIndexes, [44]);
  assert.deepEqual(parseTerm('#44 karambit').tokens, ['karambit']);
  assert.deepEqual(splitTerms(' redline, asiimov;; howl , '), ['redline', 'asiimov', 'howl']);
  assert.deepEqual(splitTerms('AK-47 | Redline, AWP | Asiimov'), ['AK-47 | Redline', 'AWP | Asiimov'], 'pasted names stay whole');
  assert.equal(parseQuery('redline, ★ ,').length, 1, 'empty terms are dropped');
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

test('short tokens do not match inside other words', () => {
  assert.deepEqual([...new Set(search(entries, 'ak redline').map((r) => r.skin.name))], ['AK-47 | Redline']);
  assert.ok(search(entries, '47').every((r) => r.skin.name.includes('47')));
});

const names = (q) => new Set(search(entries, q).map((r) => r.skin.name));

test('comma-separated terms find each of them', () => {
  const results = top('ak redline, awp asiimov', 3);
  assert.ok(results.includes('AK-47 | Redline'), results.join(' / '));
  assert.ok(results.includes('AWP | Asiimov'), results.join(' / '));

  const both = names('redline, howl');
  assert.ok(both.has('AK-47 | Redline') && both.has('M4A4 | Howl'));
  assert.equal(search(entries, 'redline, zzzz').length, search(entries, 'redline').length, 'a term with no matches adds nothing');
  assert.equal(search(entries, 'redline,').length, search(entries, 'redline').length, 'trailing separators are ignored');

  const mixed = search(entries, '#44, howl').map((r) => r.skin);
  assert.ok(mixed.some((s) => s.name === 'M4A4 | Howl'));
  assert.ok(mixed.filter((s) => s.name !== 'M4A4 | Howl').every((s) => s.paintIndex === 44));
});

test('name matching for collections and cases supports terms', () => {
  assert.ok(matchesName('The Fever Collection', 'fever'));
  assert.ok(matchesName('The Fever Collection', 'dust 2, fever'));
  assert.ok(!matchesName('The Fever Collection', 'dust 2, gallery'));
  assert.ok(matchesName('CS:GO Weapon Case 2', 'csgo case'));
});
