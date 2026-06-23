// Two-tier rate cache: durable KV (when bound) + per-isolate in-memory fallback.
//
// In production, bind a Webflow Cloud Key Value Store named `RATES` and rates persist
// across requests/regions. Without it (e.g. the Phase 0 local slice) we fall back to an
// in-memory Map, which still spares repeat Zamp calls within a warm isolate.

import type { RateResult } from './zamp';

const TTL_SECONDS = 60 * 60 * 12; // 12h
const mem = new Map<string, { value: RateResult; expires: number }>();

export function cacheKey(state: string, zip: string, taxCode: string) {
  return `rate:${state}:${zip}:${taxCode}`;
}

export async function getCached(env: any, key: string, nowMs: number): Promise<RateResult | null> {
  if (env?.RATES?.get) {
    try {
      const hit = await env.RATES.get(key, 'json');
      if (hit) return hit as RateResult;
    } catch {
      /* fall through to memory */
    }
  }
  const m = mem.get(key);
  if (m && m.expires > nowMs) return m.value;
  if (m) mem.delete(key);
  return null;
}

export async function setCached(env: any, key: string, value: RateResult, nowMs: number): Promise<void> {
  mem.set(key, { value, expires: nowMs + TTL_SECONDS * 1000 });
  if (env?.RATES?.put) {
    try {
      await env.RATES.put(key, JSON.stringify(value), { expirationTtl: TTL_SECONDS });
    } catch {
      /* memory cache already set */
    }
  }
}
