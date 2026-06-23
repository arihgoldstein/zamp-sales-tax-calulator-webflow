// Data pipeline: city list  ->  enriched locations.csv for the Webflow CMS.
//
// For each city it (1) validates a representative address, (2) computes the headline
// sales-tax rate (general goods) via Zamp, and (3) generates the SEO fields each page
// needs. Output is one CSV row per location — import straight into the Webflow CMS
// "Locations" collection.
//
// Usage:
//   node scripts/build-locations.mjs <input.csv> <output.csv> [--limit N] [--concurrency C]
//
// Input CSV columns: city,state,zip,county,population
// The Zamp key is read from ZAMP_API_KEY or the local .dev.vars file.
//
// Rate limit: Zamp allows ~1000 req/min. We make 2 calls per city (validate + rate) and
// throttle to a safe concurrency with a per-call minimum spacing.

import { readFileSync, writeFileSync } from 'node:fs';

const ZAMP_BASE = 'https://api.zamp.com';
const PROBE_AMOUNT = 100;
const GENERAL_CODE = 'R_TPP';
const DEFAULT_LINE1 = '1 Main St';

// ---- args ----
const [inPath, outPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const LIMIT = parseInt(flag('--limit', '0'), 10);
const CONCURRENCY = parseInt(flag('--concurrency', '5'), 10);
// Address validation is optional — the rate is ZIP/jurisdiction-driven and correct
// without it, so we skip it by default to halve the API calls on a full run.
const VALIDATE = process.argv.includes('--validate');

if (!inPath || !outPath) {
  console.error('Usage: node scripts/build-locations.mjs <input.csv> <output.csv> [--limit N] [--concurrency C]');
  process.exit(1);
}

// ---- api key ----
function loadKey() {
  if (process.env.ZAMP_API_KEY) return process.env.ZAMP_API_KEY;
  try {
    const m = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/ZAMP_API_KEY=(.+)/);
    if (m) return m[1].trim();
  } catch {}
  console.error('No ZAMP_API_KEY in env or .dev.vars');
  process.exit(1);
}
const KEY = loadKey();

