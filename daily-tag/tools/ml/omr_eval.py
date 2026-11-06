#!/usr/bin/env python3
"""How well does the sheet-music reader (homr OMR + voice split) match the
arrangers' scores?  omr_eval.py --work work"""
import argparse, json, os, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import omr_parts, score_parts  # noqa: E402
from evalkit import score, PARTS  # noqa: E402


def variant_split(path):
    """The current reader: chords per staff, top/bottom note."""
    sp = omr_parts.split_voices(omr_parts.read_events(path))
    parts = {p: [[n[0], n[1], n[2]] for n in sp[p]] for p in PARTS}
    score_parts.fix_octaves({p: [[n[0], n[1], n[2], None, ''] for n in parts[p]] for p in PARTS})
    return parts


def variant_reader(path):
    """The score reader (voices where homr wrote them, octave normalisation)."""
    parts, _ = score_parts.to_parts(path)
    return parts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    a = ap.parse_args()
    gt = json.load(open(f'{a.work}/gt.json'))
    res = {}
    for name, fn in (('split', variant_split), ('reader', variant_reader)):
        vals = []
        for tid, g in gt.items():
            f = f'{a.work}/sheets/{tid}.musicxml'
            if not os.path.exists(f):
                continue
            try:
                parts = fn(f)
            except Exception:  # noqa: BLE001
                parts = None
            vals.append(score(parts, g)[0] if parts else 0.0)
        res[name] = vals
        print(f'{name:8s} n={len(vals)} mean F1 {np.mean(vals):.3f} median {np.median(vals):.3f}')
    json.dump(res, open('omr_eval.json', 'w'))


if __name__ == '__main__':
    main()
