import type { APIRoute } from 'astro';
import { publicTaxCodes } from '../../lib/taxCodes';

export const prerender = false;

// GET /sales-tax/api/tax-codes → the friendly category list (no Zamp codes exposed).
// The widget hard-codes the same list for speed, but this endpoint keeps a single
// source of truth available and lets other surfaces fetch it.
export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ taxCodes: publicTaxCodes() }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
