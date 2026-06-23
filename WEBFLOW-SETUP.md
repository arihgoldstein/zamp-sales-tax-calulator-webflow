# Webflow setup guide

How to take this repo + `data/locations.csv` and turn it into live, per-city sales-tax
pages on the Zamp Webflow site. Five steps: deploy the app → create the collection →
import → build the template → publish.

---

## 0. Prerequisites

- **Webflow Business plan** (20,000 CMS items — needed beyond ~2k pages).
- **Webflow Cloud** enabled on the site/workspace.
- Your **production Zamp API key** (not the demo key — the demo under-reports local tax in
  some cities; see `needs_review` in the CSV).

---

## 1. Deploy the Webflow Cloud app (the calculator backend + widget)

1. Webflow dashboard → **New Project → App** → **Import a GitHub repository** →
   `arihgoldstein/zamp-sales-tax-calulator-webflow`.
2. **Mount path:** `/tools/sales-tax-calculator`  (must match `MOUNT_PATH` in `astro.config.mjs`).
3. **Environment variables:**
   - `ZAMP_API_KEY` → your production key → toggle **Secret**.
   - `RATE_CACHE_VERSION` → `1` (bump anytime to flush cached rates).
4. **Deploy.** The KV bindings (`SESSION`, `RATES`) auto-provision from `wrangler.json`.
5. Verify: `https://<your-domain>/tools/sales-tax-calculator/widget.js` loads, and a POST to
   `https://<your-domain>/tools/sales-tax-calculator/api/quote` returns JSON.

> **Three distinct paths — keep them separate:**
> - `/sales-tax` — existing marketing content. **Untouched.**
> - `/sales-tax-calculator/[city]` — the location pages (CMS, step 4).
> - `/tools/sales-tax-calculator` — **this app** (API + widget only; not a content URL).
>
> If Webflow Cloud's mount-path field rejects the nested path, fall back to a single
> segment (e.g. `/tax-calculator-app`) and update `MOUNT_PATH` in `astro.config.mjs` to match.

---

## 2. Create the "States" collection (do this first)

Locations references States, so create + import this one first.
CMS → **Create Collection** → "States". Fields (Name + Slug are built in):

| Webflow field | Type | From CSV column |
|---|---|---|
| Name | Plain text | `name` (e.g. `California`) |
| Slug | Slug | `slug` (e.g. `california`) |
| Abbreviation | Plain text | `abbreviation` (e.g. `CA`) |
| No state sales tax | Switch | `no_state_sales_tax` |
| Has local sales tax | Switch | `has_local_sales_tax` |

Import `data/states.csv` (51 rows = 50 states + DC). Add more state-level fields later
(state rate, nexus thresholds, a state intro, etc.) — that's the point of the collection.

## 3. Create the "Locations" CMS collection

CMS → **Create Collection** → "Locations". Add these fields (the two built-ins **Name**
and **Slug** are created automatically):

| Webflow field | Type | From CSV column | Notes |
|---|---|---|---|
| Name | Plain text | `name` | unique title, e.g. `Boston, Massachusetts` |
| Slug | Slug | `slug` | the page URL, e.g. `boston-massachusetts` |
| City | Plain text | `city` | the city alone (e.g. `Boston`) — **the widget binds `data-city` to this** |
| State code | Plain text | `state` | 2-letter, e.g. `CA` — **the widget binds `data-state` to this** |
| State | Reference → **States** | `state_name` | links to the States collection (Webflow matches by the State's Name, e.g. `California`) |
| ZIP | Plain text | `zip` | **text, not number** (preserves leading zeros) |
| County | Plain text | `county` | |
| Population | Number | `population` | for sorting / "largest cities" |
| Combined rate | Plain text | `combined_rate_pct` | e.g. `8.875%` — shown in copy |
| Taxable | Switch | `taxable` | |
| SEO title | Plain text | `seo_title` | → page title |
| Meta description | Plain text | `meta_description` | → page meta description |
| Intro | Plain text | `intro_text` | page intro paragraph |
| SEO content | Rich text | `seo_content` | evergreen ~350-word SEO body for the bottom of the page (HTML) |
| Needs review | Switch | `needs_review` | filter these OUT until verified |

(`combined_rate` and `jurisdiction_levels` are optional internal columns — skip or add as
plain text.)

---

## 4. Import the CSVs

1. **States first:** States collection → **Import** → `data/states.csv` → map Name → `name`,
   Slug → `slug`, Abbreviation → `abbreviation`, etc. Publish so the items exist.
2. **Then Locations:** Locations collection → **Import** → `data/locations.csv` (or
   `data/locations.test.csv` for a 3-row trial). Map Name → `name`, Slug → `slug`,
   City → `city`, State code → `state`, ZIP → `zip`, and the **State reference → `state_name`**
   (Webflow links each row to the matching States item by name).
3. **Before publishing, exclude `needs_review = true` rows** (≈14 in the pilot) until you've
   confirmed their rates on the production key — or re-run the pipeline with the production
   key first, which should clear them.

---

## 5. Build the Collection Page template

Open the Locations **Collection Page** template and lay it out (this one design applies to
every city). Bind CMS fields into the page:

- **Page title** (Settings → SEO) → bind to **SEO title**.
- **Meta description** (Settings → SEO) → bind to **Meta description**.
- **H1**: `Sales tax in [City], [State]` (bind City + State).
- **Headline line**: "The combined rate is **[Combined rate]**." (bind Combined rate — this
  puts the number in static HTML, which is what ranks).
- **Intro paragraph** → bind **Intro**.

Then add an **HTML Embed** element where the calculator should appear:

```html
<div data-zamp-calc
     data-city="[[City]]"
     data-state="[[State]]"
     data-zip="[[ZIP]]"
     data-api="/tools/sales-tax-calculator/api/quote"></div>
```

Use the embed editor's **"+ Add Field"** to insert the real tokens (the `[[...]]` above are
placeholders): bind `data-city` → **City**, `data-state` → **State code** (the 2-letter
plain-text field — *not* the State reference), `data-zip` → **ZIP**. Leave `line1` out —
the proxy fills a default; the ZIP drives the rate.

Add the script **once** (Page settings → Before `</body>`, or site-wide footer):

```html
<script src="/tools/sales-tax-calculator/widget.js" defer></script>
```

**URL structure:** set the collection's URL prefix to something like
`sales-tax-calculator`, so pages live at `/sales-tax-calculator/los-angeles-california`. Keep it
distinct from the app's `/tools/sales-tax-calculator` mount path.

---

## 6. Publish & index

1. Publish the site.
2. Confirm a page renders the headline rate in **View Source** (static HTML) and the
   calculator works.
3. Submit the sitemap in **Google Search Console**. (Ask me to generate a `sitemap.xml`
   for the location pages if Webflow's auto-sitemap isn't enough.)
4. Roll out in batches (the pilot is ~500). Watch indexing before scaling toward 10k.

---

## Refreshing rates later

- Live widget: 7-day cache; bump `RATE_CACHE_VERSION` to flush immediately.
- Headline rates in the CMS: re-run `scripts/build-locations.mjs` (quarterly aligns with
  when jurisdictions actually change rates) and re-import / update the collection.
