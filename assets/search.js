// Text search shared by the browser app and the Node tests.

// Nicknames players actually type, keyed by the in-game weapon name.
export const WEAPON_ALIASES = {
  'AK-47': 'ak',
  'Desert Eagle': 'deagle deag',
  'Dual Berettas': 'dualies berettas duals',
  'CZ75-Auto': 'cz cz75',
  'Five-SeveN': '57 five7 fn57',
  'Glock-18': 'glock',
  'P2000': 'p2k',
  'USP-S': 'usp',
  'R8 Revolver': 'revolver r8',
  'Tec-9': 'tec',
  'M4A1-S': 'm4 m4a1',
  'M4A4': 'm4',
  'SG 553': 'krieg sg',
  'SSG 08': 'scout ssg sniper',
  'AWP': 'sniper',
  'SCAR-20': 'scar autosniper auto sniper',
  'G3SG1': 'g3 autosniper auto sniper',
  'Galil AR': 'galil',
  'PP-Bizon': 'bizon',
  'MP5-SD': 'mp5',
  'UMP-45': 'ump',
  'MAC-10': 'mac',
  'Nova': 'shotgun',
  'XM1014': 'xm autoshotgun shotgun',
  'Sawed-Off': 'sawed sawn shotgun',
  'MAG-7': 'mag shotgun',
  'M249': 'lmg machine gun',
  'Negev': 'lmg machine gun',
  'Zeus x27': 'taser zeus',
  'Butterfly Knife': 'bfk butterfly',
  'M9 Bayonet': 'm9',
  'Shadow Daggers': 'daggers shadows push',
  'Huntsman Knife': 'huntsman tactical',
  'Survival Knife': 'canis',
  'Navaja Knife': 'navaja',
  'Classic Knife': 'css',
  'Hand Wraps': 'handwraps wraps',
  'Moto Gloves': 'motorcycle',
  'Driver Gloves': 'slick',
};

const CATEGORY_WORDS = {
  Rifles: 'rifle rifles',
  Pistols: 'pistol pistols',
  SMGs: 'smg smgs',
  Heavy: 'heavy',
  Knives: 'knife knives melee',
  Gloves: 'glove gloves',
  Equipment: 'equipment',
};

const TEAM_WORDS = { ct: 'ct counter terrorist', t: 't terrorist', both: '' };

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const compact = (text) => text.replace(/ /g, '');

// Precompute everything the matcher needs for one skin.
export function buildEntry(skin, data) {
  const weapon = data.weapons[skin.weapon];
  const weaponName = weapon ? weapon.name : '';
  const primary = normalize(
    [skin.name, skin.phase, WEAPON_ALIASES[weaponName], skin.finish ? '' : 'vanilla'].filter(Boolean).join(' '),
  );
  const secondary = normalize(
    [
      ...skin.collections.map((c) => data.collections[c]?.name),
      ...skin.crates.map((c) => data.crates[c]?.name),
      data.rarities[skin.rarity]?.name,
      CATEGORY_WORDS[skin.category] || skin.category,
      TEAM_WORDS[skin.team],
      skin.stattrak ? 'stattrak' : '',
      skin.souvenir ? 'souvenir' : '',
      skin.finishCode,
    ]
      .filter(Boolean)
      .join(' '),
  );
  const name = normalize([skin.name, skin.phase].filter(Boolean).join(' '));
  return {
    name,
    primary,
    primaryCompact: compact(primary),
    secondary,
    secondaryCompact: compact(secondary),
  };
}

// Several independent terms can be searched at once: "ak redline, awp asiimov"
// finds both. Words inside a term must all match; any term may match.
// "|" is not a separator because it is part of every skin name.
export const TERM_SEPARATOR = /[,;]+/;

export function splitTerms(query) {
  return String(query ?? '')
    .split(TERM_SEPARATOR)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Splits one term into text tokens plus paint index filters written as "#44".
export function parseTerm(term) {
  const paintIndexes = [];
  const rest = String(term ?? '').replace(/#\s*(\d+)/g, (_, n) => {
    paintIndexes.push(Number(n));
    return ' ';
  });
  const text = normalize(rest);
  return { text, tokens: text ? text.split(' ') : [], paintIndexes };
}

// Terms that normalize to nothing (e.g. a lone "★") are dropped.
export function parseQuery(query) {
  return splitTerms(query)
    .map(parseTerm)
    .filter((t) => t.tokens.length || t.paintIndexes.length);
}

// Plain name matching with the same term rules, for collections, cases and
// the loadout picker.
export function matchesName(name, query) {
  const terms = parseQuery(query).filter((t) => t.tokens.length);
  if (!terms.length) return true;
  const hay = normalize(name);
  const hayCompact = compact(hay);
  return terms.some((t) => t.tokens.every((tok) => hay.includes(tok) || hayCompact.includes(tok)));
}

const wordStart = (haystack, token) => haystack.startsWith(token) || haystack.includes(' ' + token);

// Scores one parsed term: 0 when the entry does not match, otherwise a
// relevance score. Every token has to appear somewhere; tokens in the skin's
// own name count most.
export function score(entry, term) {
  const { tokens, text } = term;
  if (!tokens.length) return 1;
  let total = 0;
  for (const token of tokens) {
    if (entry.primary.includes(token)) total += wordStart(entry.primary, token) ? 120 : 80;
    else if (entry.primaryCompact.includes(token)) total += 70;
    // Very short tokens only match the start of a word in the secondary text,
    // so "ak" doesn't match every skin with "stattrak" in it.
    else if (wordStart(entry.secondary, token)) total += 15;
    else if (token.length > 2 && entry.secondary.includes(token)) total += 8;
    else if (token.length > 2 && entry.secondaryCompact.includes(token)) total += 5;
    else return 0;
  }
  if (entry.name === text) total += 1000;
  else if (entry.name.startsWith(text)) total += 300;
  else if (entry.name.includes(text)) total += 150;
  else if (compact(entry.name).includes(compact(text))) total += 100;
  return total;
}

export function search(entries, query) {
  const terms = parseQuery(query);
  const results = [];
  for (const { skin, entry } of entries) {
    let best = terms.length ? 0 : 1;
    for (const term of terms) {
      if (term.paintIndexes.length && !term.paintIndexes.includes(skin.paintIndex)) continue;
      best = Math.max(best, score(entry, term));
    }
    if (best > 0) results.push({ skin, score: best });
  }
  return results;
}
