# Run from the work folder (osm/, overture/, fsq/, nyc/ inside it). Arg: path to the repo.
import json,math,os,re,sys,duckdb
HERE=os.path.dirname(os.path.abspath(__file__))
REPO=sys.argv[1]
c=duckdb.connect(); c.sql("load spatial")
c.sql(open(os.path.join(HERE,'overture-categories.sql')).read().split('\n',1)[1])
ov=c.sql("select id,names.primary,ST_Y(geometry),ST_X(geometry),category,confidence,operating_status from cat where category is not null").fetchall()
fs=c.sql("select fsq_place_id,name,latitude,longitude,category,date_refreshed,date_closed from 'fsq/brooklyn_cats.parquet'").fetchall()
els=json.load(open('osm/brooklyn.json'))['elements']
def ocat(t):
    if t.get('brand:wikidata')=='Q1046951': return 'target'
    if t.get('tourism')=='museum': return 'museum'
    if t.get('tourism') in('hotel','motel'): return 'hotel'
    if t.get('shop')=='supermarket': return 'grocery'
    if t.get('shop')=='department_store': return 'department'
    if t.get('amenity')=='fuel': return 'gas'
osm=[]
for e in els:
    lat=e.get('lat') or e['center']['lat']; lon=e.get('lon') or e['center']['lon']
    osm.append((e['type'][0]+str(e['id']),e['tags'].get('name') or '',lat,lon,ocat(e['tags'])))
city=[(b['id'],b['name'],b['lat'],b['lng'],'city') for b in json.load(open(REPO+'/public/data/bathrooms.json'))['bathrooms'] if b['borough']=='Brooklyn']
def dist(a,b):
    dy=(a[2]-b[2])*111320; dx=(a[3]-b[3])*111320*math.cos(math.radians(a[2])); return math.hypot(dx,dy)
STOP={'the','of','inc','corp','llc','supermarket','store','stores','market','hotel','brooklyn','museum','nyc','new','york','department','gas','station','and'}
def toks(n): return {w for w in re.findall(r'[a-z0-9]+',(n or '').lower()) if w not in STOP and len(w)>1}
def similar(a,b):
    ta,tb=toks(a),toks(b)
    if not ta or not tb: return False
    return len(ta&tb)/min(len(ta),len(tb))>=0.5
def match(src,others,r=100,name=True):
    for o in others:
        if dist(src,o)<=r and (not name or similar(src[1],o[1])): return o
for cat in ['museum','hotel','grocery','department','target','gas']:
    O=[x for x in osm if x[4]==cat]; V=[x for x in ov if x[4]==cat]; F=[x for x in fs if x[4]==cat and x[6] is None]
    vo=sum(1 for x in O if match(x,ov)); fo=sum(1 for x in O if match(x,fs))
    ov_only=[x for x in V if not match(x,osm)]
    ov_only_hi=[x for x in ov_only if x[5]>=0.9]
    city_near=[(x[1],m[1],round(dist(x,m))) for x in O if (m:=match(x,city,60,False))]
    selfdup=sum(1 for i,x in enumerate(V) if any(dist(x,y)<=75 and similar(x[1],y[1]) for y in V[i+1:]))
    print(f"{cat}: osm={len(O)} overture={len(V)} fsq_open={len(F)} | osm∩overture={vo} osm∩fsq={fo} | overture-not-in-osm={len(ov_only)} (conf>=0.9: {len(ov_only_hi)}) | overture self-dups={selfdup} | osm within 60m of a city restroom={len(city_near)}")
    for t in city_near[:6]: print('    near city:',t)
    print('    sample overture-only conf>=0.9:', [x[1] for x in ov_only_hi[:15]])
