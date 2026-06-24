// Turn a list of old 404 URLs (/resources/{place}-{state}-sales-tax) into:
//   data/seed-404.csv      — city,state,zip,county,population for the calculator pipeline
//   data/redirects-404.csv — old_path,new_path to 301 the dead URLs onto the new pages
//
// Non-city links (sales-tax-compliance, blog posts, state-only pages, etc.) are skipped.
// City ZIP + county come from GeoNames (US.txt); tiny places with no distinct ZIP in the
// dataset are reported as unmatched so they can be handled separately.
//
// Usage:
//   node scripts/seed-from-404s.mjs <404-list.txt> <US.txt> [--prefix /sales-tax-calculator]

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const [listPath, geoPath] = args.filter((a) => !a.startsWith('--'));
const prefix = (() => { const i = args.indexOf('--prefix'); return i >= 0 ? args[i + 1] : '/sales-tax-calculator'; })();
if (!listPath || !geoPath) { console.error('Usage: node scripts/seed-from-404s.mjs <404-list.txt> <US.txt> [--prefix /path]'); process.exit(1); }

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = (s) => s.toLowerCase().replace(/\bsaint\b/g, 'st').replace(/\bfort\b/g, 'ft').replace(/[^a-z0-9]/g, '');
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const stateSlugToAbbr = {};
for (const [abbr, name] of Object.entries(STATE_NAMES)) stateSlugToAbbr[kebab(name)] = abbr;
const stateSlugs = Object.keys(stateSlugToAbbr).sort((a, b) => b.length - a.length); // longest first (multi-word)

// GeoNames: (normCity, abbr) -> representative {zip, county, place} via centroid
const cityData = new Map();
for (const line of readFileSync(geoPath, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 11) continue;
  const zip = f[1], place = f[2], abbr = f[4], county = f[5], lat = parseFloat(f[9]), lng = parseFloat(f[10]);
  if (!/^\d{5}$/.test(zip) || !isFinite(lat) || !isFinite(lng)) continue;
  const key = norm(place) + '|' + abbr;
  let arr = cityData.get(key);
  if (!arr) cityData.set(key, (arr = []));
  arr.push({ zip, county: county || '', lat, lng, place });
}
const cityZip = new Map();
for (const [key, zips] of cityData) {
  const n = zips.length;
  const clat = zips.reduce((s, z) => s + z.lat, 0) / n, clng = zips.reduce((s, z) => s + z.lng, 0) / n;
  let best = zips[0], bd = Infinity;
  for (const z of zips) { const d = (z.lat - clat) ** 2 + (z.lng - clng) ** 2; if (d < bd) { bd = d; best = z; } }
  cityZip.set(key, { zip: best.zip, county: best.county, place: best.place });
}

const PLACE_TYPES = /\b(village|borough|town|township|cdp|plantation)\b/g;

const seenCity = new Set(), seenPath = new Set();
const seed = [], redirects = [], unmatched = [];

for (const raw of readFileSync(listPath, 'utf8').split('\n')) {
  const mm = raw.match(/\/resources\/(\S+)/);
  if (!mm) continue;
  const slug = mm[1].replace(/\/+$/, '').toLowerCase();
  if (!slug.endsWith('-sales-tax')) continue;          // skip non-city links
  const oldPath = '/resources/' + slug;
  const rest = slug.slice(0, -'-sales-tax'.length);    // {place}-{state}

  let abbr = null, stateSlug = null;
  for (const ss of stateSlugs) {
    if (rest === ss || rest.endsWith('-' + ss)) { abbr = stateSlugToAbbr[ss]; stateSlug = ss; break; }
  }
  if (!abbr) { unmatched.push(`${slug} (no state)`); continue; }
  if (rest === stateSlug) continue;                    // state-only page (e.g. illinois-sales-tax)

  const citySlug = rest.slice(0, rest.length - stateSlug.length - 1);
  const cityWords = citySlug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const cityClean = cityWords.replace(PLACE_TYPES, '').replace(/\s+/g, ' ').trim() || cityWords;

  // try the cleaned name, then the raw name (some real names contain "town"/"city")
  const hit = cityZip.get(norm(cityClean) + '|' + abbr) || cityZip.get(norm(cityWords) + '|' + abbr);
  if (!hit) { unmatched.push(`${cityClean}, ${abbr}`); continue; }

  const city = hit.place;
  const full = STATE_NAMES[abbr];
  const newSlug = `${kebab(city)}-${kebab(full)}`;
  const newPath = `${prefix}/${newSlug}`;

  if (!seenPath.has(oldPath)) { seenPath.add(oldPath); redirects.push({ old_path: oldPath, new_path: newPath }); }

  const cityKey = abbr + '|' + norm(city);
  if (!seenCity.has(cityKey)) {
    seenCity.add(cityKey);
    seed.push({ city, state: abbr, zip: hit.zip, county: hit.county, population: '' });
  }
}

const seedCols = ['city', 'state', 'zip', 'county', 'population'];
writeFileSync('data/seed-404.csv', seedCols.join(',') + '\n' + seed.map((r) => seedCols.map((k) => csvCell(r[k])).join(',')).join('\n') + '\n');
const redirCols = ['old_path', 'new_path'];
writeFileSync('data/redirects-404.csv', redirCols.join(',') + '\n' + redirects.map((r) => redirCols.map((k) => csvCell(r[k])).join(',')).join('\n') + '\n');

writeFileSync('data/unmatched-404.csv', 'unmatched\n' + unmatched.map(csvCell).join('\n') + '\n');
console.error(`Matched cities: ${seed.length}  |  Redirects: ${redirects.length}  |  Unmatched: ${unmatched.length}`);
if (unmatched.length) console.error('Unmatched (no ZIP in GeoNames or no state): ' + unmatched.length + '\n  e.g. ' + unmatched.slice(0, 12).join(' · '));
