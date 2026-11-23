// Loadouts: data model, rules, persistence and share-link encoding.
// No DOM access here, so the module is shared with the Node tests.
//
// A loadout mirrors the in-game one. Each side (CT / T) has:
//   - knife, gloves, zeus: an equipped skin key, or "" for the default item
//   - three columns of 5 slots (pistols, mid, rifles). A slot is null (empty)
//     or { weapon, skin }, where skin is a skin key or "" for the default finish.
// Pistol slot 1 only takes the side's starter pistol (USP-S or P2000 on CT,
// Glock-18 on T) and starter pistols can't go anywhere else. A weapon appears
// at most once per side.
//
// Skins are stored by the game's own identity, "<weapon def index>-<paint index>",
// so saved loadouts survive data rebuilds.

export const STORAGE_KEY = 'cs2db-loadouts';
export const EXPORT_FORMAT = 'cs2skindb-loadouts';
export const VERSION = 2;
export const TEAMS = ['ct', 't'];
export const MAX_NAME = 60;
export const DEFAULT_NAME = 'Untitled loadout';
export const SLOTS = 5;
export const COLUMNS = [
  { key: 'pistols', label: 'Pistols', categories: ['Pistols'] },
  { key: 'mid', label: 'SMGs & heavy', categories: ['SMGs', 'Heavy'] },
  { key: 'rifles', label: 'Rifles', categories: ['Rifles'] },
];
export const TOTAL_SLOTS = COLUMNS.length * SLOTS;
export const SPECIALS = [
  { key: 'knife', label: 'Knife', category: 'Knives' },
  { key: 'gloves', label: 'Gloves', category: 'Gloves' },
  { key: 'zeus', label: 'Zeus x27', category: 'Equipment' },
];
export const STARTERS = { ct: ['usp-s', 'p2000'], t: ['glock-18'] };
const STARTER_SET = new Set(Object.values(STARTERS).flat());

export function itemKey(skin, weapons) {
  const def = weapons[skin.weapon]?.defIndex ?? 0;
  return `${def}-${skin.paintIndex ?? 0}`;
}

export const teamsOf = (skin) => (skin.team === 'both' ? [...TEAMS] : [skin.team]);
export const columnOf = (category) => COLUMNS.find((c) => c.categories.includes(category))?.key || null;
export const specialOf = (category) => SPECIALS.find((s) => s.category === category)?.key || null;

// Lookup tables and the weapons each side can use per column.
export function buildIndex(data) {
  const byKey = new Map();
  const byDef = new Map();
  const weaponTeam = {};
  for (const s of data.skins) {
    byKey.set(itemKey(s, data.weapons), s);
    if (!weaponTeam[s.weapon]) weaponTeam[s.weapon] = s.team;
  }
  for (const [k, w] of Object.entries(data.weapons)) if (w.defIndex != null) byDef.set(String(w.defIndex), k);
  const available = (w, team) => weaponTeam[w] === 'both' || weaponTeam[w] === team;
  const order = data.categories;
  const columns = {};
  const starters = {};
  for (const team of TEAMS) {
    columns[team] = {};
    for (const col of COLUMNS) {
      columns[team][col.key] = Object.entries(data.weapons)
        .filter(([k, w]) => col.categories.includes(w.category) && available(k, team))
        .sort(([, a], [, b]) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name, 'en'))
        .map(([k]) => k);
    }
    starters[team] = STARTERS[team].filter((w) => data.weapons[w] && available(w, team));
  }
  return { byKey, byDef, weaponTeam, columns, starters, weapons: data.weapons };
}

// Weapons allowed in one slot.
export function allowedWeapons(index, team, column, slot) {
  if (column === 'pistols' && slot === 0) return index.starters[team];
  const all = index.columns[team][column] || [];
  return column === 'pistols' ? all.filter((w) => !STARTER_SET.has(w)) : all;
}

const skinFits = (index, key, weapon, team) => {
  const s = index.byKey.get(key);
  return Boolean(s && s.weapon === weapon && teamsOf(s).includes(team));
};

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function cleanName(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return s || DEFAULT_NAME;
}

