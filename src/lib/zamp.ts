// Thin client for the Zamp calculations API + helpers for the linear/exact model.
//
// Sales tax is USUALLY linear in amount (tax = amount × rate), but NOT always: some
// jurisdictions cap or threshold the tax (e.g. Tennessee's single-article local cap,
// some states' clothing exemptions), so the effective rate changes with the amount.
//
// We therefore probe each (state, zip, category) at two amounts:
//   - if the effective rate is identical → LINEAR: cache the full-precision rate and let
//     the browser compute tax for any amount locally (exact, zero extra API calls).
//   - if it differs → NON-LINEAR: "exact mode", call Zamp live with the real amount.
//
// Full precision matters: we sum each jurisdiction's `taxRate` (e.g. 0.0625 + 0.01)
// rather than dividing a per-cent-rounded total, which previously lost precision.

const ZAMP_URL = 'https://api.zamp.com/calculations';

export interface JurisdictionLine {
  level: string; // STATE | COUNTY | CITY | DISTRICT | ...
  name: string;
  rate: number; // decimal, full precision
}

export interface CalcResult {
  amount: number;
  taxDue: number; // as returned (cent-rounded) by Zamp
  taxable: boolean;
  sumRate: number; // Σ destination jurisdiction rates, full precision
  effectiveRate: number; // taxDue / amount
  jurisdictions: JurisdictionLine[];
  state: string;
  zip: string;
}

export interface CalcInput {
  apiKey: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
  zampCode: string;
  amount: number;
  now: string; // ISO timestamp injected by caller
}

const LEVEL_LABELS: Record<string, string> = {
  STATE: 'State',
  COUNTY: 'County',
  CITY: 'City',
  DISTRICT: 'Special district',
  SPECIAL: 'Special district',
};
const LEVEL_ORDER = ['STATE', 'COUNTY', 'CITY', 'DISTRICT', 'SPECIAL'];

export async function fetchCalc(input: CalcInput): Promise<CalcResult> {
  const { apiKey, line1, city, state, zip, zampCode, amount, now } = input;

  const body = {
    id: `est-${state}-${zip}-${zampCode}-${amount}`,
    transactedAt: now,
    subtotal: amount,
    total: amount,
    shipToAddress: { line1, city, state, zip },
    lineItems: [
      { id: 'li-1', amount, quantity: 1, productTaxCode: zampCode, productName: 'Tax estimate' },
    ],
  };

  const res = await fetch(ZAMP_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Zamp ${res.status}: ${text.slice(0, 300)}`);
  }

  const data: any = await res.json();

  // Keep only destination-state jurisdictions; the account's origin nexus (the demo
  // company is registered in UT) adds zero-rate origin lines we must ignore.
  const destLines: any[] = (data.taxes || []).filter((t: any) => t.state === state);

  const taxableTotal = destLines.reduce((s, t) => s + (t.taxableAmount || 0), 0);
  const taxDue =
    typeof data.taxDue === 'number' ? data.taxDue : destLines.reduce((s, t) => s + (t.taxDue || 0), 0);
  const sumRate = destLines.reduce((s, t) => s + (t.taxRate || 0), 0);

  return {
    amount,
    taxDue,
    taxable: taxableTotal > 0,
    sumRate,
    effectiveRate: amount > 0 ? taxDue / amount : 0,
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

// Two effective rates are "the same" if they match within rounding noise. At the low
// probe ($100) cent-rounding can move the effective rate by at most ~0.005%, so a
// 0.05-percentage-point tolerance never flags a linear rate yet still catches real
// caps/thresholds (e.g. Tennessee moved ~1 full point between probes).
export function ratesMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.0005;
}
