// Quote cache: durable KV (Webflow Cloud `RATES` binding) + per-isolate in-memory fallback.
//
// We cache REAL Zamp results keyed by exact input (state, zip, category, exact amount in
// cents). A cached value is therefore byte-for-byte what Zamp returned — it can only be
// STALE, never wrong. Two freshness controls:
//   - TTL: 7 days (auto-expiry).
//   - Version prefix: bump RATE_CACHE_VERSION to invalidate everything instantly (manual
//     refresh, e.g. after a known rate change).

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const mem = new Map<string, { value: unknown; expires: number }>();

/** Key for a real quote at an exact whole-cent amount. */
export function quoteKey(version: string, state: string, zip: string, taxCode: string, cents: number) {
  return `q${version}:${state}:${zip}:${taxCode}:${cents}`;
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
