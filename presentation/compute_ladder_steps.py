"""Paired-bootstrap CI for each consecutive step of the 6-model ladder -> do_an_may_hoc/results/ladder_steps.json.

Uses the same protocol as the notebook (2,000 resamples of test sentences, numpy default_rng(42), identical draws
for every model), so the CIs match model_comparison.json wherever the pairs overlap.
Usage: python compute_ladder_steps.py <do_an_may_hoc dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
from seqeval.metrics.sequence_labeling import get_entities

PKG = Path(sys.argv[1])
RES = PKG / 'results'
ORDER = ['Logistic Regression', 'Linear SVM', 'CRF', 'XLM-R', 'PhoBERT', 'ViHealthBERT']

table = pq.read_table(next((PKG / 'data' / 'vietmed-ner' / 'data').glob('test-*.parquet')), columns=['labels']).to_pydict()
gold = [['O' if str(t) in ('0', 'O') else str(t) for t in row] for row in table['labels']]
preds = json.loads((RES / 'test_predictions.json').read_text())
gold_sets = [set(get_entities(t)) for t in gold]


def counts(pred):
    ps = [set(get_entities(t)) for t in pred]
    return (np.array([len(a & b) for a, b in zip(gold_sets, ps)]), np.array([len(a) for a in gold_sets]),
            np.array([len(b) for b in ps]))


def f1(tp, ng, npd):
    p, r = tp.sum() / max(npd.sum(), 1), tp.sum() / max(ng.sum(), 1)
    return 2 * p * r / (p + r) if p + r else 0.0


C = {m: counts(preds[m]) for m in ORDER}
point = {m: f1(*C[m]) for m in ORDER}
rng = np.random.default_rng(42)
n = len(gold)
boot = {m: [] for m in ORDER}
for _ in range(2000):
    idx = rng.integers(0, n, n)
    for m in ORDER:
        tp, ng, npd = C[m]
        boot[m].append(f1(tp[idx], ng[idx], npd[idx]))
boot = {m: np.array(v) for m, v in boot.items()}
steps = []
for prev, cur in zip(ORDER[:-1], ORDER[1:]):
    d = boot[cur] - boot[prev]
    steps.append({'from': prev, 'to': cur, 'delta': point[cur] - point[prev],
                  'ci95': [float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))]})
(RES / 'ladder_steps.json').write_text(json.dumps({'protocol': 'paired bootstrap, 2000 resamples, default_rng(42)', 'steps': steps}, indent=1))
for s in steps:
    print(f"{s['from']} -> {s['to']}: {s['delta'] * 100:+.2f} CI [{s['ci95'][0] * 100:+.2f}; {s['ci95'][1] * 100:+.2f}]")
