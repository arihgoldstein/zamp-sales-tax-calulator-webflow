// Thin client for the Zamp calculations API.
//
// Key idea: sales tax is linear in the item amount (tax = amount × rate), so instead
// of calling Zamp on every keystroke we PROBE once with a $100 line item to learn the
// effective rate + taxability for a given (address, tax code), cache it, and let the
// browser compute the actual tax locally. One API call serves unlimited amounts.
//
// Caveat: a few states have threshold-based exemptions (e.g. clothing under $X) where
// tax is NOT perfectly linear. Those are flagged via the tax-code `note` for now; an
// "exact mode" live call can be added later for the affected categories.

const PROBE_AMOUNT = 100;
const ZAMP_URL = 'https://api.zamp.com/calculations';

export interface JurisdictionLine {
  level: string; // STATE | COUNTY | CITY | DISTRICT | ...
  name: string;
  rate: number; // decimal, e.g. 0.0625
}

export interface RateResult {
  taxable: boolean;
  rate: number; // combined effective rate, decimal
  jurisdictions: JurisdictionLine[];
  state: string;
  zip: string;
}

export interface FetchRateInput {
  apiKey: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
  zampCode: string;
  now?: string; // ISO timestamp; injected so callers control it
}

const LEVEL_LABELS: Record<string, string> = {
  STATE: 'State',
  COUNTY: 'County',
  CITY: 'City',
  DISTRICT: 'Special district',
  SPECIAL: 'Special district',
};
const LEVEL_ORDER = ['STATE', 'COUNTY', 'CITY', 'DISTRICT', 'SPECIAL'];

export async function fetchRate(input: FetchRateInput): Promise<RateResult> {
  const { apiKey, line1, city, state, zip, zampCode } = input;
  const transactedAt = input.now ?? new Date().toISOString();

  const body = {
    id: `est-${state}-${zip}-${zampCode}`,
    transactedAt,
    subtotal: PROBE_AMOUNT,
    total: PROBE_AMOUNT,
    shipToAddress: { line1, city, state, zip },
    lineItems: [
      {
        id: 'li-1',
        amount: PROBE_AMOUNT,
        quantity: 1,
        productTaxCode: zampCode,
        productName: 'Tax estimate',
      },
    ],
  };

  const res = await fetch(ZAMP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Zamp ${res.status}: ${text.slice(0, 300)}`);
  }

  const data: any = await res.json();

  // Keep only destination-state jurisdictions. The account's origin nexus can add
  // zero-rate origin lines (e.g. the demo company's Utah registration) that we ignore.
  const destLines: any[] = (data.taxes || []).filter((t: any) => t.state === state);

  const taxableTotal = destLines.reduce((s, t) => s + (t.taxableAmount || 0), 0);
  const taxDue =
    typeof data.taxDue === 'number'
      ? data.taxDue
      : destLines.reduce((s, t) => s + (t.taxDue || 0), 0);

  return {
    taxable: taxableTotal > 0,
    rate: taxDue / PROBE_AMOUNT,
    jurisdictions: aggregate(destLines),
    state,
    zip,
  };
}

function aggregate(lines: any[]): JurisdictionLine[] {
  const byLevel = new Map<string, number>();
  for (const t of lines) {
    const level = t.jurisdictionDivision || 'OTHER';
    byLevel.set(level, (byLevel.get(level) || 0) + (t.taxRate || 0));
  }
  return [...byLevel.entries()]
    .filter(([, rate]) => rate > 0)
    .sort((a, b) => LEVEL_ORDER.indexOf(a[0]) - LEVEL_ORDER.indexOf(b[0]))
    .map(([level, rate]) => ({ level, name: LEVEL_LABELS[level] || 'Other', rate }));
}
