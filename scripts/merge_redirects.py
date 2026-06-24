#!/usr/bin/env python3
"""Repoint existing city->state-guide redirects to the new calculator pages, and add
net-new redirects from the 404 set. Outputs source,target (Webflow format).

A row is repointed when: target is /guides/<state>-sales-tax (or /blog), AND the source
parses to a city whose calculator-page slug exists in the master set. Everything else is
kept verbatim.

Usage: python3 scripts/merge_redirects.py <existing-export.csv> <redirects-404.csv> <master-locations.csv> <out.csv>
"""
import csv, re, sys

existing_path, r404_path, master_path, out_path = sys.argv[1:5]

STATE_NAMES = {
    'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado',
    'CT':'Connecticut','DE':'Delaware','DC':'District of Columbia','FL':'Florida','GA':'Georgia',
    'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky',
    'LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota',
    'MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire',
    'NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota',
    'OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina',
    'SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia',
    'WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming',
}
kebab = lambda s: re.sub(r'^-|-$','', re.sub(r'[^a-z0-9]+','-', s.lower()))
state_slugs = sorted((kebab(v) for v in STATE_NAMES.values()), key=len, reverse=True)
PLACE_TYPES = re.compile(r'\b(village|borough|town|township|cdp|plantation)\b')

master_slugs = {r['slug'] for r in csv.DictReader(open(master_path, newline=''))}

def source_to_slug(source):
    s = source.strip('/').lower()
    if s.startswith('resources/'): s = s[len('resources/'):]
    if not s.endswith('-sales-tax'): return None
    rest = s[:-len('-sales-tax')]
    st = next((ss for ss in state_slugs if rest == ss or rest.endswith('-'+ss)), None)
    if not st or rest == st: return None
    city = rest[:-(len(st)+1)]
    clean = PLACE_TYPES.sub('', city.replace('-',' ')).strip()
    cand = kebab(clean) + '-' + st
    return cand if cand in master_slugs else None

def is_guide(target):
    t = target.strip().rstrip('/')
    return bool(re.match(r'^/guides/[a-z-]+-sales-tax$', t)) or t == '/blog'

rows, seen = [], set()
repointed = 0
for r in csv.DictReader(open(existing_path, newline='')):
    src, tgt = r['source'], r['target']
    if re.search(r'/page/[0-9]+', src):  # drop listing-page pagination redirects
        continue
    seen.add(src)
    if is_guide(tgt):
        slug = source_to_slug(src)
        if slug:
            tgt = f'/sales-tax-calculator/{slug}'
            repointed += 1
    rows.append((src, tgt))

net_new = 0
for r in csv.DictReader(open(r404_path, newline='')):
    if r['old_path'] not in seen:
        rows.append((r['old_path'], r['new_path']))
        seen.add(r['old_path'])
        net_new += 1

with open(out_path, 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['source','target'])
    w.writerows(rows)

print(f"existing rows: {len(rows)-net_new}  repointed to calculator pages: {repointed}  net-new added: {net_new}  total: {len(rows)}")
