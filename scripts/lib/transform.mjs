// Turns the raw CSGO-API dumps (skins, collections, crates) into the compact,
// market-free dataset the site loads. Pure functions only, so it can be tested
// without network access.

export const WEAR_TIERS = [
  { code: 'FN', name: 'Factory New', min: 0, max: 0.07 },
  { code: 'MW', name: 'Minimal Wear', min: 0.07, max: 0.15 },
  { code: 'FT', name: 'Field-Tested', min: 0.15, max: 0.38 },
  { code: 'WW', name: 'Well-Worn', min: 0.38, max: 0.45 },
  { code: 'BS', name: 'Battle-Scarred', min: 0.45, max: 1 },
];

// Game rarity tiers, lowest to highest. Gloves use "Extraordinary" and the
// M4A4 | Howl is the only "Contraband" item.
const RARITY_ORDER = [
  'rarity_common_weapon',
  'rarity_uncommon_weapon',
  'rarity_rare_weapon',
  'rarity_mythical_weapon',
  'rarity_legendary_weapon',
  'rarity_ancient_weapon',
  'rarity_ancient',
  'rarity_contraband_weapon',
];

const RARITY_KEYS = {
  rarity_common_weapon: 'consumer',
  rarity_uncommon_weapon: 'industrial',
  rarity_rare_weapon: 'milspec',
  rarity_mythical_weapon: 'restricted',
  rarity_legendary_weapon: 'classified',
  rarity_ancient_weapon: 'covert',
  rarity_ancient: 'extraordinary',
  rarity_contraband_weapon: 'contraband',
};

const CATEGORY_ORDER = ['Rifles', 'Pistols', 'SMGs', 'Heavy', 'Knives', 'Gloves', 'Equipment'];

const TEAM_KEYS = {
  both: 'both',
  'counter-terrorists': 'ct',
  terrorists: 't',
};

