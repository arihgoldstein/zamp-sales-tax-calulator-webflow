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
  const stateRate = dest.filter((t) => t.jurisdictionDivision === 'STATE').reduce((s, t) => s + (t.taxRate || 0), 0);
  return { rate, taxable, levels, stateRate };
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

// Evergreen, per-page SEO body (rich text / HTML). Deliberately contains NO rate numbers
// or dollar amounts — those change with the law and would go stale in the CMS. The live
// calculator owns the current figure; this copy explains structure, taxability, and how
// to use the tool, so it stays correct indefinitely. It still branches on taxable vs.
// no-tax and on whether the state has a statewide rate, for accurate wording.
function seoContent(c, full, combined, stateRate) {
  const city = c.city;
  const countyType = c.state === 'LA' ? 'Parish' : c.state === 'AK' ? 'Borough' : 'County';
  const cnty = c.county ? `${c.county} ${countyType}` : 'the county';

  if (!(combined > 0)) {
    return [
      `<h2>Does ${city}, ${full} have sales tax?</h2>`,
      `<p>No. ${full} is one of a small group of states with no statewide sales tax, so purchases in ${city} generally aren't taxed at the register — the price on the shelf is usually the price you pay. The calculator above confirms this and lets you check how individual product categories are treated.</p>`,
      `<h3>What this means for shoppers</h3>`,
      `<p>You won't see a separate sales tax line on most receipts in ${city}, which is one reason ${full} draws shoppers making larger purchases. Other taxes can still apply in specific cases — excise taxes on goods like fuel or tobacco, or lodging taxes on hotel stays — but those are separate from general sales tax.</p>`,
      `<h3>Selling from ${city}</h3>`,
      `<p>Because ${full} has no general sales tax, most sellers based in ${city} don't collect one on local sales. If you ship to customers in other states, though, you may still have sales tax obligations there based on where those customers are. Zamp helps sellers work out exactly where they need to register and collect, and handles the filing in each state.</p>`,
    ].join('');
  }

  const structure = stateRate > 0
    ? `it's ${full}'s statewide rate combined with local taxes added by ${cnty} and any city or special districts that cover the address`
    : `${full} doesn't levy a statewide sales tax, so the rate comes entirely from local taxes — ${cnty} and any city or district taxes that apply at the address`;

  return [
    `<h2>How sales tax works in ${city}, ${full}</h2>`,
    `<p>Sales tax in ${city} isn't a single flat rate — ${structure}. Because those local pieces differ from one area to the next, the total can vary between ZIP codes even within the same city. The ${city} sales tax calculator above looks up the current rate for the address, so you always see today's figure rather than one that's drifted out of date.</p>`,
    `<h3>Calculating sales tax on a purchase</h3>`,
    `<p>Enter the price in the calculator above and choose a category. It applies ${city}'s current combined rate and breaks the result down by jurisdiction, so you can see how much goes to the state, to ${cnty}, and to local districts. Because the rate updates automatically, the total stays accurate even after local rates change.</p>`,
    `<h3>What's taxable, and what isn't</h3>`,
    `<p>Not everything is taxed the same way. Most tangible goods are fully taxable, but groceries and prescription medicine are often exempt or taxed at a reduced rate, and some services fall outside sales tax altogether. Prepared food, clothing, and general merchandise are usually taxed in full. Switch the category in the calculator to see how ${full} treats a specific purchase before you buy it or set up tax on what you sell.</p>`,
    `<h3>Common questions</h3>`,
    `<p><strong>Why does the rate differ between nearby cities?</strong> Counties, cities, and special districts each set their own local sales tax, and they don't all charge the same amount. A neighboring town can sit in a different district and come out slightly higher or lower, even when the state portion is identical.</p>`,
    `<p><strong>How often does the rate change?</strong> Statewide rates rarely move, but local rates can change when voters approve new district taxes — usually at the start of a calendar quarter. That's why the calculator looks up the current rate instead of relying on a fixed number, and why Zamp tracks those changes across every U.S. jurisdiction for the businesses that file here.</p>`,
  ].join('');
}

function seoFields(c, rate, taxable, stateRate) {
  const full = stateFull(c.state);
  const name = `${c.city}, ${full}`;            // unique CMS title, e.g. "Boston, Massachusetts"
  const slug = `${kebab(c.city)}-${kebab(full)}`; // keyword-rich, unique URL, e.g. "boston-massachusetts"
  const rateStr = pct(rate);
  const hasTax = taxable && rate > 0;
  const title = `${c.city}, ${full} Sales Tax Calculator`;
  const metaDescription = hasTax
    ? `Find the current sales tax in ${c.city}, ${full}. Enter a price and category in the calculator to see the exact tax and total, broken down by state, county, and local district.`
    : `${c.city}, ${full} has no statewide sales tax. Use the calculator to confirm how product categories are treated and see your total.`;
  const intro = hasTax
    ? `Use the calculator below to find the current sales tax in ${c.city}, ${full}. Enter a purchase amount to see the exact tax, broken down by state, county, and local district.`
    : `${c.city}, ${full} doesn't charge a statewide sales tax. Use the calculator below to confirm how specific product categories are treated.`;
  const seo_content = seoContent(c, full, rate, stateRate || 0);
  return { name, state_name: full, state_slug: kebab(full), slug, combined_rate: rate.toFixed(5), combined_rate_pct: rateStr, taxable: String(hasTax), seo_title: title, meta_description: metaDescription, intro_text: intro, seo_content };
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
const COLUMNS = ['name', 'city', 'state', 'state_name', 'state_slug', 'zip', 'county', 'population', 'slug', 'combined_rate', 'combined_rate_pct', 'taxable', 'jurisdiction_levels', 'needs_review', 'address_valid', 'seo_title', 'meta_description', 'intro_text', 'seo_content'];

let cities = parseCsv(readFileSync(inPath, 'utf8'));
if (LIMIT > 0) cities = cities.slice(0, LIMIT);
console.error(`Building ${cities.length} locations (concurrency ${CONCURRENCY})...`);

let done = 0;
const rows = await pool(cities, CONCURRENCY, async (c) => {
  const [addr, rate] = await Promise.all([validateAddress(c), headlineRate(c).catch(() => null)]);
  done++;
  if (done % 5 === 0 || done === cities.length) console.error(`  ${done}/${cities.length}`);
  if (!rate) return { ...c, name: `${c.city}, ${stateFull(c.state)}`, state_name: stateFull(c.state), state_slug: kebab(stateFull(c.state)), slug: `${kebab(c.city)}-${kebab(stateFull(c.state))}`, combined_rate: '', combined_rate_pct: 'ERROR', taxable: '', jurisdiction_levels: '', needs_review: 'true', address_valid: addr.ok, seo_title: '', meta_description: '', intro_text: '', seo_content: '' };
  const seo = seoFields(c, rate.rate, rate.taxable, rate.stateRate);
  return { ...c, ...seo, zip: addr.zip, jurisdiction_levels: rate.levels.join('|'), needs_review: needsReview(c.state, rate.rate, rate.taxable, rate.levels), address_valid: addr.ok === null ? 'skipped' : String(addr.ok) };
});

writeFileSync(outPath, toCsv(rows, COLUMNS));
const errs = rows.filter((r) => r.combined_rate_pct === 'ERROR').length;
console.error(`\nWrote ${rows.length} rows to ${outPath}${errs ? ` (${errs} rate errors)` : ''}`);
