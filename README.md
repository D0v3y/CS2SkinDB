# CS2 Skin DB

A searchable database of every Counter-Strike 2 weapon, knife and glove skin. It has no prices, no market listings and no trading links, just the items and their in-game details.

It is a static site with no backend, no build step and no dependencies. Open it, type, filter.

## What's in it

**2,246 skins** across 63 weapons, 94 collections and 196 cases, terminals and souvenir packages. Each skin entry has:

| Field | Notes |
| --- | --- |
| Name, weapon, finish, Doppler/Gamma Doppler phase | |
| Rarity and category | Consumer → Covert, Extraordinary (gloves), Contraband |
| Float range and possible wears | Shown as a bar over the FN / MW / FT / WW / BS bands |
| StatTrak™ and Souvenir availability | Souvenir is derived from the souvenir packages that contain the skin |
| Team | CT, T or both |
| Collections and every case or package it drops from | Linked, so one click shows the whole collection |
| Approximate release date | Date of the earliest collection or case that contains it |
| Paint index, finish code, weapon def. index | Useful for workshop and config work |
| In-game description and flavor text | |
| Special notes | e.g. why the M4A4 Howl became Contraband |

## Searching

- Search matches skin names, weapons, finishes, phases, collections, cases and rarities. Every word has to match, and matches in the skin's own name rank highest.
- Punctuation is optional: `ak47 redline` and `m4a1s hot rod` both work.
- Common nicknames work: `deagle`, `bfk`, `scout`, `krieg`, `dualies`, `zeus`.
- `#44` looks up a paint index (here, Case Hardened).
- Press `/` to jump to the search box. In the detail view, `←` / `→` step through the current results and `Esc` closes.

Filters: category, weapon, rarity, collection, case/package, which wear tiers exist, StatTrak™, Souvenir, has a drop source, team and release year. Sort by newest, oldest, rarity, weapon or finish name.

The **Collections** and **Cases** tabs list every collection and container with release dates and a rarity breakdown. Clicking one opens its skins.

Every view, filter and open skin is in the URL, so any search can be bookmarked or shared.

## Loadouts

The **Loadouts** tab lets you plan what you'd equip. As in the game, a loadout has a CT side and a T side. Each side has one knife, one pair of gloves, and one skin per weapon that side can use: CT gets the M4s and the USP-S, T gets the AK-47 and the Glock, and so on.

- **Build one slot by slot:** click a slot to open a picker for that weapon, with a name filter and a knife/glove type filter. Choose **Default** to clear the slot.
- **Add while browsing:** every skin's detail view has an **Add to loadout** section with one button per side it can be used on. It also shows what that slot currently holds.
- **Copy shared slots** copies the knife, gloves and both-sides weapons from one side to the other.
- **Share link** copies a URL that holds the whole loadout. Whoever opens it sees a read-only copy and can save it.
- **Export / Import** saves and loads JSON files, for backups or moving to another device.

Loadouts are saved in the browser's `localStorage`. They stay on that device and browser and are never uploaded. Items are stored by the game's own identity (`<weapon def index>-<paint index>`, e.g. `7-282` for AK-47 | Redline), so saved loadouts and links keep working when the data is refreshed.

## Running locally

The page loads `data/skins.json` with `fetch`, so serve it over HTTP instead of opening the file directly:

```sh
npm start            # http://localhost:8080 (zero-dependency Node server)
# or: python3 -m http.server 8080
```

Requires Node 18+ for the scripts. Nothing to install.

## Updating the data

```sh
npm run build:data                      # download the latest upstream data
node scripts/build-data.mjs --from DIR  # or use skins.json / collections.json / crates.json from DIR
npm test
```

The committed `data/skins.json` is a snapshot, with one record per line so diffs stay readable.

## Deploying

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to `main`. It also rebuilds the data from upstream every Monday, so new cases appear without a commit. To turn it on, go to **Settings → Pages** and set **Source** to **GitHub Actions**.

Any static host works: upload `index.html`, `assets/` and `data/`.

## Where the data comes from

Item data comes from [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API) (MIT), which is generated from the CS2 game files. `scripts/build-data.mjs` downloads it and `scripts/lib/transform.mjs` reshapes it:

- **Market fields are dropped.** Market hash names, rental flags and similar fields are never copied. A test checks this.
- **Souvenir availability is derived** from souvenir package contents, because the upstream `souvenir` flag also marks plain case skins.
- **Wear tiers are computed** from the float range.
- **Dates are filled in where possible.** Terminals take their collection's release date. Souvenir packages take the year from the event name.
- **IDs are shortened.** Weapons are keyed by name (`ak-47`, `karambit`), because upstream uses two different internal IDs for the same knife.

Images are loaded from Valve's Steam image CDN (and a few from the upstream image tracker) and are © Valve. This project is not affiliated with Valve.

### Known quirks

- 120 knife entries (six classic finishes such as Blue Steel and Case Hardened, on every knife) appear twice. The second copy is a separate paint kit in the game files that isn't linked to any case. These are shown with "No drop source" and can be hidden with the **Has a drop source** filter.
- Release dates are approximate: a skin added to an existing collection later shows the collection's date.

## Project layout

```
index.html               page shell
assets/app.js            UI: routing, filters, rendering, detail view
assets/search.js         search index and scoring (shared with tests)
assets/loadouts-store.js loadout model, validation, storage, share links, import/export
assets/styles.css        styles, light and dark themes
data/skins.json          generated dataset
scripts/build-data.mjs   fetches upstream data and writes data/skins.json
scripts/lib/transform.mjs  pure transform from upstream to our schema
scripts/serve.mjs        local static server
tests/                   node:test suites (npm test)
```

### `data/skins.json` schema

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "ISO timestamp",
  "counts": { "skins": 2246, ... },
  "wearTiers":  [{ "code": "FN", "name": "Factory New", "min": 0, "max": 0.07 }, ...],
  "categories": ["Rifles", "Pistols", ...],
  "rarities":   { "covert": { "name": "Covert", "color": "#eb4b4b", "order": 6 }, ... },
  "weapons":    { "ak-47": { "name": "AK-47", "category": "Rifles", "defIndex": 7 }, ... },
  "collections": { "set-community-3": { "name", "releaseDate", "image", "crates": [], "skins": [] } },
  "crates":     { "4017": { "name", "type", "firstSaleDate", "year", "image", "skins": [] } },
  "skins": [{
    "id", "name", "weapon", "finish", "finishCode", "paintIndex", "phase", "rarity", "category",
    "minFloat", "maxFloat", "wears", "stattrak", "souvenir", "team", "legacyModel", "released",
    "description", "flavor", "collections", "crates", "notes", "image"
  }]
}
```
