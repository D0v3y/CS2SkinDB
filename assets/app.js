import { buildEntry, search } from './search.js';

const DATA_URL = new URL('../data/skins.json', import.meta.url);
const PAGE_SIZE = 120;
const VIEWS = ['skins', 'collections', 'cases'];

const TEAM_LABELS = { both: 'Both teams', ct: 'Counter-Terrorist', t: 'Terrorist' };
const CRATE_TYPES = [
  { key: 'Case', label: 'Weapon cases', single: 'Weapon case' },
  { key: 'Terminal', label: 'Terminals', single: 'Terminal' },
  { key: 'Souvenir', label: 'Souvenir packages', single: 'Souvenir package' },
  { key: 'Package', label: 'Other packages', single: 'Package' },
  { key: 'Other', label: 'Other', single: 'Container' },
];
const COLLECTION_KINDS = [
  { key: 'case', label: 'Case', long: 'Case collection' },
  { key: 'map', label: 'Map & Souvenir', long: 'Map collection' },
  { key: 'other', label: 'Armory & drops', long: 'Armory & drop collection' },
];
const SKIN_SORTS = [
  { key: 'relevance', label: 'Best match', needsQuery: true },
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'rarity-desc', label: 'Rarity: high to low' },
  { key: 'rarity-asc', label: 'Rarity: low to high' },
  { key: 'weapon', label: 'Weapon A–Z' },
  { key: 'name', label: 'Finish name A–Z' },
];
const GROUP_SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'size', label: 'Most skins' },
];

const $ = (sel, root = document) => root.querySelector(sel);
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

let data;
let skinById;
let entries;
let state = readState();
let lastListKey = null;
let listItems = [];
let listRender = null;
let renderedCount = 0;
let skinNav = [];
let openSkinId = null;
let detailPushed = false;
let lastQuery = null;
let lastScores = null;

// ---------- Helpers ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
const fmtNum = (n) => n.toLocaleString('en-US');
const catKey = (name) => String(name).toLowerCase();
const stripThe = (name) => name.replace(/^The /, '');
// Souvenir packages only have an event year, not an exact sale date.
const crateDateKey = (c) => c.firstSaleDate || c.year || '';

function fmtDate(d) {
  if (!d) return 'Unknown';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fmtFloat(f) {
  if (typeof f !== 'number') return '—';
  const s = String(Number(f.toFixed(4)));
  if (!s.includes('.')) return s + '.00';
  return s.split('.')[1].length === 1 ? s + '0' : s;
}

// Steam's image CDN serves resized images when a size suffix is appended.
function imageUrl(url, size) {
  const u = safeUrl(url);
  if (!u) return '';
  return size && u.includes('/economy/image/') ? `${u}/${size}` : u;
}

const splitName = (s) => {
  const [weapon, finish] = s.name.split(' | ');
  return { weapon, finish: finish || 'Vanilla' };
};
const displayName = (s) => (s.phase ? `${s.name} (${s.phase})` : s.name);
const rarityOf = (s) => data.rarities[s.rarity] || { name: s.rarity, color: '#888', order: 0 };

const ICONS = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 5 8.4 12l7 7-1.4 1.4L5.6 12 14 3.6z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 5 10 3.6l8.4 8.4-8.4 8.4L8.6 19l7-7z" fill="currentColor"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a1 1 0 0 1 0-1.4l3.5-3.5a3 3 0 0 1 4.2 4.2l-2.1 2.1-1.4-1.4 2.1-2.1a1 1 0 0 0-1.4-1.4L12 13.4a1 1 0 0 1-1.4 0zm2.8-2.8a1 1 0 0 1 0 1.4l-3.5 3.5a3 3 0 0 1-4.2-4.2l2.1-2.1 1.4 1.4-2.1 2.1a1 1 0 0 0 1.4 1.4L12 10.6a1 1 0 0 1 1.4 0z" fill="currentColor"/></svg>',
};

