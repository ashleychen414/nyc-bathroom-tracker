# Hand-check sample: random.seed(2026); OSM named places per category, plus Overture-only (no OSM match) with confidence >= 0.9.
import os,random,sys
__file__=os.path.abspath(__file__)
exec(open(os.path.join(os.path.dirname(__file__),'match.py')).read().split('for cat in')[0])
random.seed(2026)
plan_osm={'museum':2,'hotel':3,'grocery':3,'department':2,'target':2,'gas':2}
plan_ov={'museum':1,'hotel':2,'grocery':1,'department':1,'gas':1}
tags={('n' if e['type']=='node' else e['type'][0])+str(e['id']):e['tags'] for e in els}
for cat,k in plan_osm.items():
    pool=[x for x in osm if x[4]==cat and x[1]]
    for x in random.sample(pool,k):
        t=tags[x[0]]; print('OSM',cat,x[0],x[1],'|',t.get('addr:housenumber'),t.get('addr:street'),'|',round(x[2],5),round(x[3],5),'|',t.get('opening_hours'),'|',t.get('website'))
for cat,k in plan_ov.items():
    pool=[x for x in ov if x[4]==cat and x[5]>=0.9 and not match(x,osm)]
    for x in random.sample(pool,k):
        a=c.sql(f"select addresses[1].freeform, websites[1] from cat where id='{x[0]}'").fetchone()
        print('OVERTURE',cat,x[0],x[1],'|',a[0],'|',round(x[2],5),round(x[3],5),'| conf',x[5],x[6],'|',a[1])
