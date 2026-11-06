import json
A=json.load(open('bench/results/controlled.json'))['runs']
B=json.load(open('bench/results/controlled-n10-rerun.json'))['runs']
valid=[r for r in A if not (r['n']==10 and r['scenario'] not in ('visible','hidden','hidden+throttle','hidden+nothrottle'))]+B
def a(xs):
    xs=[x for x in xs if x is not None]; return sum(xs)/len(xs) if xs else None
def f(x,n=1): return 'n/a' if x is None else f'{x:.{n}f}'
def row(r):
    bg=r['bg']; s=r['system']
    vis='/'.join(sorted({p['visibility'] or 'unreachable' for p in bg}))
    rec=all(x['reachable'] and x['visibility']=='visible' and (x['tickRate'] or 0)>9 and (x['rafRate'] or 0)>30 and x['wsState']==1 and x['boundsOk'] for x in r['recovered'])
    per=a([p['cpu'] for p in bg])
    return (f"| {r['scenario']} | {vis} | {f(a([p['tickRate'] for p in bg]))} | {f(a([p['progressPerS'] for p in bg]),2)} | {f(a([p['rafRate'] for p in bg]),0)} | "
            f"{f(a([p['serverHbRate'] for p in bg]),1)} / {f(a([p['serverWsRate'] for p in bg]),1)} | {f(per,2)} | {f(s['cpuTotal'])} | {f(s['memTotalMB'],0)} | {'ok' if rec else 'NOT ok'} |")
H="| Strategy | Page state | Timer fires/s (100 ms timer) | Game progress/s (wall clock) | rAF/s | Server sees: heartbeats / ws msgs per s | CPU per background renderer (%) | CPU, all processes (%) | RAM, all processes (MB) | Back to normal |\n|---|---|---|---|---|---|---|---|---|---|"
for n in (1,2,5,10):
    print(f"\n#### N = {n}" + (" (the single account is the one being hidden)" if n==1 else f" (1 visible + {n-1} in background)")); print(H)
    for r in valid:
        if r['n']==n and not r.get('error'): print(row(r))
