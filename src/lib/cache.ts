// Rate cache: durable KV (Webflow Cloud `RATES` binding) + per-isolate in-memory fallback.
//
// TTL is intentionally short (24h) because sales-tax rules change — usually on quarter
// boundaries (Jan/Apr/Jul/Oct 1), occasionally mid-cycle. A 24h TTL means a rule change
// propagates to the live calculator within a day without any manual invalidation. The
// SEO headline rate baked into page HTML is refreshed separately by the data pipeline.

const TTL_SECONDS = 60 * 60 * 24; // 24h
const mem = new Map<string, { value: unknown; expires: number }>();

/** Classification + linear rate for a (state, zip, category). */
export function classKey(state: string, zip: string, taxCode: string) {
  return `cls:${state}:${zip}:${taxCode}`;
}

/** Exact tax for a non-linear (state, zip, category) at a specific whole-dollar amount. */
export function exactKey(state: string, zip: string, taxCode: string, dollars: number) {
  return `exa:${state}:${zip}:${taxCode}:${dollars}`;
}

export async function getCached<T>(env: any, key: string, nowMs: number): Promise<T | null> {
  if (env?.RATES?.get) {
    try {
      const hit = await env.RATES.get(key, 'json');
      if (hit) return hit as T;
    } catch {
      /* fall through to memory */
    }
  }
  const m = mem.get(key);
  if (m && m.expires > nowMs) return m.value as T;
  if (m) mem.delete(key);
  return null;
}

export async function setCached(env: any, key: string, value: unknown, nowMs: number): Promise<void> {
  mem.set(key, { value, expires: nowMs + TTL_SECONDS * 1000 });
  if (env?.RATES?.put) {
    try {
      await env.RATES.put(key, JSON.stringify(value), { expirationTtl: TTL_SECONDS });
    } catch {
      /* memory cache already set */
    }
  }
}