// ---- tiny CSV helpers (RFC-4180-ish) ----
function parseCsv(text) {
  const rows = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length);
  const headers = lines[0].split(',').map((h) => h.trim());
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row = {};
    headers.forEach((h, j) => (row[h] = (cells[j] || '').trim()));
    rows.push(row);
  }
  return rows;
}
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows, columns) {
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

// ---- zamp calls ----
async function zamp(path, body) {
  const res = await fetch(ZAMP_BASE + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error('rate-limited');
  if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

async function validateAddress(c) {
  if (!VALIDATE) return { ok: null, zip: c.zip };
  try {
    const d = await zamp('/addresses', { line1: DEFAULT_LINE1, city: c.city, state: c.state, zip: c.zip });
    return d.validatedAddress ? { ok: true, zip: d.validatedAddress.zip || c.zip } : { ok: false, zip: c.zip };
  } catch {
    return { ok: null, zip: c.zip }; // best-effort; don't fail the row
  }
}

async function headlineRate(c) {
  const d = await zamp('/calculations', {
    id: `seed-${c.state}-${c.zip}`,
    transactedAt: new Date().toISOString(),
    subtotal: PROBE_AMOUNT,
    total: PROBE_AMOUNT,
    shipToAddress: { line1: DEFAULT_LINE1, city: c.city, state: c.state, zip: c.zip },
    lineItems: [{ id: 'li-1', amount: PROBE_AMOUNT, quantity: 1, productTaxCode: GENERAL_CODE, productName: 'Tax estimate' }],
  });
  const dest = (d.taxes || []).filter((t) => t.state === c.state);
  const rate = dest.reduce((s, t) => s + (t.taxRate || 0), 0);
  const taxable = dest.reduce((s, t) => s + (t.taxableAmount || 0), 0) > 0;
  const levels = [...new Set(dest.filter((t) => (t.taxRate || 0) > 0).map((t) => t.jurisdictionDivision))];
  return { rate, taxable, levels };
}

// ---- SEO field generation ----
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Tax rates need up to 3 decimals (e.g. NY = 8.875%), trimmed of trailing zeros.
const pct = (n) => (n * 100).toFixed(3).replace(/\.?0+$/, '') + '%';

// 2-letter code -> full state name, for the unique Name ("Boston, Massachusetts") and
// the keyword-rich slug ("boston-massachusetts"). Cities share names across states, so
// Name and Slug both include the full state to stay unique.
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
const stateFull = (abbr) => STATE_NAMES[abbr] || abbr;

// States with NO local sales tax — a state-only result is CORRECT here, not a gap.
const NO_LOCAL_STATES = new Set(['CT', 'IN', 'KY', 'ME', 'MD', 'MA', 'MI', 'NJ', 'RI', 'DC']);

// In a state that DOES have local taxes, a taxable city resolving to STATE-level only
// usually means the account is missing that locality's local rate (e.g. some
// self-administered Alabama/Texas cities) — flag it for a look before publishing.
function needsReview(state, rate, taxable, levels) {
  return String(
    taxable && rate > 0 && levels.length === 1 && levels[0] === 'STATE' && !NO_LOCAL_STATES.has(state)
  );
}

function seoFields(c, rate, taxable) {
  const full = stateFull(c.state);
  const name = `${c.city}, ${full}`;            // unique CMS title, e.g. "Boston, Massachusetts"
  const slug = `${kebab(c.city)}-${kebab(full)}`; // keyword-rich, unique URL, e.g. "boston-massachusetts"
  const rateStr = pct(rate);
  const hasTax = taxable && rate > 0;
  const title = `${c.city}, ${full} Sales Tax Calculator`;
  const metaDescription = hasTax
    ? `The combined sales tax rate in ${c.city}, ${full} is ${rateStr}. Enter a price to calculate the exact sales tax and total by product category.`
    : `${c.city}, ${full} has no general sales tax. Use the calculator to check tax by product category and see your total.`;
  const intro = hasTax
    ? `The combined sales tax rate in ${c.city}, ${full} is ${rateStr}, made up of state, county, and local district rates. Enter a purchase amount below to see the exact tax for what you're buying.`
    : `${c.city}, ${full} doesn't charge a general sales tax. Use the calculator below to confirm how specific product categories are treated.`;
  return { name, state_name: full, slug, combined_rate: rate.toFixed(5), combined_rate_pct: rateStr, taxable: String(hasTax), seo_title: title, meta_description: metaDescription, intro_text: intro };
}

// ---- concurrency pool ----
async function pool(items, size, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return out;
}

// ---- main ----
const COLUMNS = ['name', 'city', 'state', 'state_name', 'zip', 'county', 'population', 'slug', 'combined_rate', 'combined_rate_pct', 'taxable', 'jurisdiction_levels', 'needs_review', 'address_valid', 'seo_title', 'meta_description', 'intro_text'];

let cities = parseCsv(readFileSync(inPath, 'utf8'));
if (LIMIT > 0) cities = cities.slice(0, LIMIT);
console.error(`Building ${cities.length} locations (concurrency ${CONCURRENCY})...`);

let done = 0;
const rows = await pool(cities, CONCURRENCY, async (c) => {
  const [addr, rate] = await Promise.all([validateAddress(c), headlineRate(c).catch(() => null)]);
  done++;
  if (done % 5 === 0 || done === cities.length) console.error(`  ${done}/${cities.length}`);
  if (!rate) return { ...c, name: `${c.city}, ${stateFull(c.state)}`, state_name: stateFull(c.state), slug: `${kebab(c.city)}-${kebab(stateFull(c.state))}`, combined_rate: '', combined_rate_pct: 'ERROR', taxable: '', jurisdiction_levels: '', needs_review: 'true', address_valid: addr.ok, seo_title: '', meta_description: '', intro_text: '' };
  const seo = seoFields(c, rate.rate, rate.taxable);
  return { ...c, ...seo, zip: addr.zip, jurisdiction_levels: rate.levels.join('|'), needs_review: needsReview(c.state, rate.rate, rate.taxable, rate.levels), address_valid: addr.ok === null ? 'skipped' : String(addr.ok) };
});

writeFileSync(outPath, toCsv(rows, COLUMNS));
const errs = rows.filter((r) => r.combined_rate_pct === 'ERROR').length;
console.error(`\nWrote ${rows.length} rows to ${outPath}${errs ? ` (${errs} rate errors)` : ''}`);
