// Build a population-ranked city seed (city,state,zip,county,population) from open data.
//
//   ranking      : plotly us-cities-top-1k.csv  (City, State, Population)  [fetched]
//   zip + county : GeoNames US postal data (US.txt, TSV)                   [local file]
//
// GeoNames is authoritative and complete; download once:
//   curl -sL https://download.geonames.org/export/zip/US.zip -o US.zip && unzip US.zip US.txt
//
// Usage:
//   node scripts/build-seed.mjs --geonames /path/to/US.txt --top 500 --out scripts/seed-top500.csv

import { readFileSync, writeFileSync } from 'node:fs';

const arg = (name, def) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; };
const TOP = parseInt(arg('--top', '500'), 10);
const OUT = arg('--out', 'scripts/seed-top500.csv');
const GEONAMES = arg('--geonames', null);
const TOP1K = 'https://raw.githubusercontent.com/plotly/datasets/master/us-cities-top-1k.csv';

if (!GEONAMES) { console.error('Pass --geonames /path/to/US.txt (see header for download).'); process.exit(1); }

const norm = (s) => s.toLowerCase().replace(/\bsaint\b/g, 'st').replace(/\bfort\b/g, 'ft').replace(/[^a-z0-9]/g, '');
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// ---- GeoNames: (normCity, abbr) -> {repZip, county}, plus stateFull -> abbr ----
// Representative ZIP = the one nearest the city's centroid. The naive "lowest ZIP"
// often lands on a PO-box/government ZIP that geocodes to state level only and misses
// local rates (e.g. Montgomery AL came back 4% instead of ~10%); the centroid ZIP is a
// real central delivery ZIP that carries the full county/city/district stack.
const fullToAbbr = {};
const cityData = new Map(); // key -> [{zip, county, lat, lng}]
for (const line of readFileSync(GEONAMES, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 11) continue;
  const zip = f[1], place = f[2], stateName = f[3], abbr = f[4], county = f[5];
  const lat = parseFloat(f[9]), lng = parseFloat(f[10]);
  if (!/^\d{5}$/.test(zip) || !isFinite(lat) || !isFinite(lng)) continue;
  if (stateName && abbr) fullToAbbr[stateName.toLowerCase()] = abbr;
  const key = norm(place) + '|' + abbr;
  let arr = cityData.get(key);
  if (!arr) cityData.set(key, (arr = []));
  arr.push({ zip, county: county || '', lat, lng });
}
const cityZip = new Map();
for (const [key, zips] of cityData) {
  const n = zips.length;
  const clat = zips.reduce((s, z) => s + z.lat, 0) / n;
  const clng = zips.reduce((s, z) => s + z.lng, 0) / n;
  let best = zips[0], bestD = Infinity;
  for (const z of zips) {
    const d = (z.lat - clat) ** 2 + (z.lng - clng) ** 2;
    if (d < bestD) { bestD = d; best = z; }
  }
  cityZip.set(key, { zip: best.zip, county: best.county });
}

// ---- plotly: ranking ----
const text = await (await fetch(TOP1K)).text();
const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean).slice(1);
const ranked = lines
  .map((l) => { const c = l.split(','); return { city: c[0], stateFull: c[1], population: parseInt(c[2], 10) || 0 }; })
  .sort((a, b) => b.population - a.population);

// ---- join ----
const rows = [];
const unmatched = [];
for (const c of ranked) {
  const abbr = c.stateFull.length === 2 ? c.stateFull.toUpperCase() : fullToAbbr[c.stateFull.toLowerCase()];
  const hit = abbr && cityZip.get(norm(c.city) + '|' + abbr);
  if (!hit) { unmatched.push(`${c.city}, ${c.stateFull}`); continue; }
  rows.push({ city: c.city, state: abbr, zip: hit.zip, county: hit.county, population: c.population });
  if (rows.length >= TOP) break;
}

const cols = ['city', 'state', 'zip', 'county', 'population'];
writeFileSync(OUT, cols.join(',') + '\n' + rows.map((r) => cols.map((k) => csvCell(r[k])).join(',')).join('\n') + '\n');
console.error(`Wrote ${rows.length} cities to ${OUT}. Skipped ${unmatched.length} name-mismatches (consolidated govts etc.)`);
if (unmatched.length) console.error('  e.g. ' + unmatched.slice(0, 6).join(' · '));
