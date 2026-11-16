"""Analyses TAM questionnaire responses (CSV in the format of the
instruments doc) and prints the Chapter 4 statistics as Markdown.

    python analyse_tam.py responses.csv [--label "SIMULATED DATA"]
"""
import csv, statistics as st, sys
sys.stdout.reconfigure(encoding="utf-8")
from collections import Counter

path = sys.argv[1]
label = sys.argv[sys.argv.index('--label') + 1] if '--label' in sys.argv else None
rows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
n = len(rows)
C = {'PU': [f'PU{i}' for i in range(1, 7)], 'PEOU': [f'PEOU{i}' for i in range(1, 7)], 'BI': ['BI1', 'BI2']}
TASKS = [f'task{i}' for i in range(1, 8)]

def q(xs, p):
    xs = sorted(xs); k = (len(xs) - 1) * p; f = int(k)
    return xs[f] + (xs[min(f + 1, len(xs) - 1)] - xs[f]) * (k - f)

def alpha(items):
    k = len(items); m = [[float(r[i]) for i in items] for r in rows]
    iv = sum(st.variance([x[j] for x in m]) for j in range(k))
    tv = st.variance([sum(x) for x in m])
    return k / (k - 1) * (1 - iv / tv)

def ranks(xs):
    s = sorted(range(len(xs)), key=lambda i: xs[i]); r = [0.0] * len(xs); i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and xs[s[j + 1]] == xs[s[i]]: j += 1
        for t in range(i, j + 1): r[s[t]] = (i + j) / 2 + 1
        i = j + 1
    return r

def spearman(a, b):
    ra, rb = ranks(a), ranks(b)
    ma, mb = st.mean(ra), st.mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    return num / (sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb)) ** 0.5

score = {c: [st.mean(float(r[i]) for i in its) for r in rows] for c, its in C.items()}
if label: print(f'> **{label}** — not responses from real participants.\n')
print(f'N = {n}\n\n## Participants\n')
for f in ['role', 'years', 'org_type', 'ehr_use', 'blockchain_familiarity']:
    cnt = Counter(r[f] for r in rows)
    print(f'**{f}**: ' + '; '.join(f'{k} {v} ({v/n:.0%})' for k, v in cnt.most_common()) + '\n')
print('## Construct scores (1–5)\n\n| Construct | Items | Mean | SD | Median | IQR | Cronbach α |\n|---|---|---|---|---|---|---|')
for c, its in C.items():
    s = score[c]
    print(f'| {c} | {len(its)} | {st.mean(s):.2f} | {st.stdev(s):.2f} | {st.median(s):.2f} | {q(s,.25):.2f}–{q(s,.75):.2f} | {alpha(its):.2f} |')
print('\n## Items\n\n| Item | Mean | SD | % agree (4–5) |\n|---|---|---|---|')
for its in C.values():
    for i in its:
        v = [int(r[i]) for r in rows]
        print(f'| {i} | {st.mean(v):.2f} | {st.stdev(v):.2f} | {sum(x >= 4 for x in v)/n:.0%} |')
print('\n## Correlations (Spearman, exploratory)\n')
for a, b in [('PEOU', 'PU'), ('PU', 'BI'), ('PEOU', 'BI')]:
    print(f'- {a}–{b}: ρ = {spearman(score[a], score[b]):.2f}')
print('\n## Task completion\n\n| Task | Unaided | With help | Not completed |\n|---|---|---|---|')
for t in TASKS:
    cnt = Counter(r[t] for r in rows)
    print(f'| {t} | {cnt["U"]/n:.0%} | {cnt["H"]/n:.0%} | {cnt["N"]/n:.0%} |')
for f in ['comment_most_useful', 'comment_confusing', 'comment_improve']:
    if f in rows[0]:
        cnt = Counter(r[f] for r in rows if r[f].strip())
        print(f'\n## {f}\n')
        for k, v in cnt.most_common(6): print(f'- ({v}) {k}')
