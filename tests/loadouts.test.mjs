import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as LO from '../assets/loadouts-store.js';

const data = JSON.parse(await readFile(new URL('../data/skins.json', import.meta.url), 'utf8'));
const index = LO.buildIndex(data);
const find = (name, phase = null) => data.skins.find((s) => s.name === name && (s.phase || null) === phase);
const key = (s) => LO.itemKey(s, data.weapons);

const redline = find('AK-47 | Redline');
const asiimov = find('AWP | Asiimov');
const howl = find('M4A4 | Howl');
const ruby = find('★ Karambit | Doppler', 'Ruby');

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('item keys are unique and resolve back to the skin', () => {
  assert.equal(index.byKey.size, data.skins.length);
  assert.equal(key(redline), '7-282');
  assert.equal(index.byKey.get(key(ruby)), ruby);
});

test('slots follow the game sides', () => {
  const ct = index.slots.ct.map((s) => s.slot);
  const t = index.slots.t.map((s) => s.slot);
  assert.deepEqual(ct.slice(0, 2), ['knife', 'gloves']);
  assert.ok(t.includes('ak-47') && !ct.includes('ak-47'));
  assert.ok(ct.includes('m4a4') && ct.includes('m4a1-s') && !t.includes('m4a4'));
  assert.ok(ct.includes('awp') && t.includes('awp'));
});

test('equipping respects sides and slots', () => {
  let lo = LO.createLoadout('Test');
  lo = LO.equipSkin(lo, redline, key(redline), ['ct', 't']);
  assert.deepEqual(lo.ct, {}, 'AK-47 cannot go on CT');
  assert.equal(lo.t['ak-47'], key(redline));

  lo = LO.equipSkin(lo, ruby, key(ruby), ['ct', 't']);
  assert.equal(lo.ct.knife, key(ruby));
  assert.equal(lo.t.knife, key(ruby));

  lo = LO.equipSkin(lo, asiimov, key(asiimov), ['ct']);
  lo = LO.copySide(lo, 'ct', 't', index);
  assert.equal(lo.t.awp, key(asiimov));
  assert.equal(lo.t['ak-47'], key(redline), 'T-only slots are untouched');

  lo = LO.setItem(lo, 't', 'ak-47', '');
  assert.equal(lo.t['ak-47'], undefined);
  assert.equal(LO.countItems(lo), 4);
});

test('share links round-trip and drop invalid items', () => {
  let lo = LO.createLoadout('Share me');
  lo = LO.equipSkin(lo, howl, key(howl), ['ct']);
  lo = LO.equipSkin(lo, ruby, key(ruby), ['ct', 't']);
  const code = LO.encodeShare(lo);
  assert.match(code, /^[0-9.\-_]+$/);
  const back = LO.decodeShare(code, 'Share me', index);
  assert.deepEqual(back.ct, lo.ct);
  assert.deepEqual(back.t, lo.t);
  assert.equal(back.name, 'Share me');

  // An AK on the CT side, an unknown item and junk are all ignored.
  const forged = LO.decodeShare(`${key(redline)}.999-999.<script>_${key(redline)}`, '', index);
  assert.deepEqual(forged.ct, {});
  assert.deepEqual(forged.t, { 'ak-47': key(redline) });
  assert.equal(forged.name, LO.DEFAULT_NAME);
});

test('storage round-trip and tolerance of bad data', () => {
  const storage = memoryStorage();
  const lo = LO.equipSkin(LO.createLoadout('  Saved   one '), redline, key(redline), ['t']);
  assert.equal(lo.name, 'Saved one');
  assert.ok(LO.writeStore(storage, [lo]));
  const { loadouts, ok } = LO.readStore(storage, index);
  assert.ok(ok);
  assert.deepEqual(loadouts, [lo]);

  storage.setItem(LO.STORAGE_KEY, '{not json');
  assert.deepEqual(LO.readStore(storage, index), { loadouts: [], ok: false });

  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(LO.readStore(throwing, index).ok, false);
  assert.equal(LO.writeStore(throwing, [lo]), false);
});

test('import accepts exports, arrays and single loadouts', () => {
  const a = LO.equipSkin(LO.createLoadout('A'), redline, key(redline), ['t']);
  const payload = LO.exportPayload([a], index);
  assert.equal(payload.format, LO.EXPORT_FORMAT);
  assert.deepEqual(payload.loadouts[0].items, ['T: AK-47 | Redline']);

  const again = LO.parseImport(JSON.stringify(payload), index, [a]);
  assert.equal(again.length, 1);
  assert.notEqual(again[0].id, a.id, 'colliding ids are replaced');
  assert.deepEqual(again[0].t, a.t);

  assert.equal(LO.parseImport(JSON.stringify(a), index).length, 1);
  assert.equal(LO.parseImport(JSON.stringify([a, a]), index).length, 2);
  assert.throws(() => LO.parseImport('nope', index), /not valid JSON/);
  assert.throws(() => LO.parseImport('[]', index), /No loadouts/);
});
