# Zamp Sales Tax Calculator — Webflow Cloud app

Programmatic-SEO sales tax calculator for the Zamp website. A small [Webflow Cloud](https://developers.webflow.com/webflow-cloud) app (Astro + Cloudflare Workers) hosts:

- **`/tools/sales-tax-calculator/api/quote`** — a secure proxy that holds the Zamp API key server-side and returns the effective tax **rate** for a location + category.
- **`/tools/sales-tax-calculator/widget.js`** — a self-contained calculator embedded on every Webflow CMS location page.

The Zamp API key **never** reaches the browser. Visitors' browsers only call our own same-origin endpoint.

## How it works

```
Webflow CMS location page  ──>  widget.js (reads data-* from the page)
                                     │  POST /tools/sales-tax-calculator/api/quote {taxCode, zip, state, city, line1, amount}
                                     ▼
                           Webflow Cloud API route  ──(Bearer ZAMP_API_KEY)──>  api.zamp.com/calculations
                                     │  memoizes the real result by exact input (KV + in-memory)
                                     ▼
                           { taxable, amount, tax, effectiveRate, jurisdictions[] }
```

**Every quote is a real Zamp calculation for the exact amount** — no client-side rate
extrapolation — so caps and thresholds (e.g. Tennessee's single-article cap, clothing
exemptions) are always reflected correctly. The cache only **memoizes real results** keyed
by exact input `(state, zip, category, amount)`, so a cached value can be stale but never
wrong. Freshness is controlled two ways:

- **TTL: 7 days** (auto-expiry).
- **`RATE_CACHE_VERSION`** env var — bump it to invalidate the whole cache instantly
  (manual refresh after a known rate change).

Zamp's API is rate-limited (~1,000 req/min); a 429 is surfaced to the widget as a
"try again in a moment" message rather than ever showing an incorrect number.

## Project layout

| Path | Purpose |
|------|---------|
| `src/pages/api/quote.ts` | The secure proxy (POST) — real calc per exact amount + memoization |
| `src/pages/api/tax-codes.ts` | The friendly category list (GET) |
| `src/lib/zamp.ts` | Zamp calculations client + rate/taxability parsing |
| `src/lib/taxCodes.ts` | Friendly pick list ↔ Zamp codes (also the allowlist) |
| `src/lib/cache.ts` | KV + in-memory rate cache |
| `public/widget.js` | The embeddable calculator |
| `src/pages/index.astro` | Local demo page (stands in for a CMS page) |
| `astro.config.mjs` | `base` / `assetsPrefix` = the Webflow Cloud mount path |
| `webflow.json` | Declares the framework to Webflow Cloud |

## Local development

```bash
npm install

# Add the Zamp key for local runtime (gitignored, never committed):
echo 'ZAMP_API_KEY=<your-zamp-key>' > .dev.vars

npm run dev
# open http://localhost:4321/tools/sales-tax-calculator/
```

Test the proxy directly:

```bash
curl -s -X POST http://localhost:4321/tools/sales-tax-calculator/api/quote \
  -H 'Content-Type: application/json' \
  -d '{"taxCode":"general","zip":"90012","state":"CA","city":"Los Angeles","line1":"200 N Spring St"}'
```

## Deploy to Webflow Cloud

1. Push to GitHub (this repo: `arihgoldstein/zamp-sales-tax-calulator-webflow`).
2. Webflow dashboard → **New Project → App** → import this repo.
3. Set the **Mount path** to `/tools/sales-tax-calculator` (must match `MOUNT_PATH` in `astro.config.mjs`).
4. Add an environment variable **`ZAMP_API_KEY`** and toggle it **Secret**.
5. (Optional) Add **`RATE_CACHE_VERSION`** (e.g. `1`); bump it any time to flush cached
   rates instantly after a known rate change.
6. Deploy. Subsequent pushes to the selected branch auto-deploy.

### Refreshing rates manually

Cached quotes expire after 7 days on their own. To force an immediate refresh (e.g. a
mid-quarter rate change you know about), bump `RATE_CACHE_VERSION` in the environment —
every cache key is prefixed with it, so old entries are abandoned at once.

### Optional: durable rate cache (recommended for production)

Bind a Webflow Cloud **Key Value Store** named `RATES`. `src/lib/cache.ts` uses it
automatically when present and falls back to in-memory caching when it isn't.

## Embedding on a Webflow CMS page

On the **Locations** collection page template, add an HTML Embed with CMS fields bound
into the data attributes, plus the script once (e.g. in the page/site footer):

```html
<div
  data-zamp-calc
  data-city="{{City}}"
  data-state="{{State Code}}"
  data-zip="{{Representative ZIP}}"
  data-line1="{{Representative Line1}}"
  data-api="/tools/sales-tax-calculator/api/quote">
</div>
<script src="/tools/sales-tax-calculator/widget.js" defer></script>
```

The same embed works across all location pages — each page supplies its own data.

## Data pipeline (building the CMS import)

`scripts/` turns a city list into the `locations.csv` you import into the Webflow CMS.

```bash
# 1. one-time: download GeoNames US postal data (authoritative zip/city/county)
curl -sL https://download.geonames.org/export/zip/US.zip -o US.zip && unzip US.zip US.txt

# 2. build a population-ranked seed (plotly top-1k ranking + GeoNames centroid ZIPs)
node scripts/build-seed.mjs --geonames US.txt --top 500 --out scripts/seed-top500.csv

# 3. enrich: per-city headline rate (via Zamp) + SEO fields -> import CSV
node scripts/build-locations.mjs scripts/seed-top500.csv data/locations.csv --concurrency 4
```

- Representative ZIP = the one nearest the city centroid (avoids PO-box ZIPs that
  geocode to state level only).
- **`needs_review` column**: a taxable city that resolves to state-level only in a state
  that *has* local taxes is flagged — usually means the Zamp account lacks that
  locality's local rate. Verify these against the production key before publishing.
- `data/locations.sample.csv` (20 cities) and `data/locations.csv` (500-city pilot) are
  committed as reference output.

> ⚠️ Accuracy depends on the Zamp account's rate coverage. The demo key under-reports
> local tax for some jurisdictions (e.g. several Alabama/Texas cities) — run the pipeline
> with the production key and review the `needs_review` rows before going live.

## Tax categories

Defined in `src/lib/taxCodes.ts`. Current set: General goods, Clothing & apparel,
Groceries, Prepared food, Candy, Digital products, Software (SaaS), Professional services.
Edit that one file to change the public pick list and the server allowlist together.

> Estimates only — informational, not tax advice. Because every quote is a real Zamp
> calculation for the exact amount, threshold/cap rules are handled correctly without any
> special-casing. A representative ZIP can't capture every address-level boundary within a
> city — that's what the optional ZIP-refine field is for.
