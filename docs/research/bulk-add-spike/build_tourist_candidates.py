# Fast food and coffee chains in the Manhattan areas first-time visitors go to (tourist_areas.json),
# from Overture (release 2026-10-21.0), for hand review before import. Same chains as the Brooklyn list.
# Run from the work folder after overture-manhattan-extract.sql:
#   python build_tourist_candidates.py <repo> live_rows.json > tourist_candidates.json
# live_rows.json: [{id, name, lat, lng}] of bathrooms already in the app that aren't city restrooms.
import json,math,os,re,sys,duckdb
HERE=os.path.dirname(os.path.abspath(__file__))
REPO,LIVE=sys.argv[1],sys.argv[2]
FOOD={'mcdonalds':"McDonald's",'burger king':'Burger King','wendys':"Wendy's",'popeyes':'Popeyes',
      'kfc':'KFC','taco bell':'Taco Bell','chipotle':'Chipotle','shake shack':'Shake Shack',
      'chick-fil-a':'Chick-fil-A','panera':'Panera Bread','white castle':'White Castle','starbucks':'Starbucks'}
AREAS=json.load(open(os.path.join(HERE,'tourist_areas.json')))
def key(s): return re.sub(r"[^a-z0-9 \-]","",(s or '').lower().replace('’',"'").replace("'",'').replace('.',''))
def chain(name):
    k=key(name)
    for pat,label in FOOD.items():
        if re.search(r'(^|\s)'+re.escape(pat)+r'(\s|$)',k): return label
def dist(a,b,c,d): return math.hypot((a-c)*111320,(b-d)*111320*math.cos(math.radians(a)))
c=duckdb.connect(); c.sql("set enable_progress_bar=false; load spatial")
rows=c.sql("""select id, names.primary, brand.names.primary, confidence, ST_Y(geometry), ST_X(geometry), addresses[1].freeform, websites[1]
  from 'overture/manhattan.parquet' where coalesce(operating_status,'open') = 'open' and confidence >= 0.7""").fetchall()
out=[]
for (id_,name,brand,conf,lat,lng,addr,web) in rows:
    f=chain(brand) or chain(name)
    if not f: continue
    near=[(dist(lat,lng,a['lat'],a['lng']),a['area']) for a in AREAS if dist(lat,lng,a['lat'],a['lng'])<=a['r']]
    if not near: continue
    out.append(dict(category='fast_food',name=f,sourceName=name,source='overture',sourceId=id_,lat=round(lat,6),lng=round(lng,6),
                    address=addr,website=web,confidence=round(conf,2),area=min(near)[1],borough='Manhattan'))
out.sort(key=lambda r:-r['confidence']); kept=[]
for r in out:
    dup=next((k for k in kept if key(k['name'])==key(r['name']) and dist(k['lat'],k['lng'],r['lat'],r['lng'])<75),None)
    if dup: dup.setdefault('alsoSeenAs',[]).append(r['sourceId'])
    else: kept.append(r)
city=[b for b in json.load(open(os.path.join(REPO,'public/data/bathrooms.json')))['bathrooms'] if b['borough']=='Manhattan']
live=json.load(open(LIVE))
for r in kept:
    r['flags']=[]
    n=min(city,key=lambda b:dist(r['lat'],r['lng'],b['lat'],b['lng'])); dd=dist(r['lat'],r['lng'],n['lat'],n['lng'])
    if dd<60: r['flags'].append(f"{round(dd)} m from city restroom: {n['name']}")
    for x in live:
        if key(x['name'])[:5]==key(r['name'])[:5] and dist(r['lat'],r['lng'],x['lat'],x['lng'])<100: r['flags'].append(f"already in the app nearby: {x['name']}")
    if r['confidence']<0.9: r['flags'].append('low confidence')
    if chain(r['sourceName'])!=r['name']: r['flags'].append(f"listed as {r['sourceName']}, not {r['name']}")
    r['id']='ovt-'+r['sourceId'][:23]
kept.sort(key=lambda r:(r['area'],r['name'],r['address'] or ''))
json.dump(kept,sys.stdout,ensure_ascii=False,indent=0)
