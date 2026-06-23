import type { APIRoute } from 'astro';
import { resolveTaxCode } from '../../lib/taxCodes';
import { fetchCalc, ratesMatch, type CalcResult, type JurisdictionLine } from '../../lib/zamp';
import { classKey, exactKey, getCached, setCached } from '../../lib/cache';

export const prerender = false;

// Probe amounts used to classify linear vs non-linear. Endpoints straddle every known
// cap/threshold (clothing exemptions ~$110-175, TN single-article caps at $1.6k/$3.2k).
const PROBE_LO = 100;
const PROBE_HI = 25000;
const MAX_AMOUNT = 100_000_000;

function json(obj: unknown, status = 200, maxAge = 300) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}` },
  });
}

interface Classification {
  mode: 'linear' | 'exact';
  taxable: boolean;
  rate?: number; // present when linear
  jurisdictions: JurisdictionLine[]; // representative breakdown
}

/**
 * POST /sales-tax/api/quote
 * body: { taxCode, zip, state, city?, line1?, amount? }
 *
 * LINEAR response: { mode:'linear', taxable, rate, jurisdictions }
 *   → browser computes tax = amount × rate for any amount (exact).
 * EXACT response:  { mode:'exact', taxable, amount, tax, effectiveRate, jurisdictions }
 *   → tax depends on amount here; browser re-requests when the amount changes.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env ?? {};
  const apiKey: string | undefined = env.ZAMP_API_KEY;
  if (!apiKey) return json({ error: 'Server not configured (missing ZAMP_API_KEY).' }, 500, 0);

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400, 0);
  }

  const option = resolveTaxCode(String(payload?.taxCode ?? ''));
  const zip = String(payload?.zip ?? '').trim();
  const state = String(payload?.state ?? '').trim().toUpperCase();
  const city = String(payload?.city ?? '').trim();
  const line1 = String(payload?.line1 ?? '').trim() || '1 Main St';
  const amount = Number(payload?.amount ?? PROBE_LO);

  if (!option) return json({ error: 'Unknown tax category.' }, 400, 0);
  if (!/^\d{5}$/.test(zip)) return json({ error: 'ZIP must be 5 digits.' }, 400, 0);
  if (!/^[A-Z]{2}$/.test(state)) return json({ error: 'Invalid state code.' }, 400, 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT)
    return json({ error: 'Invalid amount.' }, 400, 0);

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const call = (amt: number) =>
    fetchCalc({ apiKey, line1, city, state, zip, zampCode: option.zampCode, amount: amt, now });

  try {
    // 1) Classify this (state, zip, category) once, then cache.
    const cKey = classKey(state, zip, option.zampCode);
    let cls = await getCached<Classification>(env, cKey, nowMs);

    if (!cls) {
      const [lo, hi] = await Promise.all([call(PROBE_LO), call(PROBE_HI)]);
      const linear = ratesMatch(lo.effectiveRate, hi.effectiveRate) && ratesMatch(lo.sumRate, hi.sumRate);
      if (linear) {
        cls = { mode: 'linear', taxable: hi.taxable, rate: hi.sumRate, jurisdictions: hi.jurisdictions };
      } else {
        cls = { mode: 'exact', taxable: hi.taxable || lo.taxable, jurisdictions: hi.jurisdictions };
      }
      await setCached(env, cKey, cls, nowMs);
    }

    const common = {
      taxCode: option.id,
      label: option.label,
      note: option.note ?? null,
      state,
      zip,
    };

    if (cls.mode === 'linear') {
      return json({ ...common, mode: 'linear', taxable: cls.taxable, rate: cls.rate, jurisdictions: cls.jurisdictions });
    }

    // 2) Non-linear: return the exact tax for the requested amount (cached per dollar).
    const dollars = Math.round(amount);
    const eKey = exactKey(state, zip, option.zampCode, dollars);
    let exact = await getCached<CalcResult>(env, eKey, nowMs);
    if (!exact) {
      exact = await call(Math.max(dollars, 0));
      await setCached(env, eKey, exact, nowMs);
    }

    return json({
      ...common,
      mode: 'exact',
      taxable: exact.taxable,
      amount: exact.amount,
      tax: exact.taxDue,
      effectiveRate: exact.effectiveRate,
      jurisdictions: exact.jurisdictions,
    });
  } catch (err: any) {
    return json({ error: 'Calculation failed.', detail: String(err?.message ?? err) }, 502, 0);
  }
};
