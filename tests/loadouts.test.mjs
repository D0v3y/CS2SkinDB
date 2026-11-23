import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as LO from '../assets/loadouts-store.js';

const data = JSON.parse(await readFile(new URL('../data/skins.json', import.meta.url), 'utf8'));
const index = LO.buildIndex(data);
const find = (name, phase = null) => data.skins.find((s) => s.name === name && (s.phase || null) === phase);
const key = (s) => LO.itemKey(s, data.weapons);
const equip = (lo, s, team) => LO.equipSkin(lo, s, key(s), team, index);

const redline = find('AK-47 | Redline');
const asiimov = find('AWP | Asiimov');
const howl = find('M4A4 | Howl');
const ruby = find('★ Karambit | Doppler', 'Ruby');
const killConfirmed = find('USP-S | Kill Confirmed');
const fireElemental = find('P2000 | Fire Elemental');
const glockFade = find('Glock-18 | Fade');
const zeusSkin = data.skins.find((s) => s.weapon === 'zeus-x27');

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('item keys are unique and resolve back to the skin', () => {
  assert.equal(index.byKey.size, data.skins.length);
  assert.equal(key(redline), '7-282');
  assert.equal(index.byKey.get(key(ruby)), ruby);
});

test('columns and starter pistols follow the game rules', () => {
  assert.deepEqual(index.starters, { ct: ['usp-s', 'p2000'], t: ['glock-18'] });
  assert.deepEqual(LO.allowedWeapons(index, 'ct', 'pistols', 0), ['usp-s', 'p2000']);
  assert.deepEqual(LO.allowedWeapons(index, 't', 'pistols', 0), ['glock-18']);
  const ctPistols = LO.allowedWeapons(index, 'ct', 'pistols', 1);
  assert.ok(!ctPistols.includes('usp-s') && !ctPistols.includes('p2000'), 'starters only go in slot 1');
  assert.ok(ctPistols.includes('five-seven') && !ctPistols.includes('tec-9'));
  assert.ok(LO.allowedWeapons(index, 't', 'mid', 0).includes('mac-10'));
  assert.ok(!LO.allowedWeapons(index, 'ct', 'mid', 0).includes('mac-10'));
  assert.ok(LO.allowedWeapons(index, 'ct', 'mid', 2).includes('nova'), 'heavy weapons share the SMG column');
  assert.ok(LO.allowedWeapons(index, 't', 'rifles', 4).includes('ak-47'));
  assert.ok(!LO.allowedWeapons(index, 't', 'rifles', 4).includes('m4a4'));
});

test('slots: set, swap, clear and reject invalid weapons', () => {
  let lo = LO.createLoadout('Test');
  assert.deepEqual(lo.ct.pistols, [null, null, null, null, null], 'new loadouts start empty');
  lo = LO.setSlot(lo, 't', 'rifles', 0, 'ak-47', key(redline), index);
  lo = LO.setSlot(lo, 't', 'rifles', 1, 'awp', '', index);
  assert.deepEqual(lo.t.rifles.slice(0, 2), [{ weapon: 'ak-47', skin: key(redline) }, { weapon: 'awp', skin: '' }]);

  // Picking a weapon that is already in another slot swaps the two.
  lo = LO.setSlot(lo, 't', 'rifles', 1, 'ak-47', key(redline), index);
  assert.deepEqual(lo.t.rifles.slice(0, 2), [{ weapon: 'awp', skin: '' }, { weapon: 'ak-47', skin: key(redline) }]);

  assert.equal(LO.setSlot(lo, 'ct', 'rifles', 0, 'ak-47', '', index), lo, 'AK-47 is not a CT weapon');
  assert.equal(LO.setSlot(lo, 'ct', 'pistols', 2, 'usp-s', '', index), lo, 'starter outside slot 1');
  assert.equal(LO.setSlot(lo, 'ct', 'pistols', 0, 'desert-eagle', '', index), lo, 'non-starter in slot 1');
  assert.deepEqual(LO.setSlot(lo, 't', 'rifles', 2, 'awp', key(redline), index).t.rifles[2], { weapon: 'awp', skin: '' }, 'a skin for another weapon falls back to default');

  lo = LO.setSlot(lo, 't', 'rifles', 1, null, '', index);
  assert.equal(lo.t.rifles[1], null);
});

test('equipping skins places weapons like a player would', () => {
  let lo = LO.createLoadout('Equip');
  ({ loadout: lo } = equip(lo, ruby, 'ct'));
  assert.equal(lo.ct.knife, key(ruby));

  ({ loadout: lo } = equip(lo, zeusSkin, 't'));
  assert.equal(lo.t.zeus, key(zeusSkin));

  let res = equip(lo, killConfirmed, 'ct');
  assert.equal(res.result, 'equipped');
  lo = res.loadout;
  assert.deepEqual(lo.ct.pistols[0], { weapon: 'usp-s', skin: key(killConfirmed) });

  res = equip(lo, fireElemental, 'ct');
  assert.equal(res.result, 'replaced-starter');
  assert.equal(res.replaced, 'usp-s');
  lo = res.loadout;
  assert.equal(lo.ct.pistols[0].weapon, 'p2000');

  assert.equal(equip(lo, redline, 'ct').result, 'unavailable');
  ({ loadout: lo } = equip(lo, asiimov, 'ct'));
  assert.deepEqual(lo.ct.rifles[0], { weapon: 'awp', skin: key(asiimov) });
  assert.ok(LO.isEquipped(lo, 'ct', asiimov, key(asiimov)));

  lo = LO.unequipSkin(lo, asiimov, key(asiimov), 'ct', index);
  assert.deepEqual(lo.ct.rifles[0], { weapon: 'awp', skin: '' }, 'unequipping keeps the weapon');

  // A full column refuses new weapons.
  for (const [i, w] of ['famas', 'm4a4', 'm4a1-s', 'aug'].entries()) lo = LO.setSlot(lo, 'ct', 'rifles', i + 1, w, '', index);
  assert.equal(equip(lo, find('SCAR-20 | Cyrex'), 'ct').result, 'full');
  ({ loadout: lo } = equip(lo, howl, 'ct'));
  assert.equal(lo.ct.rifles[2].skin, key(howl), 'a weapon already in the loadout gets the skin');
  assert.deepEqual(LO.sideStats(lo.ct), { weapons: 6, skins: 3 });
});

