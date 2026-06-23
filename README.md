# Zamp Sales Tax Calculator — Webflow Cloud app

Programmatic-SEO sales tax calculator for the Zamp website. A small [Webflow Cloud](https://developers.webflow.com/webflow-cloud) app (Astro + Cloudflare Workers) hosts:

- **`/sales-tax/api/quote`** — a secure proxy that holds the Zamp API key server-side and returns the effective tax **rate** for a location + category.
- **`/sales-tax/widget.js`** — a self-contained calculator embedded on every Webflow CMS location page.

The Zamp API key **never** reaches the browser. Visitors' browsers only call our own same-origin endpoint.

## How it works

```
Webflow CMS location page  ──>  widget.js (reads data-* from the page)
                                     │  POST /sales-tax/api/quote {taxCode, zip, state, city, line1}
                                     ▼
                           Webflow Cloud API route  ──(Bearer ZAMP_API_KEY)──>  api.zamp.com/calculations
                                     │  caches the rate (KV + in-memory)
                                     ▼
                           { taxable, rate, jurisdictions[] }
```

Tax is linear in amount, so the proxy **probes once with a $100 line item** to learn the
effective rate per `(state, zip, category)`, caches it, and the browser computes
`tax = amount × rate` locally — instant UI, minimal API calls.

## Project layout

| Path | Purpose |
|------|---------|
| `src/pages/api/quote.ts` | The secure proxy (POST) |
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
# open http://localhost:4321/sales-tax/
```

Test the proxy directly:

```bash
curl -s -X POST http://localhost:4321/sales-tax/api/quote \
  -H 'Content-Type: application/json' \
  -d '{"taxCode":"general","zip":"90012","state":"CA","city":"Los Angeles","line1":"200 N Spring St"}'
```

## Deploy to Webflow Cloud

1. Push to GitHub (this repo: `zamptax/zamp-sales-tax-tool-webflow`).
2. Webflow dashboard → **New Project → App** → import this repo.
3. Set the **Mount path** to `/sales-tax` (must match `MOUNT_PATH` in `astro.config.mjs`).
4. Add an environment variable **`ZAMP_API_KEY`** and toggle it **Secret**.
5. Deploy. Subsequent pushes to the selected branch auto-deploy.

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
  data-api="/sales-tax/api/quote">
</div>
<script src="/sales-tax/widget.js" defer></script>
```

The same embed works across all location pages — each page supplies its own data.

## Tax categories

Defined in `src/lib/taxCodes.ts`. Current set: General goods, Clothing & apparel,
Groceries, Prepared food, Candy, Digital products, Software (SaaS), Professional services.
Edit that one file to change the public pick list and the server allowlist together.

> Estimates only — informational, not tax advice. Threshold-based exemptions (e.g. some
> states' clothing exemptions) are flagged via category notes; exact-mode live calls can
> be added for those categories later.
