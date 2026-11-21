#!/usr/bin/env node
// Builds data/skins.json from the open CSGO-API dataset (extracted from the
// game files). Market fields are never copied.
//
//   node scripts/build-data.mjs              # download from upstream
//   node scripts/build-data.mjs --from DIR   # use skins.json, collections.json, crates.json in DIR

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from './lib/transform.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'skins.json');
const UPSTREAM = process.env.CS2_DATA_BASE_URL || 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en';
const FILES = ['skins', 'collections', 'crates'];

function parseArgs(argv) {
  const args = { from: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') args.from = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/build-data.mjs [--from DIR]');
      process.exit(0);
    }
  }
  return args;
}

async function load(name, from) {
  if (from) return JSON.parse(await readFile(path.join(from, `${name}.json`), 'utf8'));
  const url = `${UPSTREAM}/${name}.json`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 4) throw new Error(`Failed to download ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

// One record per line: compact, but still produces readable git diffs.
function serialize(data) {
  const lines = ['{'];
  const entries = Object.entries(data);
  entries.forEach(([key, value], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    if (Array.isArray(value) && value.length && typeof value[0] === 'object') {
      lines.push(`  ${JSON.stringify(key)}: [`);
      value.forEach((v, j) => lines.push(`    ${JSON.stringify(v)}${j < value.length - 1 ? ',' : ''}`));
      lines.push(`  ]${comma}`);
    } else if (value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).some((v) => v && typeof v === 'object')) {
      const inner = Object.entries(value);
      lines.push(`  ${JSON.stringify(key)}: {`);
      inner.forEach(([k, v], j) => lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(v)}${j < inner.length - 1 ? ',' : ''}`));
      lines.push(`  }${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

async function main() {
  const { from } = parseArgs(process.argv.slice(2));
  console.log(from ? `Reading upstream files from ${from}` : `Downloading from ${UPSTREAM}`);
  const [skins, collections, crates] = await Promise.all(FILES.map((f) => load(f, from)));

  const data = transform(
    { skins, collections, crates },
    {
      source: {
        name: 'ByMykel/CSGO-API',
        url: 'https://github.com/ByMykel/CSGO-API',
        license: 'MIT',
      },
    },
  );

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, serialize(data));
  const c = data.counts;
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${c.skins} skins, ${c.weapons} weapons, ${c.collections} collections, ${c.crates} cases/packages`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
