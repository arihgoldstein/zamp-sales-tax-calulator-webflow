#!/usr/bin/env python3
"""From the Webflow redirect export, find city->state-guide redirects whose city we
HAVEN'T built yet (not in master), resolve each to a representative ZIP + county via
GeoNames, and emit a seed for the pipeline. Cities with no ZIP are excluded (a page
without a ZIP can't fire the calculator) and written to a separate unmatched list.

Usage: python3 scripts/build_uncovered_seed.py <export.csv> <US.txt> <master.csv> <seed-out.csv> <unmatched-out.csv>
"""
import csv, re, sys, os

export_p, geo_p, master_p, seed_out, unmatched_out = sys.argv[1:6]

STATE_NAMES = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','DC':'District of Columbia','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming'}
abbr_by_name = {v: k for k, v in STATE_NAMES.items()}
kebab = lambda s: re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))
norm = lambda s: re.sub(r'[^a-z0-9]', '', re.sub(r'\bfort\b', 'ft', re.sub(r'\bsaint\b', 'st', s.lower())))
state_slugs = sorted((kebab(v) for v in STATE_NAMES.values()), key=len, reverse=True)
slug_to_abbr = {kebab(v): k for k, v in STATE_NAMES.items()}
PT = re.compile(r'\b(village|borough|town|township|cdp|plantation)\b')

# GeoNames -> centroid ZIP per (normCity, abbr)
data = {}
for line in open(geo_p, encoding='utf-8'):
    f = line.split('\t')
    if len(f) < 11: continue
    zc, place, abbr, county = f[1], f[2], f[4], f[5]
    try: lat, lng = float(f[9]), float(f[10])
    except: continue
    if not re.match(r'^\d{5}$', zc): continue
    data.setdefault(norm(place) + '|' + abbr, []).append((zc, county, lat, lng, place))
cityzip = {}
for k, zs in data.items():
    n = len(zs); clat = sum(z[2] for z in zs)/n; clng = sum(z[3] for z in zs)/n
    best = min(zs, key=lambda z: (z[2]-clat)**2 + (z[3]-clng)**2)
    cityzip[k] = (best[0], best[1], best[4])

master = {r['slug'] for r in csv.DictReader(open(master_p, newline=''))}

def parse(src):
    s = src.strip('/').lower()
    if s.startswith('resources/'): s = s[len('resources/'):]
    if not s.endswith('-sales-tax'): return None
    rest = s[:-len('-sales-tax')]
    st = next((ss for ss in state_slugs if rest == ss or rest.endswith('-'+ss)), None)
    if not st or rest == st: return None
    city = rest[:-(len(st)+1)]
    clean = PT.sub('', city.replace('-', ' ')).strip()
    return clean, slug_to_abbr[st], st

seen_slug, seed, unmatched = set(), [], []
for s, t in csv.reader(open(export_p, newline='')):
    t = t.rstrip('\r')
    if not (re.match(r'^/guides/[a-z-]+-sales-tax$', t) or t == '/blog'): continue
    p = parse(s)
    if not p: continue
    clean, abbr, st = p
    slug = kebab(clean) + '-' + st
    if slug in master or slug in seen_slug: continue
    hit = cityzip.get(norm(clean) + '|' + abbr)
    if hit:
        seen_slug.add(slug)
        seed.append({'city': hit[2], 'state': abbr, 'zip': hit[0], 'county': hit[1], 'population': ''})
    else:
        unmatched.append(f"{clean}, {abbr}")

cols = ['city', 'state', 'zip', 'county', 'population']
cell = lambda v: '"'+str(v).replace('"','""')+'"' if re.search(r'[",\n]', str(v or '')) else str(v or '')
open(seed_out, 'w').write(','.join(cols)+'\n' + '\n'.join(','.join(cell(r[c]) for c in cols) for r in seed) + '\n')
open(unmatched_out, 'w').write('unmatched\n' + '\n'.join(sorted(set(unmatched))) + '\n')
print(f"buildable (has ZIP): {len(seed)}   no ZIP (excluded): {len(set(unmatched))}")
