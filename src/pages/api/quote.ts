import type { APIRoute } from 'astro';
import { resolveTaxCode } from '../../lib/taxCodes';
import { fetchRate } from '../../lib/zamp';
import { cacheKey, getCached, setCached } from '../../lib/cache';

export const prerender = false;

function json(obj: unknown, status = 200, maxAge = 300) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${maxAge}`,
    },
  });
}

/**
 * POST /sales-tax/api/quote
 * body: { taxCode, zip, state, city?, line1? }
 * → { taxable, rate, jurisdictions[], label, note, state, zip }
 *
 * Returns the effective combined RATE for a location + category. The browser multiplies
 * it by the entered amount, so we never call Zamp per keystroke. The Zamp key lives only
 * in `locals.runtime.env` and never reaches the client.
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

  const taxCodeId = String(payload?.taxCode ?? '');
  const zip = String(payload?.zip ?? '').trim();
  const state = String(payload?.state ?? '').trim().toUpperCase();
  const city = String(payload?.city ?? '').trim();
  const line1 = String(payload?.line1 ?? '').trim() || '1 Main St';

  const option = resolveTaxCode(taxCodeId);
  if (!option) return json({ error: 'Unknown tax category.' }, 400, 0);
  if (!/^\d{5}$/.test(zip)) return json({ error: 'ZIP must be 5 digits.' }, 400, 0);
  if (!/^[A-Z]{2}$/.test(state)) return json({ error: 'Invalid state code.' }, 400, 0);

  const nowMs = Date.now();
  const key = cacheKey(state, zip, option.zampCode);

  try {
    let result = await getCached(env, key, nowMs);
    let cached = !!result;

    if (!result) {
      result = await fetchRate({
        apiKey,
        line1,
        city,
        state,
        zip,
        zampCode: option.zampCode,
        now: new Date(nowMs).toISOString(),
      });
      await setCached(env, key, result, nowMs);
      cached = false;
    }

    return json({
      taxCode: option.id,
      label: option.label,
      note: option.note ?? null,
      taxable: result.taxable,
      rate: result.rate,
      jurisdictions: result.jurisdictions,
      state: result.state,
      zip: result.zip,
      cached,
    });
  } catch (err: any) {
    return json({ error: 'Calculation failed.', detail: String(err?.message ?? err) }, 502, 0);
  }
};