// ---------- URL state ----------
function readState() {
  const raw = location.hash.replace(/^#\/?/, '');
  const qIndex = raw.indexOf('?');
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const p = new URLSearchParams(qIndex === -1 ? '' : raw.slice(qIndex + 1));
  const list = (k) => (p.get(k) || '').split(',').map((v) => v.trim()).filter(Boolean);
  return {
    view: VIEWS.includes(path) ? path : 'skins',
    q: p.get('q') || '',
    cat: list('cat'),
    weapon: p.get('weapon') || '',
    rarity: list('rarity'),
    col: p.get('col') || '',
    crate: p.get('crate') || '',
    wear: list('wear').map((w) => w.toUpperCase()),
    st: p.get('st') === '1',
    sv: p.get('sv') === '1',
    src: p.get('src') === '1',
    team: p.get('team') || '',
    year: p.get('year') || '',
    kind: p.get('kind') || '',
    type: p.get('type') || '',
    sort: p.get('sort') || '',
    skin: p.get('skin') || '',
  };
}

function toHash(s) {
  const p = new URLSearchParams();
  const set = (k, v) => {
    if (Array.isArray(v) ? v.length : v) p.set(k, Array.isArray(v) ? v.join(',') : v === true ? '1' : v);
  };
  set('q', s.q);
  if (s.view === 'skins') {
    set('cat', s.cat);
    set('weapon', s.weapon);
    set('rarity', s.rarity);
    set('col', s.col);
    set('crate', s.crate);
    set('wear', (s.wear || []).map((w) => w.toLowerCase()));
    set('st', s.st);
    set('sv', s.sv);
    set('src', s.src);
    set('team', s.team);
    set('year', s.year);
  } else if (s.view === 'collections') {
    set('kind', s.kind);
  } else if (s.view === 'cases') {
    set('type', s.type);
  }
  set('sort', s.sort);
  set('skin', s.skin);
  const qs = p.toString().replace(/%2C/gi, ',');
  return `#/${s.view}${qs ? '?' + qs : ''}`;
}

const EMPTY_FILTERS = { q: '', cat: [], weapon: '', rarity: [], col: '', crate: '', wear: [], st: false, sv: false, src: false, team: '', year: '', kind: '', type: '', sort: '', skin: '' };
const hrefFor = (patch) => toHash({ ...EMPTY_FILTERS, view: 'skins', ...patch });

function update(patch, { push = false } = {}) {
  state = { ...state, ...patch };
  const hash = toHash(state);
  if (hash !== location.hash) history[push ? 'pushState' : 'replaceState'](null, '', hash);
  render();
}

// ---------- Filtering & sorting ----------
function textScores(q) {
  if (q === lastQuery) return lastScores;
  lastQuery = q;
  lastScores = q.trim() ? new Map(search(entries, q).map((r) => [r.skin.id, r.score])) : null;
  return lastScores;
}

function matchSkin(s, f, skip) {
  if (skip !== 'cat' && f.cat.length && !f.cat.includes(catKey(s.category))) return false;
  if (skip !== 'weapon' && f.weapon && s.weapon !== f.weapon) return false;
  if (skip !== 'rarity' && f.rarity.length && !f.rarity.includes(s.rarity)) return false;
  if (skip !== 'col' && f.col && !s.collections.includes(f.col)) return false;
  if (skip !== 'crate' && f.crate && !s.crates.includes(f.crate)) return false;
  if (skip !== 'wear' && f.wear.length && !f.wear.every((w) => s.wears.includes(w))) return false;
  if (skip !== 'st' && f.st && !s.stattrak) return false;
  if (skip !== 'sv' && f.sv && !s.souvenir) return false;
  if (skip !== 'src' && f.src && !s.collections.length && !s.crates.length) return false;
  if (skip !== 'team' && f.team && s.team !== f.team && s.team !== 'both') return false;
  if (skip !== 'year' && f.year && !(s.released && s.released.startsWith(f.year))) return false;
  return true;
}

function effectiveSkinSort() {
  const valid = SKIN_SORTS.some((o) => o.key === state.sort);
  if (!valid || (state.sort === 'relevance' && !state.q.trim())) return state.q.trim() ? 'relevance' : 'newest';
  return state.sort;
}

function compareSkins(sort, scores) {
  const byName = (a, b) => collator.compare(a.name, b.name) || collator.compare(a.phase || '', b.phase || '');
  const byRarity = (a, b) => rarityOf(b).order - rarityOf(a).order;
  const byDate = (dir) => (a, b) => {
    if (a.released === b.released) return 0;
    if (!a.released) return 1;
    if (!b.released) return -1;
    return a.released < b.released ? -dir : dir;
  };
  switch (sort) {
    case 'relevance':
      return (a, b) => scores.get(b.id) - scores.get(a.id) || byRarity(a, b) || byName(a, b);
    case 'oldest':
      return (a, b) => byDate(1)(a, b) || byRarity(a, b) || byName(a, b);
    case 'rarity-desc':
      return (a, b) => byRarity(a, b) || byName(a, b);
    case 'rarity-asc':
      return (a, b) => -byRarity(a, b) || byName(a, b);
    case 'name':
      return (a, b) => collator.compare(splitName(a).finish, splitName(b).finish) || byName(a, b);
    case 'weapon':
      return byName;
    case 'newest':
    default:
      return (a, b) => byDate(-1)(a, b) || byRarity(a, b) || byName(a, b);
  }
}

function skinBase() {
  const scores = textScores(state.q);
  return { scores, base: scores ? data.skins.filter((s) => scores.has(s.id)) : data.skins };
}

// ---------- Rendering: shell ----------
function render() {
  if (!data) return;
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.view === state.view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const input = $('#q');
  if (document.activeElement !== input && input.value !== state.q) input.value = state.q;
  input.placeholder = { skins: 'Search skins, weapons, collections, cases…', collections: 'Search collections…', cases: 'Search cases and packages…' }[state.view];

  const { skin, ...rest } = state;
  const key = JSON.stringify(rest);
  if (key !== lastListKey) {
    lastListKey = key;
    $('#layout').classList.toggle('no-filters', state.view !== 'skins');
    if (state.view === 'skins') renderSkinsView();
    else if (state.view === 'collections') renderCollectionsView();
    else renderCasesView();
  }
  renderDetail();
}

function setList(items, renderItem, wide) {
  const grid = $('#grid');
  grid.classList.toggle('wide', Boolean(wide));
  grid.setAttribute('aria-busy', 'false');
  listItems = items;
  listRender = renderItem;
  renderedCount = 0;
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = `<p class="empty"><strong>Nothing matches.</strong>Try a shorter search or remove a filter.</p>`;
    return;
  }
  appendPage();
  if (window.scrollY > 0) window.scrollTo({ top: 0 });
}

function appendPage() {
  if (renderedCount >= listItems.length) return;
  const next = listItems.slice(renderedCount, renderedCount + PAGE_SIZE);
  $('#grid').insertAdjacentHTML('beforeend', next.map(listRender).join(''));
  renderedCount += next.length;
  requestAnimationFrame(() => {
    const rect = $('#sentinel').getBoundingClientRect();
    if (rect.top < window.innerHeight + 600) appendPage();
  });
}

