// Loadouts: data model, validation, persistence and share-link encoding.
// No DOM access here, so the module is shared with the Node tests.
//
// A loadout equips at most one item per slot per side, like the game:
//   { id, name, createdAt, updatedAt, ct: { slot: itemKey }, t: { slot: itemKey } }
// Slots are weapon keys ("ak-47"), plus "knife" and "gloves" which take any
// knife or glove. Items are stored by the game's own identity,
// "<weapon def index>-<paint index>", so saved loadouts survive data rebuilds.

export const STORAGE_KEY = 'cs2db-loadouts';
export const EXPORT_FORMAT = 'cs2skindb-loadouts';
export const TEAMS = ['ct', 't'];
export const MAX_NAME = 60;
export const DEFAULT_NAME = 'Untitled loadout';

export function itemKey(skin, weapons) {
  const def = weapons[skin.weapon]?.defIndex ?? 0;
  return `${def}-${skin.paintIndex ?? 0}`;
}

export function slotOf(skin) {
  if (skin.category === 'Knives') return 'knife';
  if (skin.category === 'Gloves') return 'gloves';
  return skin.weapon;
}

export const teamsOf = (skin) => (skin.team === 'both' ? [...TEAMS] : [skin.team]);

// Lookup tables plus the ordered slot list for each side.
export function buildIndex(data) {
  const byKey = new Map();
  const weaponTeam = {};
  for (const s of data.skins) {
    byKey.set(itemKey(s, data.weapons), s);
    if (!weaponTeam[s.weapon]) weaponTeam[s.weapon] = s.team;
  }
  const order = data.categories;
  const slots = {};
  for (const team of TEAMS) {
    const guns = Object.entries(data.weapons)
      .filter(([k, w]) => w.category !== 'Knives' && w.category !== 'Gloves' && (weaponTeam[k] === 'both' || weaponTeam[k] === team))
      .sort(([, a], [, b]) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name, 'en'))
      .map(([k, w]) => ({ slot: k, label: w.name, category: w.category }));
    slots[team] = [
      { slot: 'knife', label: 'Knife', category: 'Knives' },
      { slot: 'gloves', label: 'Gloves', category: 'Gloves' },
      ...guns,
    ];
  }
  return { byKey, slots, weaponTeam };
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function cleanName(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return s || DEFAULT_NAME;
}

export function createLoadout(name = DEFAULT_NAME, now = Date.now()) {
  return { id: newId(), name: cleanName(name), createdAt: now, updatedAt: now, ct: {}, t: {} };
}

// Returns a new loadout with `key` equipped in `slot` (or cleared when key is empty).
export function setItem(loadout, team, slot, key, now = Date.now()) {
  const side = { ...loadout[team] };
  if (key) side[slot] = key;
  else delete side[slot];
  return { ...loadout, [team]: side, updatedAt: now };
}

// Equips a skin on the given sides, using the slot the skin belongs to.
export function equipSkin(loadout, skin, key, teams, now = Date.now()) {
  let out = loadout;
  for (const team of teams) if (teamsOf(skin).includes(team)) out = setItem(out, team, slotOf(skin), key, now);
  return out;
}

export const countItems = (loadout) => Object.keys(loadout.ct).length + Object.keys(loadout.t).length;

// Copies every slot that exists on both sides from one side to the other.
export function copySide(loadout, from, to, index, now = Date.now()) {
  const target = new Set(index.slots[to].map((s) => s.slot));
  const side = { ...loadout[to] };
  for (const { slot } of index.slots[from]) {
    if (!target.has(slot)) continue;
    if (loadout[from][slot]) side[slot] = loadout[from][slot];
    else delete side[slot];
  }
  return { ...loadout, [to]: side, updatedAt: now };
}

// Validates anything that claims to be a loadout (storage, imports, links).
// The slot is always re-derived from the item, and items that don't exist or
// can't be used on that side are dropped.
export function sanitize(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => (Number.isFinite(v) ? v : Date.now());
  const out = {
    id: typeof raw.id === 'string' && /^[a-z0-9]{4,40}$/i.test(raw.id) ? raw.id : newId(),
    name: cleanName(raw.name),
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
    ct: {},
    t: {},
  };
  for (const team of TEAMS) {
    const side = raw[team];
    if (!side || typeof side !== 'object') continue;
    for (const key of Object.values(side)) {
      if (typeof key !== 'string') continue;
      const skin = index.byKey.get(key);
      if (skin && teamsOf(skin).includes(team)) out[team][slotOf(skin)] = key;
    }
  }
  return out;
}

// ---------- Share links ----------
// "<ct items>_<t items>", items separated by "." – only URL-safe characters.
export function encodeShare(loadout) {
  return TEAMS.map((t) => Object.values(loadout[t]).join('.')).join('_');
}

export function decodeShare(code, name, index) {
  const parts = String(code ?? '').split('_');
  const raw = { name };
  TEAMS.forEach((t, i) => {
    raw[t] = (parts[i] || '').split('.').filter((k) => /^\d+-\d+$/.test(k));
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
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, loadouts }));
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
export function exportPayload(loadouts, index, now = new Date()) {
  const describe = (lo) =>
    TEAMS.flatMap((t) =>
      Object.values(lo[t]).map((k) => {
        const s = index.byKey.get(k);
        return `${t.toUpperCase()}: ${s ? s.name + (s.phase ? ` (${s.phase})` : '') : k}`;
      }),
    );
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    loadouts: loadouts.map((lo) => ({ ...lo, items: describe(lo) })),
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
