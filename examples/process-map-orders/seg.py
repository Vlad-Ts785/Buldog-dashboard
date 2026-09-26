import csv, sys, statistics as st
from collections import Counter, defaultdict
from datetime import datetime
sys.stdout.reconfigure(encoding='utf-8')
D = sys.argv[1]
F = open(D + '/seg_fields.txt', encoding='utf-8').read().split('\n')
rows = []
with open(D + '/seg.tsv', encoding='utf-8') as fh:
    rd = csv.reader(fh, delimiter='\t'); next(rd)
    for r in rd:
        rows.append({'src': r[0], 'id': int(r[1]), 'seg': r[2], 'action': r[3], 'actor': r[4], 'role': r[5],
                     't': datetime.strptime(r[6], '%Y-%m-%d %H:%M:%S') if r[6] not in ('', 'NULL') else None,
                     'kind': r[7], 'has_order': r[8], 'v': dict(zip(F, r[9:]))})
by = defaultdict(list)
for r in rows: by[r['seg']].append(r)
print('segments created >=18.09:', len(by))
kinds = Counter(); linked = Counter()
for s, ev in by.items():
    c = next((e for e in ev if e['action'] == 'create'), None)
    if c: kinds[c['kind']] += 1; linked[c['has_order']] += 1
print('kind at create:', kinds.most_common(), ' linked to order (from Задание):', linked.most_common())
print('actions:', Counter(e['action'] for ev in by.values() for e in ev).most_common())
print('actions x role:', Counter((e['action'], e['role']) for ev in by.values() for e in ev if e['src'] == 'h').most_common(12))
chg = Counter(); combos = Counter(); n = 0; noop = 0; per_kind = defaultdict(Counter)
ow_per_seg = []
for s, ev in by.items():
    ow_per_seg.append(sum(1 for e in ev if e['action'] == 'overwrite'))
    for i, e in enumerate(ev):
        if e['action'] != 'overwrite' or i + 1 >= len(ev): continue
        nx = ev[i + 1]
        d = [f for f in F if e['v'][f] != nx['v'][f]]
        n += 1
        if not d: noop += 1
        for f in d: chg[f] += 1; per_kind[e['kind']][f] += 1
        combos['+'.join(sorted(d)) or '(nothing)'] += 1
print('\noverwrites analysed', n, ' no-op', noop)
print('overwrites per segment: median', st.median(ow_per_seg), ' max', max(ow_per_seg), ' dist', sorted(Counter(min(x, 10) for x in ow_per_seg).items()))
print('fields changed:', chg.most_common())
print('top combos:', combos.most_common(12))
for k, c in per_kind.items(): print(' kind', k, c.most_common(6))
# stage progression: consecutive stage-only changes
stage_only = combos.get('stage', 0)
print('stage-only overwrites:', stage_only)
# same-actor quick successive overwrites (fiddling): overwrite within 60s of previous action on same seg by same actor
quick = 0; tot = 0
for s, ev in by.items():
    hs = [e for e in ev if e['src'] == 'h' and e['t']]
    for a, b in zip(hs, hs[1:]):
        if b['action'] == 'overwrite':
            tot += 1
            if (b['t'] - a['t']).total_seconds() <= 60 and a['actor'] == b['actor']: quick += 1
print('overwrites within 60s of previous action by same person:', quick, 'of', tot)
