import json,sys
d=json.load(open(sys.argv[1]))
def a(xs):
    xs=[x for x in xs if x is not None]
    return sum(xs)/len(xs) if xs else None
def f(x,n=1): return '  - ' if x is None else f'{x:.{n}f}'
print(d['meta'])
print(f"{'N':>2} {'scenario':<18}{'bgVis':<8}{'tick/s':>7}{'prog/s':>7}{'raf/s':>7}{'idb/s':>6}{'srvHb':>6}{'srvWs':>6}{'reach':>6}{'cpuBG':>7}{'cpuTot':>7}{'gpu':>6}{'memTot':>8}{'memBG':>7} | recovery")
for r in d['runs']:
    if r.get('error'): print(r['n'],r['scenario'],'ERROR',r['error'][:150]); continue
    bg=r['bg']; s=r['system']
    vis='/'.join(sorted({p['visibility'] or 'n/a' for p in bg}))
    rec=r['recovered']
    ok=all(x['reachable'] and x['visibility']=='visible' and (x['tickRate'] or 0)>9 and (x['rafRate'] or 0)>30 and x['wsState']==1 and x['boundsOk'] for x in rec)
    persist=all(isinstance(p,dict) and p.get('idb') and p.get('ls') for p in r['persistence'])
    print(f"{r['n']:>2} {r['scenario']:<18}{vis:<8}{f(a([p['tickRate'] for p in bg])):>7}{f(a([p['progressPerS'] for p in bg]),2):>7}{f(a([p['rafRate'] for p in bg]),0):>7}{f(a([p['idbWriteRate'] for p in bg]),2):>6}{f(a([p['serverHbRate'] for p in bg]),2):>6}{f(a([p['serverWsRate'] for p in bg]),2):>6}{sum(1 for p in bg if p['reachable']):>3}/{len(bg):<2}{f(a([p['cpu'] for p in bg]),2):>7}{f(s['cpuTotal']):>7}{f(s['cpuGpu']):>6}{f(s['memTotalMB'],0):>8}{f(a([p['memMB'] for p in bg]),0):>7} | {'OK' if ok else 'NOT-OK'} persist={'ok' if persist else 'BAD'} pids={r['uniquePids']}/{r['n']}")
