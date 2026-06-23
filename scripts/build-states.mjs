// Build data/states.csv — one row per US state (+ DC) for a "States" CMS collection
// that the Locations collection references. No API calls; pure reference data.
//
// Usage: node scripts/build-states.mjs --out data/states.csv

import { writeFileSync } from 'node:fs';

const OUT = (() => { const i = process.argv.indexOf('--out'); return i >= 0 ? process.argv[i + 1] : 'data/states.csv'; })();

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

// NOMAD: no statewide sales tax (AK & MT still allow local sales taxes).
const NO_STATE_SALES_TAX = new Set(['AK', 'DE', 'MT', 'NH', 'OR']);
// States with NO local sales tax at all (state rate only, or no tax at all).
const NO_LOCAL_SALES_TAX = new Set(['CT', 'IN', 'KY', 'ME', 'MD', 'MA', 'MI', 'NJ', 'RI', 'DC', 'DE', 'NH', 'OR']);

const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const cols = ['name', 'slug', 'abbreviation', 'no_state_sales_tax', 'has_local_sales_tax'];
const rows = Object.entries(STATE_NAMES)
  .sort((a, b) => a[1].localeCompare(b[1]))
  .map(([abbr, name]) => ({
    name,
    slug: kebab(name),
    abbreviation: abbr,
    no_state_sales_tax: String(NO_STATE_SALES_TAX.has(abbr)),
    has_local_sales_tax: String(!NO_LOCAL_SALES_TAX.has(abbr)),
  }));

writeFileSync(OUT, cols.join(',') + '\n' + rows.map((r) => cols.map((k) => csvCell(r[k])).join(',')).join('\n') + '\n');
console.error(`Wrote ${rows.length} states to ${OUT}`);
