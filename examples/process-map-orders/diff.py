import csv, sys
from collections import Counter, defaultdict
from datetime import datetime
sys.stdout.reconfigure(encoding='utf-8')
D = sys.argv[1]
F = open(D + '/snap_fields.txt', encoding='utf-8').read().split('\n')
tl = {r['id']: r for r in csv.DictReader(open(D + '/timeline.tsv', encoding='utf-8'), delimiter='\t')}
rows = []
with open(D + '/snap.tsv', encoding='utf-8') as fh:
    rd = csv.reader(fh, delimiter='\t'); next(rd)
    for r in rd: rows.append({'src': r[0], 'id': r[1], 'order': r[2], 'action': r[3], 'v': dict(zip(F, r[4:]))})
by = defaultdict(list)
for r in rows: by[r['order']].append(r)
IGN = {'status', 'taken_by', 'manager_email'}
chg = Counter(); noop = 0; n = 0; per_update = []
soon_chg = Counter(); late_chg = Counter(); soon_n = 0; late_n = 0; soon_noop = 0
align_noise = Counter(); align_n = 0
for oid, ev in by.items():
    create = next((e for e in ev if e['action'] == 'create'), None)
    ct = datetime.strptime(tl[create['id']]['at_msk'], '%Y-%m-%d %H:%M:%S') if create and create['id'] in tl else None
    cactor = tl[create['id']]['actor'] if create and create['id'] in tl else None
    if create and tl.get(create['id'], {}).get('deleted') == '1': continue
    dbs = [e for e in ev if e['action'] != 'create']  # снимки, загруженные из БД + текущая строка
    for i, e in enumerate(dbs):
        if e['action'] == 'current': continue
        nxt = dbs[i + 1] if i + 1 < len(dbs) else None
        if not nxt: continue
        if e['action'] != 'update':
            if e['action'] in ('status',) and nxt['action'] == 'current':
                align_n += 1
                for f in F:
                    if f in IGN: continue
                    if e['v'][f] != nxt['v'][f]: align_noise[f] += 1
            continue
        d = [f for f in F if f not in IGN and e['v'][f] != nxt['v'][f]]
        n += 1; per_update.append(len(d))
        t = tl.get(e['id']); soon = False
        if t and ct:
            mins = (datetime.strptime(t['at_msk'], '%Y-%m-%d %H:%M:%S') - ct).total_seconds() / 60
            soon = mins <= 10 and t['actor'] == cactor
        if not d:
            noop += 1
            if soon: soon_noop += 1
        for f in d: chg[f] += 1
        if soon:
            soon_n += 1
            for f in d: soon_chg[f] += 1
        else:
            late_n += 1
            for f in d: late_chg[f] += 1
print('alignment check (status snapshot vs current row, should be ~0):', align_n, align_noise.most_common(8))
print('updates analysed', n, ' NO real change:', noop, ' (soon-after-create no-op:', soon_noop, ')')
print('changed fields per update:', sorted(Counter(per_update).items()))
print('fields really changed (all):', chg.most_common(30))
print('\nby creator within 10 min of create (n=%d):' % soon_n, soon_chg.most_common(15))
print('later / by others (n=%d):' % late_n, late_chg.most_common(15))

EMPTY = 'd41d8cd9'
kinds = defaultdict(Counter); coord_only = Counter(); coord_n = Counter()
for oid, ev in by.items():
    dbs = [e for e in ev if e['action'] != 'create']
    for i, e in enumerate(dbs):
        if e['action'] != 'update' or i + 1 >= len(dbs): continue
        a, b = e['v'], dbs[i + 1]['v']
        for f in F:
            if f in IGN or a[f] == b[f]: continue
            kinds[f]['fill' if a[f] == EMPTY else 'clear' if b[f] == EMPTY else 'change'] += 1
        for side in ('load', 'unload'):
            if a[side + '_lat'] != b[side + '_lat']:
                coord_n[side] += 1
                if a[side + '_address'] == b[side + '_address']: coord_only[side] += 1
print('\nchange kinds:')
for f in ['service_time', 'note', 'price', 'load_contact_name', 'load_contact_phone', 'unload_contact_name', 'unload_contact_phone', 'load_address', 'unload_address', 'cargo', 'cargo_weight_t', 'equipment_type', 'load_lat', 'unload_lat']:
    print(' ', f, dict(kinds[f]))
print('coordinates changed with SAME address text:', dict(coord_only), ' of', dict(coord_n))