export function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function stripPrefix(id, prefix) {
  return id && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

// "2019/10/02" and "2019-10-02" both become "2019-10-02".
export function normalizeDate(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

// The upstream description is the game's localized string: a literal "\n"
// separator and the flavor text wrapped in <i>…</i>.
export function splitDescription(raw) {
  if (!raw) return { description: null, flavor: null };
  let text = String(raw).replace(/\\n/g, '\n').replace(/\r/g, '');
  let flavor = null;
  const flavorMatch = text.match(/<i>([\s\S]*?)<\/i>/i);
  if (flavorMatch) {
    flavor = stripTags(flavorMatch[1]).trim() || null;
    text = text.replace(flavorMatch[0], '');
  }
  const description = stripTags(text).replace(/\n{3,}/g, '\n\n').trim() || null;
  return { description, flavor };
}

function stripTags(text) {
  return text.replace(/<[^>]*>/g, '');
}

// A skin can be found in a wear tier when its float range overlaps that tier.
export function wearsForRange(minFloat, maxFloat) {
  if (typeof minFloat !== 'number' || typeof maxFloat !== 'number') return [];
  return WEAR_TIERS.filter((tier) => maxFloat > tier.min && minFloat < tier.max).map((t) => t.code);
}

export function crateType(crate) {
  if (crate.type) return crate.type;
  const name = crate.name || '';
  if (/terminal/i.test(name)) return 'Terminal';
  if (/package/i.test(name)) return 'Package';
  return 'Other';
}

function minDate(dates) {
  const valid = dates.filter(Boolean).sort();
  return valid.length ? valid[0] : null;
}

export function transform({ skins, collections, crates }, { generatedAt = new Date().toISOString(), source = null } = {}) {
  const crateById = new Map(crates.map((c) => [c.id, c]));
  const collectionById = new Map(collections.map((c) => [c.id, c]));

  // Some newer containers (e.g. terminals) have no sale date upstream; fall
  // back to the release date of the collection they belong to. Souvenir
  // packages are excluded: they belong to old map collections but were sold
  // at later Majors, so their year comes from the event name instead.
  const crateCollectionDate = new Map();
  for (const c of collections) {
    const date = normalizeDate(c.release_date);
    if (!date) continue;
    for (const x of c.crates || []) {
      const prev = crateCollectionDate.get(x.id);
      if (!prev || date < prev) crateCollectionDate.set(x.id, date);
    }
  }

  const rarities = {};
  const weapons = {};
  const outCollections = {};
  const outCrates = {};
  const outSkins = [];

  const ensureRarity = (r) => {
    const key = RARITY_KEYS[r.id] || slugify(r.name);
    if (!rarities[key]) {
      const idx = RARITY_ORDER.indexOf(r.id);
      rarities[key] = { name: r.name, color: r.color, order: idx === -1 ? 0 : idx + 1 };
    }
    return key;
  };

  const ensureCollection = (id) => {
    const key = stripPrefix(id, 'collection-');
    if (!outCollections[key]) {
      const c = collectionById.get(id) || { name: id, crates: [] };
      outCollections[key] = {
        name: c.name,
        releaseDate: normalizeDate(c.release_date),
        image: c.image || null,
        crates: (c.crates || []).map((x) => stripPrefix(x.id, 'crate-')),
        skins: [],
      };
    }
    return key;
  };

  const ensureCrate = (id) => {
    const key = stripPrefix(id, 'crate-');
    if (!outCrates[key]) {
      const c = crateById.get(id) || { name: id };
      const type = crateType(c);
      const firstSaleDate = normalizeDate(c.first_sale_date) || (type !== 'Souvenir' ? crateCollectionDate.get(id) : null) || null;
      const nameYear = (c.name || '').match(/\b(20\d\d)\b/);
      outCrates[key] = {
        name: c.name,
        type,
        firstSaleDate,
        year: firstSaleDate ? firstSaleDate.slice(0, 4) : nameYear ? nameYear[1] : null,
        image: c.image || null,
        skins: [],
      };
    }
    return key;
  };

  for (const s of skins) {
    const id = stripPrefix(s.id, 'skin-');
    const weaponKey = slugify(s.weapon.name);
    if (!weapons[weaponKey]) {
      weapons[weaponKey] = {
        name: s.weapon.name,
        category: s.category.name,
        defIndex: s.weapon.weapon_id ?? null,
      };
    }

    const collectionKeys = (s.collections || []).map((c) => ensureCollection(c.id));
    const crateKeys = (s.crates || []).map((c) => ensureCrate(c.id));
    for (const key of collectionKeys) outCollections[key].skins.push(id);
    for (const key of crateKeys) outCrates[key].skins.push(id);

    // Upstream's `souvenir` flag is unreliable (it marks plain case skins), so
    // souvenir availability is derived from membership in a souvenir package.
    const souvenir = crateKeys.some((k) => outCrates[k].type === 'Souvenir');

    const released = collectionKeys.length
      ? minDate(collectionKeys.map((k) => outCollections[k].releaseDate))
      : minDate(crateKeys.map((k) => outCrates[k].firstSaleDate));

    const { description, flavor } = splitDescription(s.description);
    const paintIndex = s.paint_index == null || s.paint_index === '' ? null : Number(s.paint_index);

    outSkins.push({
      id,
      name: s.name,
      weapon: weaponKey,
      finish: s.pattern ? s.pattern.name : null,
      finishCode: s.pattern ? s.pattern.id : null,
      paintIndex: Number.isFinite(paintIndex) ? paintIndex : null,
      phase: s.phase || null,
      rarity: ensureRarity(s.rarity),
      category: s.category.name,
      minFloat: typeof s.min_float === 'number' ? s.min_float : null,
      maxFloat: typeof s.max_float === 'number' ? s.max_float : null,
      wears: wearsForRange(s.min_float, s.max_float),
      stattrak: Boolean(s.stattrak),
      souvenir,
      team: TEAM_KEYS[s.team?.id] || 'both',
      legacyModel: Boolean(s.legacy_model),
      released,
      description,
      flavor,
      collections: collectionKeys,
      crates: crateKeys,
      notes: (s.special_notes || []).map((n) => ({ text: n.text, source: n.source || null })),
      image: s.image || null,
    });
  }

  outSkins.sort((a, b) => a.name.localeCompare(b.name, 'en') || (a.phase || '').localeCompare(b.phase || '', 'en'));

  const categories = CATEGORY_ORDER.filter((c) => outSkins.some((s) => s.category === c));
  for (const s of outSkins) if (!categories.includes(s.category)) categories.push(s.category);

  return {
    schemaVersion: 1,
    generatedAt,
    source,
    counts: {
      skins: outSkins.length,
      weapons: Object.keys(weapons).length,
      collections: Object.keys(outCollections).length,
      crates: Object.keys(outCrates).length,
    },
    wearTiers: WEAR_TIERS,
    categories,
    rarities: sortObject(rarities, (a, b) => a.order - b.order),
    weapons: sortObject(weapons, (a, b) => a.name.localeCompare(b.name, 'en')),
    collections: sortObject(outCollections, (a, b) => a.name.localeCompare(b.name, 'en')),
    crates: sortObject(outCrates, (a, b) => a.name.localeCompare(b.name, 'en')),
    skins: outSkins,
  };
}

function sortObject(obj, compare) {
  return Object.fromEntries(Object.entries(obj).sort(([, a], [, b]) => compare(a, b)));
}
