import json,sys
d=json.load(open(sys.argv[1]))
def f(x,n=1): return '-' if x is None else (round(x,n) if isinstance(x,(int,float)) else x)
for r in d['runs']:
    print(f"N={r['n']} {r['scenario']} pids={r['uniquePids']} err={r.get('error')}")
    for g in ('fg','bg'):
        for p in r.get(g,[]):
            print(f"  {g} vis={p['visibility']} tick/s={f(p['tickRate'])} prog/s={f(p['progressPerS'],2)} raf/s={f(p['rafRate'])} idb/s={f(p['idbWriteRate'],2)} gap={p['maxGapMs']} srvHb/s={f(p['serverHbRate'],2)} srvWs/s={f(p['serverWsRate'],2)} ws={p['wsState']} cpu={f(p['cpu'])} mem={f(p['memMB'],0)}")
    s=r.get('system')
    if s: print(f"  system cpu={f(s['cpuTotal'])} browser={f(s['cpuBrowser'])} gpu={f(s['cpuGpu'])} mem={f(s['memTotalMB'],0)}MB")
    print('  recovered',[(x['visibility'],f(x['tickRate']),f(x['rafRate'],0),x['wsState'],x['boundsOk']) for x in r.get('recovered',[])],'persist',r.get('persistence'))
