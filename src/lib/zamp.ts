// Thin client for the Zamp calculations API.
//
// We do NOT extrapolate. Every quote shown to a visitor is a real Zamp calculation for
// their exact amount, so caps/thresholds (e.g. TN single-article caps, clothing
// exemptions) are always reflected correctly. The cache (see cache.ts) only memoizes
// these real results by exact input, so a cached value can be stale but never wrong.

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

/** Error thrown by fetchCalc; carries the upstream HTTP status (e.g. 429). */
export class ZampError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ZampError';
    this.status = status;
  }
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
    throw new ZampError(res.status, `Zamp ${res.status}: ${text.slice(0, 300)}`);
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
