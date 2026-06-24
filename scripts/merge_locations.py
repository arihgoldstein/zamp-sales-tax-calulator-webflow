#!/usr/bin/env python3
"""Merge location CSVs into one master, deduped by slug.

- Drops ERROR rows (combined_rate_pct == 'ERROR').
- On a slug collision, keeps the row that has a population value (the ranked set).
- Output is sorted by slug. Uses the csv module so quoted fields (commas in name /
  seo_content) are handled correctly.

Usage: python3 scripts/merge_locations.py <out.csv> <in1.csv> <in2.csv> ...
"""
import csv, sys

out, ins = sys.argv[1], sys.argv[2:]
by_slug, cols = {}, None
total = errors = collisions = 0

for path in ins:
    with open(path, newline='') as f:
        r = csv.DictReader(f)
        if cols is None:
            cols = r.fieldnames
        for row in r:
            total += 1
            if row.get('combined_rate_pct') == 'ERROR':
                errors += 1
                continue
            slug = row['slug']
            if slug in by_slug:
                collisions += 1
                if not by_slug[slug].get('population') and row.get('population'):
                    by_slug[slug] = row
            else:
                by_slug[slug] = row

with open(out, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore')
    w.writeheader()
    for slug in sorted(by_slug):
        w.writerow(by_slug[slug])

print(f"input rows: {total}  |  ERROR dropped: {errors}  |  duplicate slugs merged: {collisions}  |  unique cities: {len(by_slug)}")
