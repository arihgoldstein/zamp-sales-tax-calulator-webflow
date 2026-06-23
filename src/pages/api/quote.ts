import type { APIRoute } from 'astro';
import { resolveTaxCode } from '../../lib/taxCodes';
import { fetchCalc, ZampError } from '../../lib/zamp';
import { quoteKey, getCached, setCached } from '../../lib/cache';

export const prerender = false;

const DEFAULT_AMOUNT = 100;
const MAX_AMOUNT = 100_000_000;

function json(obj: unknown, status = 200, maxAge = 300) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}` },
  });
}

/**
 * POST /sales-tax/api/quote
 * body: { taxCode, zip, state, city?, line1?, amount? }
 * → { taxable, amount, tax, effectiveRate, jurisdictions[], label, note }
 *
 * Always a real Zamp calculation for the exact amount (no extrapolation). Result is
 * memoized by exact input for 7 days. The Zamp key stays in locals.runtime.env.
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
  const amount = Number(payload?.amount ?? DEFAULT_AMOUNT);

  if (!option) return json({ error: 'Unknown tax category.' }, 400, 0);
  if (!/^\d{5}$/.test(zip)) return json({ error: 'ZIP must be 5 digits.' }, 400, 0);
  if (!/^[A-Z]{2}$/.test(state)) return json({ error: 'Invalid state code.' }, 400, 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT)
    return json({ error: 'Invalid amount.' }, 400, 0);

  const version = String(env.RATE_CACHE_VERSION ?? '1');
  const cents = Math.round(amount * 100);
  const key = quoteKey(version, state, zip, option.zampCode, cents);
  const nowMs = Date.now();

  try {
    let result = await getCached<any>(env, key, nowMs);
    let cached = !!result;
    if (!result) {
      const r = await fetchCalc({
        apiKey,
        line1,
        city,
        state,
        zip,
        zampCode: option.zampCode,
        amount: cents / 100,
        now: new Date(nowMs).toISOString(),
      });
      result = {
        taxable: r.taxable,
        amount: r.amount,
        tax: r.taxDue,
        effectiveRate: r.effectiveRate,
        jurisdictions: r.jurisdictions,
      };
      await setCached(env, key, result, nowMs);
      cached = false;
    }

    return json({
      taxCode: option.id,
      label: option.label,
      note: option.note ?? null,
      ...result,
      state,
      zip,
      cached,
    });
  } catch (err: any) {
    // Surface rate limiting distinctly so the widget can ask the visitor to retry,
    // rather than ever showing an incorrect number.
    if (err instanceof ZampError && err.status === 429) {
      return json({ error: 'Busy right now — please try again in a moment.', retry: true }, 429, 0);
    }
    return json({ error: 'Calculation failed.', detail: String(err?.message ?? err) }, 502, 0);
  }
};