function renderSort(options, current) {
  $('#sort').innerHTML = options.map((o) => `<option value="${o.key}"${o.key === current ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
}

function renderActiveChips(chips) {
  const html = chips.map((c) => `<button type="button" class="chip-x" data-clear="${esc(c.clear)}" title="Remove filter"><span>${esc(c.label)}</span>${ICONS.x}</button>`);
  if (chips.length > 1) html.push(`<button type="button" class="chip-x" data-clear="all"><span>Clear all</span>${ICONS.x}</button>`);
  $('#active-chips').innerHTML = html.join('');
}

// ---------- Skins view ----------
function renderSkinsView() {
  const { scores, base } = skinBase();
  const sort = effectiveSkinSort();
  const items = base.filter((s) => matchSkin(s, state)).sort(compareSkins(sort, scores));
  skinNav = items.map((s) => s.id);

  renderFilters(base);
  renderSort(SKIN_SORTS.filter((o) => !o.needsQuery || state.q.trim()), sort);
  $('#count').innerHTML = `<strong>${fmtNum(items.length)}</strong> ${items.length === 1 ? 'skin' : 'skins'}${items.length !== data.skins.length ? ` <span>of ${fmtNum(data.skins.length)}</span>` : ''}`;
  renderActiveChips(activeSkinChips());
  renderContext();
  setList(items, (s) => skinCard(s));
}

function activeSkinChips() {
  const chips = [];
  if (state.q.trim()) chips.push({ label: `“${state.q.trim()}”`, clear: 'q' });
  state.cat.forEach((c) => chips.push({ label: data.categories.find((x) => catKey(x) === c) || c, clear: `cat:${c}` }));
  if (state.weapon) chips.push({ label: data.weapons[state.weapon]?.name || state.weapon, clear: 'weapon' });
  state.rarity.forEach((r) => chips.push({ label: data.rarities[r]?.name || r, clear: `rarity:${r}` }));
  if (state.col) chips.push({ label: data.collections[state.col]?.name || state.col, clear: 'col' });
  if (state.crate) chips.push({ label: data.crates[state.crate]?.name || state.crate, clear: 'crate' });
  state.wear.forEach((w) => chips.push({ label: `Has ${data.wearTiers.find((t) => t.code === w)?.name || w}`, clear: `wear:${w}` }));
  if (state.st) chips.push({ label: 'StatTrak™', clear: 'st' });
  if (state.sv) chips.push({ label: 'Souvenir', clear: 'sv' });
  if (state.src) chips.push({ label: 'Has a drop source', clear: 'src' });
  if (state.team) chips.push({ label: TEAM_LABELS[state.team] || state.team, clear: 'team' });
  if (state.year) chips.push({ label: `Released ${state.year}`, clear: 'year' });
  return chips;
}

function countBy(list, fn) {
  const m = new Map();
  for (const s of list) for (const k of [].concat(fn(s))) m.set(k, (m.get(k) || 0) + 1);
  return m;
}

function chip(group, value, label, count, pressed, extra = '') {
  const disabled = !pressed && count === 0;
  return `<button type="button" class="chip" data-toggle="${group}" data-value="${esc(value)}" aria-pressed="${pressed}"${disabled ? ' disabled' : ''}${extra}>${label}<span class="n">${fmtNum(count)}</span></button>`;
}

function renderFilters(base) {
  const active = document.activeElement;
  const focusId = active && active.closest('#filters') ? active.id : null;

  const forFacet = (skip) => base.filter((s) => matchSkin(s, state, skip));
  const catCounts = countBy(forFacet('cat'), (s) => catKey(s.category));
  const rarityCounts = countBy(forFacet('rarity'), (s) => s.rarity);
  const weaponCounts = countBy(forFacet('weapon'), (s) => s.weapon);
  const wearPool = forFacet('wear');
  const yearCounts = countBy(forFacet('year'), (s) => (s.released ? s.released.slice(0, 4) : 'unknown'));
  const colCounts = countBy(forFacet('col'), (s) => s.collections);
  const crateCounts = countBy(forFacet('crate'), (s) => s.crates);

  const cats = data.categories
    .map((c) => chip('cat', catKey(c), esc(c), catCounts.get(catKey(c)) || 0, state.cat.includes(catKey(c)), ` id="f-cat-${catKey(c)}"`))
    .join('');

  const weaponGroups = data.categories
    .filter((c) => !state.cat.length || state.cat.includes(catKey(c)))
    .map((c) => {
      const opts = Object.entries(data.weapons)
        .filter(([, w]) => w.category === c)
        .map(([k, w]) => `<option value="${esc(k)}"${k === state.weapon ? ' selected' : ''}>${esc(w.name)} (${fmtNum(weaponCounts.get(k) || 0)})</option>`)
        .join('');
      return `<optgroup label="${esc(c)}">${opts}</optgroup>`;
    })
    .join('');

  const rarities = Object.entries(data.rarities)
    .slice()
    .reverse()
    .map(([k, r]) => chip('rarity', k, `<span class="dot" style="--c:${esc(r.color)}"></span>${esc(r.name)}`, rarityCounts.get(k) || 0, state.rarity.includes(k), ` id="f-rarity-${k}"`))
    .join('');

  const colOptions = Object.entries(data.collections)
    .sort(([, a], [, b]) => collator.compare(stripThe(a.name), stripThe(b.name)))
    .map(([k, c]) => {
      const n = colCounts.get(k) || 0;
      return `<option value="${esc(k)}"${k === state.col ? ' selected' : ''}${!n && k !== state.col ? ' disabled' : ''}>${esc(c.name)}${c.releaseDate ? ` · ${c.releaseDate.slice(0, 4)}` : ''} (${n})</option>`;
    })
    .join('');

  const crateGroups = CRATE_TYPES.map((t) => {
    const opts = Object.entries(data.crates)
      .filter(([, c]) => c.type === t.key)
      .sort(([, a], [, b]) => crateDateKey(b).localeCompare(crateDateKey(a)) || collator.compare(a.name, b.name))
      .map(([k, c]) => {
        const n = crateCounts.get(k) || 0;
        return `<option value="${esc(k)}"${k === state.crate ? ' selected' : ''}${!n && k !== state.crate ? ' disabled' : ''}>${esc(c.name)} (${n})</option>`;
      })
      .join('');
    return opts ? `<optgroup label="${esc(t.label)}">${opts}</optgroup>` : '';
  }).join('');

  const wears = data.wearTiers
    .map((t) => {
      const n = wearPool.filter((s) => [...state.wear, t.code].every((w) => s.wears.includes(w))).length;
      return chip('wear', t.code, esc(t.code), n, state.wear.includes(t.code), ` title="${esc(t.name)} (${t.min.toFixed(2)}–${t.max.toFixed(2)})" id="f-wear-${t.code}"`);
    })
    .join('');

  const years = [...yearCounts.keys()].filter((y) => y !== 'unknown').sort().reverse();
  const yearOptions = years.map((y) => `<option value="${y}"${y === state.year ? ' selected' : ''}>${y} (${yearCounts.get(y)})</option>`).join('');

  const team = ['', 'ct', 't']
    .map((t) => `<button type="button" data-team="${t}" id="f-team-${t || 'any'}" aria-pressed="${state.team === t}">${t ? t.toUpperCase() : 'Any'}</button>`)
    .join('');

  $('#filters-body').innerHTML = `
    <section class="fgroup"><h3>Category</h3><div class="chips">${cats}</div></section>
    <section class="fgroup">
      <label class="flabel" for="f-weapon">Weapon</label>
      <select id="f-weapon" class="select" data-filter="weapon"><option value="">All weapons</option>${weaponGroups}</select>
    </section>
    <section class="fgroup"><h3>Rarity</h3><div class="chips">${rarities}</div></section>
    <section class="fgroup">
      <label class="flabel" for="f-col">Collection</label>
      <select id="f-col" class="select" data-filter="col"><option value="">All collections</option>${colOptions}</select>
    </section>
    <section class="fgroup">
      <label class="flabel" for="f-crate">Case or package</label>
      <select id="f-crate" class="select" data-filter="crate"><option value="">Any case or package</option>${crateGroups}</select>
    </section>
    <section class="fgroup"><h3>Exists in wear</h3><div class="chips">${wears}</div></section>
    <section class="fgroup"><h3>Availability</h3>
      <div class="checks">
        <label class="check"><input type="checkbox" id="f-st" data-check="st"${state.st ? ' checked' : ''}> StatTrak™ available</label>
        <label class="check"><input type="checkbox" id="f-sv" data-check="sv"${state.sv ? ' checked' : ''}> Souvenir available</label>
        <label class="check" title="Hide entries that are in the game files but not in any collection, case or package"><input type="checkbox" id="f-src" data-check="src"${state.src ? ' checked' : ''}> Has a drop source</label>
      </div>
    </section>
    <section class="fgroup"><h3>Team</h3><div class="seg" role="group" aria-label="Team">${team}</div></section>
    <section class="fgroup">
      <label class="flabel" for="f-year">Released</label>
      <select id="f-year" class="select" data-filter="year"><option value="">Any year</option>${yearOptions}</select>
    </section>
    <button type="button" class="btn reset" id="f-reset" data-clear="all">Reset filters</button>
    <p class="hint">Search matches names, weapons, collections and cases. Nicknames work (<code>deagle</code>, <code>bfk</code>). Type <code>#44</code> to look up a paint index.</p>`;

  const activeCount = activeSkinChips().filter((c) => c.clear !== 'q').length;
  const badge = $('#filters-count');
  badge.hidden = !activeCount;
  badge.textContent = activeCount;

  if (focusId) document.getElementById(focusId)?.focus();
}

function renderContext() {
  const el = $('#context');
  let html = '';
  if (state.col && data.collections[state.col]) {
    const c = data.collections[state.col];
    const crates = c.crates.filter((k) => data.crates[k]);
    html = contextBox(c.image, c.name, [
      collectionKindLabel(state.col),
      c.releaseDate ? `Released ${fmtDate(c.releaseDate)}` : null,
      `${c.skins.length} skins`,
      crates.length ? `${crates.length === 1 ? data.crates[crates[0]].name : `${crates.length} containers`}` : null,
    ]);
  } else if (state.crate && data.crates[state.crate]) {
    const c = data.crates[state.crate];
    html = contextBox(c.image, c.name, [
      CRATE_TYPES.find((t) => t.key === c.type)?.single,
      c.firstSaleDate ? `Released ${fmtDate(c.firstSaleDate)}` : c.year,
      `${c.skins.length} skins`,
    ]);
  }
  el.innerHTML = html;
  el.hidden = !html;
}

function contextBox(image, title, bits) {
  const img = imageUrl(image, '256fx256f');
  return `<div class="context">${img ? `<img src="${esc(img)}" alt="" width="96" height="72" decoding="async">` : ''}<div><h2>${esc(title)}</h2><p>${bits.filter(Boolean).map(esc).join(' · ')}</p></div></div>`;
}

function sourceLabel(s) {
  const year = s.released ? ` · ${s.released.slice(0, 4)}` : '';
  if (s.collections.length) return stripThe(data.collections[s.collections[0]].name) + year;
  if (s.crates.length === 1) return data.crates[s.crates[0]].name + year;
  if (s.crates.length > 1) return `${s.crates.length} cases${year}`;
  return 'No drop source';
}

function skinCard(s, { mini = false, current = false } = {}) {
  const r = rarityOf(s);
  const { weapon, finish } = splitName(s);
  const img = imageUrl(s.image, mini ? '256fx256f' : '360fx360f');
  const tags = mini
    ? ''
    : `${s.stattrak ? '<span class="tag st" title="StatTrak™ available">ST</span>' : ''}${s.souvenir ? '<span class="tag sv" title="Souvenir available">SV</span>' : ''}`;
  return `<a class="card" href="${esc(toHash({ ...state, skin: s.id }))}" data-skin="${esc(s.id)}" style="--c:${esc(r.color)}"${current ? ' aria-current="true"' : ''}>
    <div class="card-media">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async" width="360" height="270">` : '<div class="img-missing">No image</div>'}${tags ? `<div class="card-tags">${tags}</div>` : ''}</div>
    <div class="card-body">
      <div class="card-weapon">${esc(weapon)}</div>
      <div class="card-title" title="${esc(displayName(s))}">${esc(finish)}${s.phase ? ` <span class="phase">${esc(s.phase)}</span>` : ''}</div>
      <div class="card-meta">${esc(mini ? r.name : sourceLabel(s))}</div>
    </div>
  </a>`;
}

// ---------- Collections & cases views ----------
function collectionKind(key) {
  const types = new Set(data.collections[key].crates.map((k) => data.crates[k]?.type));
  if (types.has('Case') || types.has('Terminal')) return 'case';
  if (types.has('Souvenir')) return 'map';
  return 'other';
}
const collectionKindLabel = (key) => COLLECTION_KINDS.find((k) => k.key === collectionKind(key)).long;

function matchesName(name, q) {
  const tokens = q.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const hay = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ');
  const compactHay = hay.replace(/ /g, '');
  return tokens.every((t) => hay.includes(t) || compactHay.includes(t));
}

function groupSort(dateOf) {
  const sort = GROUP_SORTS.some((o) => o.key === state.sort) ? state.sort : 'newest';
  const cmp = {
    newest: (a, b) => (dateOf(b[1]) || '').localeCompare(dateOf(a[1]) || '') || collator.compare(a[1].name, b[1].name),
    oldest: (a, b) => (dateOf(a[1]) || '9999').localeCompare(dateOf(b[1]) || '9999') || collator.compare(a[1].name, b[1].name),
    name: (a, b) => collator.compare(stripThe(a[1].name), stripThe(b[1].name)),
    size: (a, b) => b[1].skins.length - a[1].skins.length || collator.compare(a[1].name, b[1].name),
  }[sort];
  return { sort, cmp };
}

function rarityBar(skinIds) {
  const counts = countBy(skinIds.map((id) => skinById.get(id)).filter(Boolean), (s) => s.rarity);
  return `<div class="raritybar" aria-hidden="true">${Object.entries(data.rarities)
    .filter(([k]) => counts.get(k))
    .map(([k, r]) => `<span style="--c:${esc(r.color)};flex-grow:${counts.get(k)}" title="${esc(r.name)}: ${counts.get(k)}"></span>`)
    .join('')}</div>`;
}

function groupCard(href, image, kind, title, meta, skinIds) {
  const img = imageUrl(image, '256fx256f');
  return `<a class="card ccard" href="${esc(href)}">
    <div class="card-media">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async" width="256" height="192">` : '<div class="img-missing">No image</div>'}</div>
    <div class="card-body">
      <div class="kind">${esc(kind)}</div>
      <div class="card-title">${esc(title)}</div>
      <div class="card-meta">${esc(meta)}</div>
      ${rarityBar(skinIds)}
    </div>
  </a>`;
}

function segmentChips(attr, options, current, counts) {
  const all = [{ key: '', label: 'All' }, ...options];
  return all
    .map((o) => `<button type="button" class="chip" data-${attr}="${esc(o.key)}" aria-pressed="${current === o.key}">${esc(o.label)}<span class="n">${fmtNum(counts.get(o.key) || 0)}</span></button>`)
    .join('');
}

function renderCollectionsView() {
  const q = state.q.trim();
  const named = Object.entries(data.collections).filter(([, c]) => !q || matchesName(c.name, q));
  const counts = countBy(named, ([k]) => ['', collectionKind(k)]);
  const items = named.filter(([k]) => !state.kind || collectionKind(k) === state.kind);
  const { sort, cmp } = groupSort((c) => c.releaseDate);
  items.sort(cmp);

  renderSort(GROUP_SORTS, sort);
  $('#count').innerHTML = `<strong>${fmtNum(items.length)}</strong> ${items.length === 1 ? 'collection' : 'collections'}`;
  $('#active-chips').innerHTML = segmentChips('kind', COLLECTION_KINDS, state.kind, counts);
  $('#context').hidden = true;
  setList(items, ([k, c]) => {
    const crates = c.crates.filter((x) => data.crates[x]);
    const source = crates.length === 1 ? data.crates[crates[0]].name : crates.length ? `${crates.length} souvenir packages` : '';
    return groupCard(
      hrefFor({ col: k, sort: 'rarity-desc' }),
      c.image,
      `${COLLECTION_KINDS.find((x) => x.key === collectionKind(k)).long}${c.releaseDate ? ` · ${c.releaseDate.slice(0, 4)}` : ''}`,
      c.name,
      [`${c.skins.length} skins`, source].filter(Boolean).join(' · '),
      c.skins,
    );
  }, true);
}

function renderCasesView() {
  const q = state.q.trim();
  const named = Object.entries(data.crates).filter(([, c]) => !q || matchesName(c.name, q));
  const counts = countBy(named, ([, c]) => ['', c.type]);
  const items = named.filter(([, c]) => !state.type || c.type === state.type);
  const { sort, cmp } = groupSort(crateDateKey);
  items.sort(cmp);

  renderSort(GROUP_SORTS, sort);
  $('#count').innerHTML = `<strong>${fmtNum(items.length)}</strong> ${items.length === 1 ? 'case or package' : 'cases & packages'}`;
  $('#active-chips').innerHTML = segmentChips('type', CRATE_TYPES.filter((t) => counts.get(t.key)), state.type, counts);
  $('#context').hidden = true;
  setList(items, ([k, c]) => {
    const type = CRATE_TYPES.find((t) => t.key === c.type);
    const skins = c.skins.map((id) => skinById.get(id)).filter(Boolean);
    const special = skins.filter((s) => s.category === 'Knives' || s.category === 'Gloves').length;
    return groupCard(
      hrefFor({ crate: k, sort: 'rarity-desc' }),
      c.image,
      `${type ? type.single : c.type}${c.year ? ` · ${c.year}` : ''}`,
      c.name,
      [`${skins.length - special} skins`, special ? `${special} rare specials` : ''].filter(Boolean).join(' · '),
      c.skins,
    );
  }, true);
}

// ---------- Detail dialog ----------
function renderDetail() {
  const dlg = $('#detail');
  const s = state.skin ? skinById.get(state.skin) : null;
  if (!s) {
    if (dlg.open) dlg.close();
    openSkinId = null;
    document.title = 'CS2 Skin DB';
    return;
  }
  if (openSkinId === s.id && dlg.open) return;
  openSkinId = s.id;
  const wasOpen = dlg.open;
  const navFocus = wasOpen && document.activeElement?.closest('[data-nav]')?.getAttribute('aria-label');
  dlg.innerHTML = detailHtml(s);
  if (!wasOpen) dlg.showModal();
  const scroller = $('.d-scroll', dlg);
  if (scroller) scroller.scrollTop = 0;
  const focusTarget = navFocus ? dlg.querySelector(`[aria-label="${navFocus}"]:not([disabled])`) : null;
  (focusTarget || (!wasOpen || !dlg.contains(document.activeElement) ? $('[data-close]', dlg) : null))?.focus({ preventScroll: true });
  document.title = `${displayName(s)} · CS2 Skin DB`;
}

function floatBar(s) {
  if (typeof s.minFloat !== 'number') {
    return `<p class="desc">Vanilla knives have no finish, so they have no float value or wear.</p>`;
  }
  const segs = data.wearTiers
    .map((t) => `<span class="${s.wears.includes(t.code) ? 'on' : ''}" style="width:${(t.max - t.min) * 100}%" title="${esc(t.name)}">${t.code}</span>`)
    .join('');
  const left = s.minFloat * 100;
  const width = Math.max((s.maxFloat - s.minFloat) * 100, 0.6);
  return `<div class="floatbar">
      <div class="floatbar-track" role="img" aria-label="Float range ${fmtFloat(s.minFloat)} to ${fmtFloat(s.maxFloat)}">${segs}<div class="floatbar-range" style="left:${left}%;width:${width}%"></div></div>
      <div class="floatbar-legend"><span>0.00</span><span>${fmtFloat(s.minFloat)} – ${fmtFloat(s.maxFloat)}</span><span>1.00</span></div>
    </div>`;
}

function miniGrid(skins, currentId) {
  return `<div class="minigrid">${skins.map((x) => skinCard(x, { mini: true, current: x.id === currentId })).join('')}</div>`;
}

function crateLinks(s) {
  const groups = CRATE_TYPES.map((t) => ({ t, crates: s.crates.filter((k) => data.crates[k]?.type === t.key) })).filter((g) => g.crates.length);
  return groups
    .map(({ t, crates }) => {
      const sorted = crates.sort((a, b) => crateDateKey(data.crates[a]).localeCompare(crateDateKey(data.crates[b])) || collator.compare(data.crates[a].name, data.crates[b].name));
      const links = sorted.map((k) => {
        const c = data.crates[k];
        return `<a class="chip" href="${esc(hrefFor({ crate: k, sort: 'rarity-desc' }))}">${esc(c.name)}${c.year && !c.name.includes(c.year) ? ` <small>${esc(c.year)}</small>` : ''}</a>`;
      });
      const head = `<h3>${esc(t.label)} <span class="n">(${crates.length})</span></h3>`;
      if (links.length > 8) {
        return `<div>${head}<div class="links">${links.slice(0, 6).join('')}</div><details class="more"><summary>Show ${links.length - 6} more</summary><div class="links">${links.slice(6).join('')}</div></details></div>`;
      }
      return `<div>${head}<div class="links">${links.join('')}</div></div>`;
    })
    .join('');
}

function detailHtml(s) {
  const r = rarityOf(s);
  const w = data.weapons[s.weapon];
  const idx = skinNav.indexOf(s.id);
  const prev = idx > 0 ? skinNav[idx - 1] : null;
  const next = idx !== -1 && idx < skinNav.length - 1 ? skinNav[idx + 1] : null;
  const yesNo = (v) => (v ? '<span class="yes">Available</span>' : '<span class="no">Not available</span>');

  const facts = [
    ['Weapon', `<a href="${esc(hrefFor({ weapon: s.weapon }))}">${esc(w?.name || s.weapon)}</a>`],
    ['Finish', s.finish ? `<a href="${esc(hrefFor({ q: s.finish }))}">${esc(s.finish)}</a>` : 'Vanilla (no finish)'],
    s.phase ? ['Phase', esc(s.phase)] : null,
    ['Rarity', `<a href="${esc(hrefFor({ rarity: [s.rarity] }))}">${esc(r.name)}</a>`],
    ['Category', `<a href="${esc(hrefFor({ cat: [catKey(s.category)] }))}">${esc(s.category)}</a>`],
    ['Team', esc(TEAM_LABELS[s.team] || s.team)],
    ['StatTrak™', yesNo(s.stattrak)],
    ['Souvenir', yesNo(s.souvenir)],
    ['Released', s.released ? `<span title="Release date of the earliest collection or case that contains this skin">${esc(fmtDate(s.released))}</span>` : '<span class="no">Unknown</span>'],
    s.paintIndex != null ? ['Paint index', `<code>${s.paintIndex}</code>`] : null,
    s.finishCode ? ['Finish code', `<code>${esc(s.finishCode)}</code>`] : null,
    w?.defIndex != null ? ['Weapon def. index', `<code>${w.defIndex}</code>`] : null,
    s.legacyModel ? ['Model', 'Uses the legacy CS:GO weapon model'] : null,
  ].filter(Boolean);

  const sections = [];

  const cols = s.collections
    .map((k) => {
      const c = data.collections[k];
      return `<a class="chip" href="${esc(hrefFor({ col: k, sort: 'rarity-desc' }))}">${esc(c.name)}${c.releaseDate ? ` <small>${esc(fmtDate(c.releaseDate))}</small>` : ''}</a>`;
    })
    .join('');
  const crates = crateLinks(s);
  if (cols || crates) {
    sections.push(`<section class="d-section"><h3>Where it comes from</h3>${cols ? `<div class="links">${cols}</div>` : ''}${crates ? `<div class="sources">${crates}</div>` : ''}</section>`);
  } else {
    sections.push(`<section class="d-section"><h3>Where it comes from</h3><p class="desc">This item is in the game files but isn't linked to any current collection, case or package.</p></section>`);
  }

  if (s.notes.length) {
    sections.push(`<section class="d-section"><h3>Notes</h3><ul class="notes">${s.notes
      .map((n) => `<li>${esc(n.text)}${safeUrl(n.source) ? ` <a href="${esc(n.source)}" target="_blank" rel="noopener noreferrer">Source</a>` : ''}</li>`)
      .join('')}</ul></section>`);
  }

  if (s.phase) {
    const phases = data.skins.filter((x) => x.weapon === s.weapon && x.finish === s.finish && x.phase);
    if (phases.length > 1) sections.push(`<section class="d-section"><h3>All phases</h3>${miniGrid(phases, s.id)}</section>`);
  }

  if (s.collections.length) {
    const c = data.collections[s.collections[0]];
    const members = c.skins.map((id) => skinById.get(id)).filter(Boolean).sort((a, b) => rarityOf(b).order - rarityOf(a).order || collator.compare(a.name, b.name));
    if (members.length > 1) sections.push(`<section class="d-section"><h3>${esc(c.name)} <span class="n">(${members.length})</span></h3>${miniGrid(members, s.id)}</section>`);
  }

  if (s.finish) {
    // One entry per weapon; for Doppler-style finishes, prefer the same phase.
    const seen = new Set();
    const same = data.skins.filter((x) => {
      if (x.finish !== s.finish || x.weapon === s.weapon || seen.has(x.weapon)) return false;
      if (s.phase && x.phase && x.phase !== s.phase) return false;
      seen.add(x.weapon);
      return true;
    });
    if (same.length) {
      const shown = same.slice(0, 24);
      sections.push(`<section class="d-section"><h3>“${esc(s.finish)}” on other weapons <span class="n">(${same.length})</span></h3>${miniGrid(shown, s.id)}${same.length > shown.length ? `<p class="hint"><a href="${esc(hrefFor({ q: s.finish }))}">See all ${same.length}</a></p>` : ''}</section>`);
    }
  }

  const img = imageUrl(s.image);
  return `
    <div class="d-head">
      <div class="d-head-text">
        <div class="d-eyebrow">
          <a href="${esc(hrefFor({ cat: [catKey(s.category)] }))}">${esc(s.category)}</a>
          <a href="${esc(hrefFor({ weapon: s.weapon }))}">${esc(w?.name || '')}</a>
        </div>
        <h2 id="detail-title">${esc(s.name)}${s.phase ? ` <span class="phase">${esc(s.phase)}</span>` : ''}</h2>
      </div>
      <div class="d-actions">
        <button type="button" class="icon-btn" data-nav="${esc(prev || '')}" aria-label="Previous skin" title="Previous (←)"${prev ? '' : ' disabled'}>${ICONS.prev}</button>
        <button type="button" class="icon-btn" data-nav="${esc(next || '')}" aria-label="Next skin" title="Next (→)"${next ? '' : ' disabled'}>${ICONS.next}</button>
        <button type="button" class="icon-btn" data-copy aria-label="Copy link to this skin" title="Copy link">${ICONS.link}</button>
        <button type="button" class="icon-btn" data-close aria-label="Close" title="Close (Esc)">${ICONS.x}</button>
      </div>
    </div>
    <div class="d-scroll">
      <div class="d-body">
        <div class="d-media" style="--c:${esc(r.color)}">${img ? `<img src="${esc(img)}" alt="${esc(displayName(s))}" decoding="async" width="512" height="384">` : '<div class="img-missing">No image</div>'}</div>
        <div class="d-info">
          <div class="chips">
            <span class="rarity-pill" style="--c:${esc(r.color)}"><span class="dot" style="--c:${esc(r.color)}"></span>${esc(r.name)}</span>
            ${s.stattrak ? '<span class="tag st">StatTrak™</span>' : ''}
            ${s.souvenir ? '<span class="tag sv">Souvenir</span>' : ''}
          </div>
          <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
          <div>
            <h3 class="visually-hidden">Float range</h3>
            ${floatBar(s)}
          </div>
          ${s.description || s.flavor ? `<div>${s.description ? `<p class="desc">${esc(s.description)}</p>` : ''}${s.flavor ? `<p class="flavor">${esc(s.flavor)}</p>` : ''}</div>` : ''}
        </div>
      </div>
      ${sections.join('')}
    </div>`;
}

