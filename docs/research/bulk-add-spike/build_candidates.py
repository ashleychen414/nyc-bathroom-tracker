# Brooklyn bulk-add candidates for hand review: fast food and coffee chains, hotels,
# department store chains (Overture, release 2026-10-21.0) plus Target (Foursquare OS
# Places addresses, checked against target.com's store directory).
# Run from the work folder (overture/, fsq/, nyc/ inside it):
#   python build_candidates.py <repo> > candidates.json
import json,math,os,re,sys,duckdb
REPO=sys.argv[1]
c=duckdb.connect(); c.sql("set enable_progress_bar=false; load spatial")

# Chains that usually have a customer restroom. Dunkin' and Subway left out on purpose:
# many Brooklyn ones are small counters without one.
FOOD={'mcdonalds':"McDonald's",'burger king':'Burger King','wendys':"Wendy's",'popeyes':'Popeyes',
      'kfc':'KFC','taco bell':'Taco Bell','chipotle':'Chipotle','shake shack':'Shake Shack',
      'chick-fil-a':'Chick-fil-A','panera':'Panera Bread','white castle':'White Castle','starbucks':'Starbucks'}
DEPT={'macys':"Macy's",'kohls':"Kohl's",'jcpenney':'JCPenney','burlington':'Burlington','marshalls':'Marshalls',
      'tj maxx':'T.J. Maxx','tjmaxx':'T.J. Maxx','nordstrom rack':'Nordstrom Rack','century 21':'Century 21'}
DEPT_CATS=('department_store','discount_store','clothing_store','shopping','retail')
HOTELISH=re.compile(r'hotel|inn\b|suites|motel|hostel|lodg|resort|guest ?house|\bbnb\b|b&b|hilton|marriott|hyatt|aloft|fairfield|hampton|best western|wyndham|howard johnson|sheraton|moxy|arlo|coda|tempo|ace\b|nu\b|wythe|williamsburg|box house|edition|1 hotel',re.I)
# Target store ids from https://www.target.com/store-locator/store-directory/new-york
TARGET={'519 gateway':('1401','Gateway'),'139 flatbush':('1849','Atlantic Terminal'),
        '1598 flatbush':('2212','Brooklyn Junction'),'1715 e':('3243','Brooklyn Midwood'),
        '6401 18th':('3276','Brooklyn Bensonhurst'),'5200 kings':('3326','Brooklyn Kings Hwy'),
        '8973':('3356','Brooklyn Bay Parkway'),'2101 church':('3404','Brooklyn Flatbush and Church'),
        '5100 kings':('3429','Brooklyn Kings Plaza'),'445 albee':('2850','Brooklyn Fulton St')}

def key(s): return re.sub(r"[^a-z0-9 \-]","",(s or '').lower().replace('’',"'").replace("'",'').replace('.',''))
def chain(name,table):
    k=key(name)
    for pat,label in table.items():
        if re.search(r'(^|\s)'+re.escape(pat)+r'(\s|$)',k): return label
rows=c.sql("""select id, names.primary, brand.names.primary, basic_category, taxonomy.primary, confidence, operating_status,
  ST_Y(geometry), ST_X(geometry), addresses[1].freeform, websites[1] from 'overture/brooklyn.parquet'
  where coalesce(operating_status,'open') = 'open'""").fetchall()
out=[]
for (id_,name,brand,basic,prim,conf,status,lat,lng,addr,web) in rows:
    base=dict(source='overture',sourceId=id_,lat=round(lat,6),lng=round(lng,6),address=addr,website=web,confidence=round(conf,2))
    f=chain(brand,FOOD) or chain(name,FOOD)
    if f and conf>=0.7:
        out.append(dict(base,category='fast_food',name=f,sourceName=name)); continue
    d=chain(brand,DEPT) or chain(name,DEPT)
    if d and (basic in DEPT_CATS or prim in DEPT_CATS) and conf>=0.7:
        out.append(dict(base,category='department',name=d,sourceName=name)); continue
    if basic=='hotel' and conf>=0.9:
        out.append(dict(base,category='hotel',name=name,sourceName=name,flags=[] if HOTELISH.search(name) or brand else ['name does not look like a hotel']))
for (fid,name,lat,lng,addr) in c.sql("select fsq_place_id,name,latitude,longitude,address from 'fsq/brooklyn_cats.parquet' where category='target' and address is not null").fetchall():
    m=next((v for k,v in TARGET.items() if addr.lower().startswith(k)),None)
    if m: out.append(dict(category='target',name='Target '+m[1],sourceName=name,source='target.com + foursquare',sourceId='target-'+m[0],
                          lat=round(lat,6),lng=round(lng,6),address=addr,website=f'https://www.target.com/sl/x/{m[0]}',confidence=1.0))
def dist(a,b): return math.hypot((a['lat']-b['lat'])*111320,(a['lng']-b['lng'])*111320*math.cos(math.radians(a['lat'])))
# Same chain/name within 75 m = one place: keep the most confident row.
out.sort(key=lambda r:-r['confidence']); kept=[]
for r in out:
    dup=next((k for k in kept if k['category']==r['category'] and key(k['name'])==key(r['name']) and dist(k,r)<75),None)
    if dup: dup.setdefault('alsoSeenAs',[]).append(r['sourceId'])
    else: kept.append(r)
city=[b for b in json.load(open(os.path.join(REPO,'public/data/bathrooms.json')))['bathrooms'] if b['borough']=='Brooklyn']
for r in kept:
    r.setdefault('flags',[])
    near=min(city,key=lambda b:dist(r,{'lat':b['lat'],'lng':b['lng']}))
    dd=dist(r,{'lat':near['lat'],'lng':near['lng']})
    if dd<60: r['flags'].append(f"{round(dd)} m from city restroom: {near['name']}")
    if r['confidence']<0.9 and r['category']!='target': r['flags'].append('low confidence')
    r['id']=re.sub(r'[^a-z0-9-]','',('tgt-'+r['sourceId'][7:]) if r['category']=='target' else 'ovt-'+r['sourceId'][:23])
kept.sort(key=lambda r:(r['category'],r['name'],r['address'] or ''))
json.dump(kept,sys.stdout,ensure_ascii=False,indent=0)
