import re
# Strict subset of OSM opening_hours that maps cleanly to the hours.js weekly model.
# Accepts: "24/7"; rules "Dd[-Dd][,Dd..] HH:MM-HH:MM[,HH:MM-HH:MM]" or "Dd off" joined by "; ".
# Everything else (PH, months, sunrise, "+", comments, week numbers) -> None.
D = ['Su','Mo','Tu','We','Th','Fr','Sa']
ORDER = ['Mo','Tu','We','Th','Fr','Sa','Su']
def days(spec):
    out=set()
    for part in spec.split(','):
        if '-' in part:
            a,b=part.split('-')
            if a not in ORDER or b not in ORDER: return None
            i,j=ORDER.index(a),ORDER.index(b)
            seq=ORDER[i:j+1] if i<=j else ORDER[i:]+ORDER[:j+1]
            out|=set(seq)
        elif part in ORDER: out.add(part)
        else: return None
    return out
def tmin(t):
    m=re.fullmatch(r'(\d{2}):(\d{2})',t)
    if not m: return None
    h,mi=int(m[1]),int(m[2])
    if h>24 or mi>59: return None
    return h*60+mi
def parse(oh):
    if oh is None: return None
    s=oh.strip()
    if s=='24/7': return {'kind':'always'}
    week=[None]*7; seen=False
    for rule in [r.strip() for r in s.split(';') if r.strip()]:
        rule=re.sub(r',\s+',',',rule)
        if re.fullmatch(r'\d{2}:\d{2}-\d{2}:\d{2}(?:,\d{2}:\d{2}-\d{2}:\d{2})*',rule): rule='Mo-Su '+rule
        m=re.fullmatch(r'([A-Za-z,\-]+)\s+(off|closed|(?:\d{2}:\d{2}-\d{2}:\d{2})(?:,\d{2}:\d{2}-\d{2}:\d{2})*)',rule)
        if not m: return None
        ds=days(m[1])
        if ds is None: return None
        if m[2] in ('off','closed'): rng=[]
        else:
            rng=[]
            for r in m[2].split(','):
                a,b=r.split('-'); a,b=tmin(a),tmin(b)
                if a is None or b is None: return None
                if b<=a: b+=1440
                rng.append([a,b])
        for d in ds: week[D.index(d)]=rng
        seen=True
    if not seen: return None
    # days not mentioned stay unknown (None) rather than closed: accuracy first
    return {'kind':'weekly','days':week}