export function emptySide() {
  const side = { knife: '', gloves: '', zeus: '' };
  for (const c of COLUMNS) side[c.key] = Array(SLOTS).fill(null);
  return side;
}

export function createLoadout(name = DEFAULT_NAME, now = Date.now()) {
  return { id: newId(), name: cleanName(name), createdAt: now, updatedAt: now, ct: emptySide(), t: emptySide() };
}

function cloneSide(side) {
  const out = { ...side };
  for (const c of COLUMNS) out[c.key] = side[c.key].map((s) => (s ? { ...s } : null));
  return out;
}

const withSide = (lo, team, side, now) => ({ ...lo, [team]: side, updatedAt: now });

export function findWeapon(side, weapon) {
  for (const { key } of COLUMNS) {
    const i = side[key].findIndex((s) => s && s.weapon === weapon);
    if (i !== -1) return { column: key, index: i };
  }
  return null;
}

// Puts a weapon (with an optional skin) in a slot, or empties it when weapon
// is falsy. If the weapon already sits in another slot of the column, the two
// slots swap. Invalid weapons leave the loadout unchanged; invalid skins fall
// back to the default finish.
export function setSlot(lo, team, column, slot, weapon, skin, index, now = Date.now()) {
  if (!COLUMNS.some((c) => c.key === column) || !(slot >= 0 && slot < SLOTS)) return lo;
  const side = cloneSide(lo[team]);
  const col = side[column];
  if (!weapon) {
    col[slot] = null;
    return withSide(lo, team, side, now);
  }
  if (!allowedWeapons(index, team, column, slot).includes(weapon)) return lo;
  const existing = col.findIndex((s, i) => i !== slot && s && s.weapon === weapon);
  if (existing !== -1) col[existing] = col[slot];
  col[slot] = { weapon, skin: skin && skinFits(index, skin, weapon, team) ? skin : '' };
  return withSide(lo, team, side, now);
}

export function setSpecial(lo, team, special, key, index, now = Date.now()) {
  const def = SPECIALS.find((s) => s.key === special);
  if (!def) return lo;
  if (key) {
    const s = index.byKey.get(key);
    if (!s || s.category !== def.category || !teamsOf(s).includes(team)) return lo;
  }
  const side = cloneSide(lo[team]);
  side[special] = key || '';
  return withSide(lo, team, side, now);
}

// Adds a weapon the way a player would: reuse its slot if it's already in the
// loadout, take pistol slot 1 for a starter, otherwise the first free slot of
// its column. result: 'equipped' | 'replaced-starter' | 'full' | 'unavailable'.
export function placeWeapon(lo, team, weapon, skin, index, now = Date.now()) {
  const w = index.weapons[weapon];
  const column = w && columnOf(w.category);
  if (!column || !index.columns[team][column].includes(weapon)) return { loadout: lo, result: 'unavailable' };
  const at = findWeapon(lo[team], weapon);
  if (at) return { loadout: setSlot(lo, team, at.column, at.index, weapon, skin, index, now), result: 'equipped', column: at.column, slot: at.index };
  if (index.starters[team].includes(weapon)) {
    const replaced = lo[team].pistols[0]?.weapon || null;
    return { loadout: setSlot(lo, team, 'pistols', 0, weapon, skin, index, now), result: replaced ? 'replaced-starter' : 'equipped', replaced, column: 'pistols', slot: 0 };
  }
  const free = firstFreeSlot(lo[team], column);
  if (free === -1) return { loadout: lo, result: 'full', column };
  return { loadout: setSlot(lo, team, column, free, weapon, skin, index, now), result: 'equipped', column, slot: free };
}

export function firstFreeSlot(side, column) {
  return side[column].findIndex((s, i) => !s && !(column === 'pistols' && i === 0));
}

export function equipSkin(lo, skin, key, team, index, now = Date.now()) {
  if (!teamsOf(skin).includes(team)) return { loadout: lo, result: 'unavailable' };
  const special = specialOf(skin.category);
  if (special) return { loadout: setSpecial(lo, team, special, key, index, now), result: 'equipped', special };
  return placeWeapon(lo, team, skin.weapon, key, index, now);
}

