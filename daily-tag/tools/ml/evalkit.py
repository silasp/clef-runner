"""Shared evaluation for the tuning scripts.

Metric: note-sequence F1 per part between a reading and the ground truth,
with repeated notes collapsed (rhythm and re-articulation don't count),
after the single best transposition of the whole tag (a score may be in a
different key than the recording) — but no per-part octave freedom: a part
an octave off is wrong. Mean over the four parts, then over tags.
"""
import os, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from build_tags import align, collapse  # noqa: E402

PARTS = ['Tenor', 'Lead', 'Bari', 'Bass']


def f1(ours, ref):
    if not ours or not ref:
        return 0.0
    recall, pairs = align(ours, ref)
    precision = len(pairs) / len(ours)
    return 2 * recall * precision / (recall + precision) if recall + precision else 0.0


def pitches(notes):
    return [n[0] for n in notes if n[0] is not None]


def score(ours, gt, shifts=range(-12, 13)):
    """ours/gt: {part: notes [[midi|None, ...]]}. → (mean F1, best shift, per-part F1)."""
    a = {p: collapse(pitches(ours.get(p, []))) for p in PARTS}
    g = {p: pitches(gt[p]) for p in PARTS}
    best = (-1, 0, {})
    for sh in shifts:
        per = {p: f1(a[p], collapse([m + sh for m in g[p]])) for p in PARTS}
        mean = float(np.mean(list(per.values())))
        if mean > best[0]:
            best = (mean, sh, per)
    return best


def folds(ids, k=5, seed=7):
    """Grouped K-fold over tags (a tag's parts never straddle train/test)."""
    rng = np.random.default_rng(seed)
    ids = list(ids)
    rng.shuffle(ids)
    return [ids[i::k] for i in range(k)]