test('copying shared slots respects sides', () => {
  let lo = LO.createLoadout('Copy');
  ({ loadout: lo } = equip(lo, ruby, 'ct'));
  ({ loadout: lo } = equip(lo, asiimov, 'ct'));
  ({ loadout: lo } = equip(lo, howl, 'ct'));
  ({ loadout: lo } = equip(lo, killConfirmed, 'ct'));
  const { loadout: out } = LO.copyShared(lo, 'ct', 't', index);
  assert.equal(out.t.knife, key(ruby));
  assert.ok(LO.isEquipped(out, 't', asiimov, key(asiimov)));
  assert.equal(LO.findWeapon(out.t, 'm4a4'), null, 'CT-only weapons are not copied');
  assert.equal(out.t.pistols[0], null, 'starter pistols are side-specific');
});

test('share links round-trip and reject invalid data', () => {
  let lo = LO.createLoadout('Share me');
  ({ loadout: lo } = equip(lo, ruby, 'ct'));
  ({ loadout: lo } = equip(lo, killConfirmed, 'ct'));
  lo = LO.setSlot(lo, 'ct', 'mid', 3, 'mp9', '', index);
  ({ loadout: lo } = equip(lo, glockFade, 't'));
  ({ loadout: lo } = equip(lo, redline, 't'));
  const code = LO.encodeShare(lo, index);
  assert.match(code, /^2\.[0-9._-]*$/);
  const back = LO.decodeShare(code, 'Share me', index);
  assert.deepEqual(back.ct, lo.ct);
  assert.deepEqual(back.t, lo.t);
  assert.equal(back.name, 'Share me');

  const empty = LO.decodeShare(LO.encodeShare(LO.createLoadout(), index), '', index);
  assert.deepEqual(empty.ct, LO.emptySide());
  assert.equal(empty.name, LO.DEFAULT_NAME);

  // AK on CT, a starter in slot 2 and junk tokens are dropped.
  const forged = LO.decodeShare(`2...._${'.'.repeat(3)}7-282.61.<x>`, '', index);
  assert.deepEqual(forged.ct, LO.emptySide());
  assert.equal(forged.t.pistols[0], null);
  assert.equal(forged.t.pistols[1], null);
});

test('loadouts and links from the first version are converted', () => {
  const old = {
    id: 'oldloadout1',
    name: 'Old',
    createdAt: 1,
    updatedAt: 2,
    ct: { knife: key(ruby), awp: key(asiimov), 'usp-s': key(killConfirmed), m4a4: key(howl) },
    t: { 'ak-47': key(redline) },
  };
  const lo = LO.sanitize(old, index);
  assert.equal(lo.ct.knife, key(ruby));
  assert.deepEqual(lo.ct.pistols[0], { weapon: 'usp-s', skin: key(killConfirmed) });
  assert.ok(LO.isEquipped(lo, 'ct', howl, key(howl)) && LO.isEquipped(lo, 'ct', asiimov, key(asiimov)));
  assert.ok(LO.isEquipped(lo, 't', redline, key(redline)));

  const v1link = LO.decodeShare(`${key(ruby)}.${key(asiimov)}_${key(redline)}.${key(ruby)}`, 'Old link', index);
  assert.equal(v1link.ct.knife, key(ruby));
  assert.equal(v1link.t.knife, key(ruby));
  assert.ok(LO.isEquipped(v1link, 't', redline, key(redline)));
});

test('storage round-trip and tolerance of bad data', () => {
  const storage = memoryStorage();
  const lo = equip(LO.createLoadout('  Saved   one '), redline, 't').loadout;
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
  let a = equip(LO.createLoadout('A'), redline, 't').loadout;
  a = LO.setSlot(a, 't', 'rifles', 1, 'awp', '', index);
  const payload = LO.exportPayload([a], index);
  assert.equal(payload.format, LO.EXPORT_FORMAT);
  assert.deepEqual(payload.loadouts[0].items, ['T Rifles 1: AK-47 | Redline', 'T Rifles 2: AWP (default)']);

  const again = LO.parseImport(JSON.stringify(payload), index, [a]);
  assert.equal(again.length, 1);
  assert.notEqual(again[0].id, a.id, 'colliding ids are replaced');
  assert.deepEqual(again[0].t, a.t);

  assert.equal(LO.parseImport(JSON.stringify(a), index).length, 1);
  assert.equal(LO.parseImport(JSON.stringify([a, a]), index).length, 2);
  assert.throws(() => LO.parseImport('nope', index), /not valid JSON/);
  assert.throws(() => LO.parseImport('[]', index), /No loadouts/);
});