// Back to the default finish; the weapon stays in its slot.
export function unequipSkin(lo, skin, key, team, index, now = Date.now()) {
  const special = specialOf(skin.category);
  if (special) return lo[team][special] === key ? setSpecial(lo, team, special, '', index, now) : lo;
  const at = findWeapon(lo[team], skin.weapon);
  if (!at || lo[team][at.column][at.index].skin !== key) return lo;
  return setSlot(lo, team, at.column, at.index, skin.weapon, '', index, now);
}

export function isEquipped(lo, team, skin, key) {
  const special = specialOf(skin.category);
  if (special) return lo[team][special] === key;
  const at = findWeapon(lo[team], skin.weapon);
  return Boolean(at && lo[team][at.column][at.index].skin === key);
}

export function sideStats(side) {
  const slots = COLUMNS.flatMap((c) => side[c.key]).filter(Boolean);
  return { weapons: slots.length, skins: slots.filter((s) => s.skin).length + SPECIALS.filter((s) => side[s.key]).length };
}

// Copies knife, gloves and Zeus, and the weapons both sides can use (with
// their skins) into free or matching slots on the other side.
export function copyShared(lo, from, to, index, now = Date.now()) {
  let out = lo;
  for (const sp of SPECIALS) out = setSpecial(out, to, sp.key, lo[from][sp.key], index, now);
  let skipped = 0;
  for (const col of COLUMNS) {
    for (const slot of lo[from][col.key]) {
      if (!slot || !index.columns[to][col.key].includes(slot.weapon)) continue;
      const res = placeWeapon(out, to, slot.weapon, slot.skin, index, now);
      if (res.result === 'full') skipped++;
      out = res.loadout;
    }
  }
  return { loadout: { ...out, updatedAt: now }, skipped };
}

// Validates anything that claims to be a loadout (storage, imports, links).
// Accepts the current format and the earlier one-skin-per-weapon format,
// which is converted by placing each item into its column.
export function sanitize(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => (Number.isFinite(v) ? v : Date.now());
  let lo = {
    id: typeof raw.id === 'string' && /^[a-z0-9]{4,40}$/i.test(raw.id) ? raw.id : newId(),
    name: cleanName(raw.name),
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
    ct: emptySide(),
    t: emptySide(),
  };
  const stamp = lo.updatedAt;
  for (const team of TEAMS) {
    const side = raw[team];
    if (!side || typeof side !== 'object') continue;
    const current = COLUMNS.some((c) => Array.isArray(side[c.key]));
    if (current) {
      for (const sp of SPECIALS) if (typeof side[sp.key] === 'string' && side[sp.key]) lo = setSpecial(lo, team, sp.key, side[sp.key], index, stamp);
      for (const col of COLUMNS) {
        const list = Array.isArray(side[col.key]) ? side[col.key].slice(0, SLOTS) : [];
        list.forEach((entry, i) => {
          if (entry && typeof entry === 'object' && typeof entry.weapon === 'string') {
            lo = setSlot(lo, team, col.key, i, entry.weapon, typeof entry.skin === 'string' ? entry.skin : '', index, stamp);
          }
        });
      }
    } else {
      // Earlier format: { slot: skinKey } (or a plain list of skin keys).
      for (const key of Object.values(side)) {
        const skin = typeof key === 'string' ? index.byKey.get(key) : null;
        if (skin) lo = equipSkin(lo, skin, key, team, index, stamp).loadout;
      }
    }
  }
  return { ...lo, updatedAt: stamp };
}

