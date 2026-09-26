import csv, sys, statistics as st
from collections import Counter, defaultdict
from datetime import datetime
sys.stdout.reconfigure(encoding='utf-8')
P = sys.argv[1]
rows = list(csv.DictReader(open(P, encoding='utf-8'), delimiter='\t'))
for r in rows:
    r['t'] = datetime.strptime(r['at_msk'], '%Y-%m-%d %H:%M:%S')
by = defaultdict(list)
for r in rows: by[r['order_id']].append(r)
def med(xs): return round(st.median(xs), 1) if xs else None
def pct(xs, p):
    if not xs: return None
    xs = sorted(xs); k = max(0, min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))); return round(xs[k], 1)
def first(ev, a, pred=None):
    for e in ev:
        if e['action'] == a and (pred is None or pred(e)): return e
START = datetime(2026, 9, 18)
orders = {}
for oid, ev in by.items():
    cr = [e for e in ev if e['action'] == 'create']
    if not cr or cr[0]['t'] < START or ev[0]['deleted'] == '1': continue
    orders[oid] = ev
print('orders (created >=18.09, not deleted):', len(orders))
print('created_role:', Counter(ev[0]['created_role'] for ev in orders.values()).most_common())
print('cur_status:', Counter(ev[0]['cur_status'] for ev in orders.values()).most_common())
print('internal:', Counter(ev[0]['internal'] for ev in orders.values()).most_common(), ' has_deal:', Counter(ev[0]['has_deal'] for ev in orders.values()).most_common())

tot = [len(ev) for ev in orders.values()]
print('\n[B] events per order: median', med(tot), 'p90', pct(tot, 90), 'max', max(tot))
print('actions:', Counter(e['action'] for ev in orders.values() for e in ev).most_common())
print('action x role:', sorted(Counter((e['action'], e['role']) for ev in orders.values() for e in ev).items(), key=lambda x: -x[1])[:30])

fld = Counter(); fld_soon = Counter(); fld_late = Counter(); upd_n = 0; upd_soon = 0
upd_role = Counter()
for ev in orders.values():
    c = first(ev, 'create')
    for e in ev:
        if e['action'] != 'update': continue
        upd_n += 1; upd_role[e['role']] += 1
        mins = (e['t'] - c['t']).total_seconds() / 60
        soon = mins <= 10 and e['actor'] == c['actor']
        if soon: upd_soon += 1
        for f in (e['info'] or '').split(','):
            f = f.strip()
            if not f: continue
            fld[f] += 1
            (fld_soon if soon else fld_late)[f] += 1
print('\n[C] updates:', upd_n, ' by creator within 10 min of create:', upd_soon, ' roles:', upd_role.most_common())
print('fields edited (all):', fld.most_common(30))
print('fields by creator within 10 min:', fld_soon.most_common(15))
print('fields later/others:', fld_late.most_common(15))
print('orders with >=1 update:', sum(1 for ev in orders.values() if any(e['action'] == 'update' for e in ev)))
upc = [sum(1 for e in ev if e['action'] == 'update') for ev in orders.values()]
print('updates per order median', med(upc), 'p90', pct(upc, 90), 'max', max(upc))

KEY = {'create': 'C', 'take': 'T', 'executor_set': 'E', 'hired_set': 'H', 'driver_confirm': 'D', 'executor_remove': 'R', 'otboy_ack': 'O', 'transfer_out': 'X', 'transfer_in': 'I', 'set_manager': 'M'}
paths = Counter()
for ev in orders.values():
    seq = []
    for e in ev:
        a = e['action']
        if a == 'update': continue
        k = ('S:' + (e['info'] or '').split(' ')[-1][:4]) if a == 'status' else KEY.get(a, a)
        if seq and seq[-1] == k: continue
        seq.append(k)
    paths['>'.join(seq)] += 1
print('\n[D] top paths:')
for p, n in paths.most_common(15): print(' ', n, p)
print(' distinct paths:', len(paths))

gaps = defaultdict(list); lead = []
for ev in orders.values():
    c = first(ev, 'create'); tk = first(ev, 'take'); ex = first(ev, 'executor_set') or first(ev, 'hired_set')
    cf = first(ev, 'status', lambda e: (e['info'] or '') == 'unconfirmed -> confirmed')
    dc = first(ev, 'driver_confirm', lambda e: e['info'] == 'on')
    def g(a, b, k):
        if a and b: gaps[k].append((b['t'] - a['t']).total_seconds() / 60)
    g(c, tk, 'create->take'); g(tk, ex, 'take->executor'); g(c, ex, 'create->executor'); g(c, cf, 'create->confirmed'); g(ex, dc, 'executor->driver_confirm'); g(cf, ex, 'confirmed->executor')
    if c and c['service_date'] not in ('', 'NULL'):
        sd = datetime.strptime(c['service_date'], '%Y-%m-%d'); lead.append((sd - c['t']).total_seconds() / 3600)
print('\n[E] gaps minutes: median / p90 / n')
for k, v in gaps.items(): print(' ', k, med(v), pct(v, 90), len(v), ' negative:', sum(1 for x in v if x < 0))
print(' lead create->service_date 00:00 (h): median', med(lead), 'p10', pct(lead, 10), 'share <24h', round(sum(1 for x in lead if x < 24) / len(lead), 2), ' share<0 (same day or past)', round(sum(1 for x in lead if x < 0) / len(lead), 2))

