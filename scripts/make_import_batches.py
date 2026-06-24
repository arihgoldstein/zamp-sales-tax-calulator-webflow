#!/usr/bin/env python3
"""Split a locations CSV into N import batches with headers matching the Webflow
"Sales Tax Calculators" collection field names (so columns auto-map on import).

System columns (Collection ID, Item ID, Created On, …) are intentionally omitted —
they're auto-generated for new items; including Item ID would try to update existing
ones. The "State" column carries the state slug (e.g. "california") to resolve the
State reference by slug.

Usage: python3 scripts/make_import_batches.py <in.csv> <out-prefix> [N=3]
"""
import csv, sys, math

inp = sys.argv[1]
prefix = sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 3

# (Webflow field name, source column in our CSV)
FIELDS = [
    ('Name', 'name'),
    ('Slug', 'slug'),
    ('SEO title', 'seo_title'),
    ('Meta description', 'meta_description'),
    ('Intro', 'intro_text'),
    ('City', 'city'),
    ('State', 'state_slug'),
    ('County', 'county'),
    ('ZIP', 'zip'),
    ('Population', 'population'),
    ('Combined rate', 'combined_rate'),
    ('Taxable', 'taxable'),
    ('Needs review', 'needs_review'),
    ('Combined rate pct', 'combined_rate_pct'),
    ('Article', 'seo_content'),
]

rows = list(csv.DictReader(open(inp, newline='')))
size = math.ceil(len(rows) / n)
for i in range(n):
    chunk = rows[i * size:(i + 1) * size]
    if not chunk:
        continue
    out = f"{prefix}-{i + 1}-of-{n}.csv"
    with open(out, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow([wf for wf, _ in FIELDS])
        for r in chunk:
            w.writerow([r.get(col, '') for _, col in FIELDS])
    print(f"  {out}: {len(chunk)} rows")
print(f"total: {len(rows)} rows across {n} batches")