// ---------- Share links ----------
// "2." + "<ct side>_<t side>". Each side is a "."-separated list of tokens:
// knife, gloves, zeus, then the 15 slots. A slot token is "" (empty), a
// weapon def index ("61") for the default finish, or a skin key ("61-653").
// Trailing empty tokens are dropped. Only URL-safe characters are used.
export function encodeShare(lo, index) {
  const token = (slot) => (!slot ? '' : slot.skin || String(index.weapons[slot.weapon]?.defIndex ?? ''));
  const sides = TEAMS.map((t) => {
    const side = lo[t];
    return [side.knife, side.gloves, side.zeus, ...COLUMNS.flatMap((c) => side[c.key].map(token))].join('.').replace(/\.+$/, '');
  });
  return `2.${sides.join('_')}`;
}

export function decodeShare(code, name, index) {
  const str = String(code ?? '');
  const raw = { name };
  if (!str.startsWith('2.')) {
    // Links from the first version: "<ct skin keys>_<t skin keys>".
    str.split('_').forEach((part, i) => {
      if (TEAMS[i]) raw[TEAMS[i]] = part.split('.').filter((k) => /^\d+-\d+$/.test(k));
    });
    return sanitize(raw, index);
  }
  str
    .slice(2)
    .split('_')
    .forEach((part, i) => {
      const team = TEAMS[i];
      if (!team) return;
      const tokens = part.split('.');
      const side = { knife: tokens[0] || '', gloves: tokens[1] || '', zeus: tokens[2] || '' };
      COLUMNS.forEach((c, ci) => {
        side[c.key] = Array.from({ length: SLOTS }, (_, k) => {
          const tok = tokens[3 + ci * SLOTS + k] || '';
          if (/^\d+-\d+$/.test(tok)) {
            const s = index.byKey.get(tok);
            return s ? { weapon: s.weapon, skin: tok } : null;
          }
          if (/^\d+$/.test(tok)) {
            const w = index.byDef.get(tok);
            return w ? { weapon: w, skin: '' } : null;
          }
          return null;
        });
      });
      raw[team] = side;
    });
  return sanitize(raw, index);
}

// ---------- Persistence ----------
export function readStore(storage, index) {
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return { loadouts: [], ok: true };
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed?.loadouts) ? parsed.loadouts : [];
    return { loadouts: dedupeIds(list.map((l) => sanitize(l, index)).filter(Boolean)), ok: true };
  } catch (err) {
    return { loadouts: [], ok: false };
  }
}

export function writeStore(storage, loadouts) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, loadouts }));
    return true;
  } catch (err) {
    return false;
  }
}

function dedupeIds(list, taken = new Set()) {
  return list.map((l) => {
    const out = taken.has(l.id) ? { ...l, id: newId() } : l;
    taken.add(out.id);
    return out;
  });
}

// ---------- Import / export ----------
export function describe(lo, index) {
  const name = (key) => {
    const s = index.byKey.get(key);
    return s ? s.name + (s.phase ? ` (${s.phase})` : '') : key;
  };
  const lines = [];
  for (const t of TEAMS) {
    const side = lo[t];
    const T = t.toUpperCase();
    for (const sp of SPECIALS) if (side[sp.key]) lines.push(`${T} ${sp.label}: ${name(side[sp.key])}`);
    for (const col of COLUMNS) {
      side[col.key].forEach((slot, i) => {
        if (slot) lines.push(`${T} ${col.label} ${i + 1}: ${slot.skin ? name(slot.skin) : `${index.weapons[slot.weapon]?.name || slot.weapon} (default)`}`);
      });
    }
  }
  return lines;
}

export function exportPayload(loadouts, index, now = new Date()) {
  return {
    format: EXPORT_FORMAT,
    version: VERSION,
    exportedAt: now.toISOString(),
    loadouts: loadouts.map((lo) => ({ ...lo, items: describe(lo, index) })),
  };
}

// Accepts an export file, a bare array of loadouts, or a single loadout.
export function parseImport(text, index, existing = []) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('That file is not valid JSON.');
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.loadouts) ? parsed.loadouts : parsed && typeof parsed === 'object' ? [parsed] : [];
  const valid = list.map((l) => sanitize(l, index)).filter(Boolean);
  if (!valid.length) throw new Error('No loadouts found in that file.');
  return dedupeIds(valid, new Set(existing.map((l) => l.id)));
}