function closeDetail() {
  if (detailPushed) {
    // Close right away; the history entry pushed when opening is popped after.
    detailPushed = false;
    state = { ...state, skin: '' };
    renderDetail();
    history.back();
  } else {
    update({ skin: '' });
  }
}

// ---------- Events ----------
function toggleIn(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function clearFilter(token) {
  if (token === 'all') {
    const keep = { view: state.view, sort: state.sort === 'relevance' ? '' : state.sort };
    state = { ...EMPTY_FILTERS, ...keep };
    $('#q').value = '';
    return update({});
  }
  const [k, v] = token.split(':');
  if (v !== undefined) return update({ [k]: state[k].filter((x) => x !== v) });
  if (k === 'q') $('#q').value = '';
  const empty = Array.isArray(state[k]) ? [] : typeof state[k] === 'boolean' ? false : '';
  return update({ [k]: empty });
}

function bindEvents() {
  window.addEventListener('hashchange', () => {
    detailPushed = false;
    state = readState();
    render();
  });

  let timer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    const value = e.target.value;
    timer = setTimeout(() => update({ q: value }), 110);
  });
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    update({ q: $('#q').value });
    if (window.matchMedia('(max-width: 720px)').matches) $('#q').blur();
  });

  $('#sort').addEventListener('change', (e) => update({ sort: e.target.value }));

  const filters = $('#filters-body');
  filters.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const group = t.dataset.toggle;
      const next = toggleIn(state[group], t.dataset.value);
      const patch = { [group]: next };
      if (group === 'cat' && state.weapon && next.length && !next.includes(catKey(data.weapons[state.weapon]?.category || ''))) patch.weapon = '';
      return update(patch);
    }
    const team = e.target.closest('[data-team]');
    if (team) return update({ team: team.dataset.team });
    const clear = e.target.closest('[data-clear]');
    if (clear) return clearFilter(clear.dataset.clear);
  });
  filters.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-filter]');
    if (sel) return update({ [sel.dataset.filter]: sel.value });
    const chk = e.target.closest('[data-check]');
    if (chk) return update({ [chk.dataset.check]: chk.checked });
  });

  $('#active-chips').addEventListener('click', (e) => {
    const clear = e.target.closest('[data-clear]');
    if (clear) return clearFilter(clear.dataset.clear);
    const kind = e.target.closest('[data-kind]');
    if (kind) return update({ kind: kind.dataset.kind });
    const type = e.target.closest('[data-type]');
    if (type) return update({ type: type.dataset.type });
  });

  // Skin cards open the detail view without a full re-render.
  document.addEventListener('click', (e) => {
    const card = e.target.closest('a[data-skin]');
    if (!card || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const dlg = $('#detail');
    if (dlg.open) return update({ skin: card.dataset.skin });
    detailPushed = true;
    update({ skin: card.dataset.skin }, { push: true });
  });

  const dlg = $('#detail');
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDetail();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) return closeDetail();
    if (e.target.closest('[data-close]')) return closeDetail();
    const nav = e.target.closest('[data-nav]');
    if (nav && nav.dataset.nav) return update({ skin: nav.dataset.nav });
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const url = location.href;
      const done = () => {
        copy.title = 'Copied!';
        copy.classList.add('copied');
        setTimeout(() => copy.classList.remove('copied'), 1200);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => {});
    }
    // Links to filtered views leave the dialog; drop the pushed entry flag.
    if (e.target.closest('a[href^="#/"]:not([data-skin])')) detailPushed = false;
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'select' || tag === 'textarea';
    if (dlg.open) {
      if (typing) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const btn = dlg.querySelector(`[data-nav][aria-label^="${e.key === 'ArrowLeft' ? 'Previous' : 'Next'}"]`);
        if (btn && btn.dataset.nav) {
          e.preventDefault();
          update({ skin: btn.dataset.nav });
        }
      }
      return;
    }
    if (e.key === '/' && !typing) {
      e.preventDefault();
      $('#q').focus();
      $('#q').select();
    } else if (e.key === 'Escape' && $('#filters').classList.contains('open')) {
      toggleDrawer(false);
    }
  });

  // Mobile filter drawer.
  $('#filters-open').addEventListener('click', () => toggleDrawer(true));
  $('#filters-close').addEventListener('click', () => toggleDrawer(false));
  $('#scrim').addEventListener('click', () => toggleDrawer(false));

  // Theme toggle.
  $('#theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('cs2db-theme', next);
    } catch (err) {
      /* storage unavailable */
    }
  });

  // Broken or blocked images fall back to a placeholder.
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (img.tagName !== 'IMG' || img.dataset.failed) return;
      img.dataset.failed = '1';
      const ph = document.createElement('div');
      ph.className = 'img-missing';
      ph.textContent = 'Image unavailable';
      img.replaceWith(ph);
    },
    true,
  );

  new IntersectionObserver((obs) => obs[0].isIntersecting && appendPage(), { rootMargin: '600px' }).observe($('#sentinel'));
}

function toggleDrawer(open) {
  $('#filters').classList.toggle('open', open);
  $('#scrim').hidden = !open;
  if (open) $('#filters-close').focus();
  else $('#filters-open').focus();
}

// ---------- Boot ----------
async function boot() {
  bindEvents();
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $('#grid').innerHTML = `<p class="empty"><strong>Couldn't load the database.</strong>${esc(err.message)}. If you opened the file directly, serve the folder over HTTP (see README).</p>`;
    return;
  }
  skinById = new Map(data.skins.map((s) => [s.id, s]));
  entries = data.skins.map((skin) => ({ skin, entry: buildEntry(skin, data) }));
  if (data.generatedAt) $('#generated').textContent = `Data updated ${fmtDate(data.generatedAt.slice(0, 10))}.`;
  state = readState();
  render();
}

boot();