rem = [sum(1 for e in ev if e['action'] == 'executor_remove') for ev in orders.values()]
print('\n[F] orders with executor_remove:', sum(1 for x in rem if x), ' removes', sum(rem))
print(' status transitions:', Counter(e['info'] for ev in orders.values() for e in ev if e['action'] == 'status').most_common())
print(' retakes:', sum(1 for ev in orders.values() for e in ev if e['action'] == 'take' and e['info'] == 'retake'))
sr = []
for ev in orders.values():
    last_set = None
    for e in ev:
        if e['action'] == 'executor_set': last_set = e
        if e['action'] == 'executor_remove' and last_set:
            sr.append(((e['t'] - last_set['t']).total_seconds() / 60, e['actor'] == last_set['actor'])); last_set = None
print(' set->remove min median', med([x for x, _ in sr]), ' same actor', sum(1 for _, s in sr if s), '/', len(sr), ' within 5 min', sum(1 for x, _ in sr if x <= 5))
reset_after = 0
for ev in orders.values():
    for i, e in enumerate(ev):
        if e['action'] == 'executor_remove' and any(x['action'] == 'executor_set' for x in ev[i + 1:]): reset_after += 1; break
print(' orders where remove followed by new set:', reset_after)

print('\n[G] routine candidates')
cc = []
for ev in orders.values():
    c = first(ev, 'create'); cf = first(ev, 'status', lambda e: (e['info'] or '') == 'unconfirmed -> confirmed')
    if c and cf: cc.append(((cf['t'] - c['t']).total_seconds() / 60, cf['actor'] == c['actor'], cf['role']))
print(' unconf->conf n', len(cc), ' by creator', sum(1 for _, s, _ in cc if s), ' <=2min', sum(1 for m, _, _ in cc if m <= 2), ' <=2min&creator', sum(1 for m, s, _ in cc if m <= 2 and s), ' roles', Counter(r for _, _, r in cc).most_common())
print('   minutes create->confirm buckets:', Counter('<=2' if m <= 2 else '2-30' if m <= 30 else '30-240' if m <= 240 else '>4h' for m, _, _ in cc).most_common())
never_conf = [ev for ev in orders.values() if not first(ev, 'status', lambda e: (e['info'] or '').endswith('confirmed')) and ev[0]['cur_status'] != 'cancelled']
print(' non-cancelled orders never confirmed via status:', len(never_conf), ' cur statuses', Counter(ev[0]['cur_status'] for ev in never_conf).most_common())
te = []
for ev in orders.values():
    tk = first(ev, 'take')
    if not tk: continue
    ex = first(ev, 'executor_set') or first(ev, 'hired_set')
    if ex: te.append(((ex['t'] - tk['t']).total_seconds() / 60, ex['actor'] == tk['actor']))
print(' take->executor n', len(te), ' same actor', sum(1 for _, s in te if s), ' same actor 0..2 min', sum(1 for m, s in te if s and 0 <= m <= 2), ' executor BEFORE take', sum(1 for m, _ in te if m < 0))
print(' executor but no take:', sum(1 for ev in orders.values() if (first(ev, 'executor_set') or first(ev, 'hired_set')) and not first(ev, 'take')))
print(' take by role:', Counter(e['role'] for ev in orders.values() for e in ev if e['action'] == 'take').most_common())
print(' executor_set by role:', Counter(e['role'] for ev in orders.values() for e in ev if e['action'] == 'executor_set').most_common())
print(' driver_confirm by role:', Counter(e['role'] for ev in orders.values() for e in ev if e['action'] == 'driver_confirm').most_common(), ' on/off', Counter(e['info'] for ev in orders.values() for e in ev if e['action'] == 'driver_confirm').most_common())
own_exec = [ev for ev in orders.values() if first(ev, 'executor_set')]
print(' orders with own executor:', len(own_exec), ' with driver_confirm on:', sum(1 for ev in own_exec if first(ev, 'driver_confirm', lambda e: e['info'] == 'on')))
oa = []
for ev in orders.values():
    cn = None
    for e in ev:
        if e['action'] == 'status' and (e['info'] or '').endswith('cancelled'): cn = e
        if e['action'] == 'otboy_ack' and cn: oa.append(((e['t'] - cn['t']).total_seconds() / 60, e['role'])); cn = None
cancels = sum(1 for ev in orders.values() for e in ev if e['action'] == 'status' and (e['info'] or '').endswith('cancelled'))
print(' cancels', cancels, ' otboy_ack after cancel n', len(oa), ' median min', med([m for m, _ in oa]), ' p90', pct([m for m, _ in oa], 90), ' roles', Counter(r for _, r in oa).most_common())
print(' otboy_ack total', sum(1 for ev in orders.values() for e in ev if e['action'] == 'otboy_ack'))
hs_orders = [ev for ev in orders.values() if first(ev, 'hired_set')]
print(' hired_set statuses:', Counter(e['info'] for ev in orders.values() for e in ev if e['action'] == 'hired_set').most_common(), ' orders', len(hs_orders), ' events/order median', med([sum(1 for e in ev if e['action'] == 'hired_set') for ev in hs_orders]))
today = datetime(2026, 9, 26)
past = [ev for ev in orders.values() if ev[0]['service_date'] not in ('', 'NULL') and datetime.strptime(ev[0]['service_date'], '%Y-%m-%d') < today]
print(' past-date orders:', len(past), ' cur status', Counter(ev[0]['cur_status'] for ev in past).most_common())
print(' transfers out:', sum(1 for ev in orders.values() for e in ev if e['action'] == 'transfer_out'), ' set_manager', sum(1 for ev in orders.values() for e in ev if e['action'] == 'set_manager'))
# people touching an order
ppl = [len(set(e['actor'] for e in ev if e['actor'])) for ev in orders.values()]
print(' distinct people per order: median', med(ppl), ' p90', pct(ppl, 90), ' dist', sorted(Counter(ppl).items()))
