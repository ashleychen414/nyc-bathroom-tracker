# Usage: python3 osm_analyze.py osm/brooklyn.json <folder with osm_ohparse.py>
import json,sys,collections
sys.path.insert(0,sys.argv[2])
from osm_ohparse import parse
els=json.load(open(sys.argv[1]))['elements']
def cats(t):
    c=[]
    if t.get('tourism')=='museum': c.append('museum')
    if t.get('tourism') in ('hotel','motel'): c.append('hotel')
    if t.get('shop')=='supermarket': c.append('grocery')
    if t.get('shop')=='department_store': c.append('department')
    if t.get('brand:wikidata')=='Q1046951': c.append('target')
    if t.get('amenity')=='fuel': c.append('gas')
    return c
S=collections.defaultdict(collections.Counter)
toil=collections.defaultdict(collections.Counter)
for e in els:
    t=e.get('tags',{})
    for c in cats(t):
        s=S[c]; s['n']+=1
        s[e['type']]+=1
        if t.get('name'): s['name']+=1
        oh=t.get('opening_hours')
        if oh:
            s['oh']+=1
            p=parse(oh)
            if p: s['oh_parse']+=1
            if p and (p['kind']=='always' or all(d is not None for d in p['days'])): s['oh_full']+=1
        if t.get('check_date:opening_hours') or t.get('check_date'): s['checkdate']+=1
        if 'toilets' in t: s['toilets']+=1; toil[c]['toilets='+t['toilets']]+=1
        for k in ('toilets:access','toilets:wheelchair','toilets:fee','toilets:changing_table','changing_table'):
            if k in t: s[k]+=1; toil[c][k+'='+t[k]]+=1
        if t.get('addr:housenumber') and t.get('addr:street'): s['addr']+=1
        if t.get('website') or t.get('contact:website'): s['web']+=1
        if t.get('brand') or t.get('brand:wikidata'): s['brand']+=1
        y=e.get('timestamp','')[:4]; s['edit_'+('2024+' if y>='2024' else '<2024')]+=1
for c in ['museum','hotel','grocery','department','target','gas']:
    s=S[c]; print(c, dict(s)); print('   ', dict(toil[c]))
