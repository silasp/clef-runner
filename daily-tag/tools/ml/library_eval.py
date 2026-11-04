#!/usr/bin/env python3
"""End-to-end accuracy of the library build for tags *without* an arranger's
score: rebuild the ground-truth tags with --no-scores and compare.
  library_eval.py --work work"""
import argparse, json, os, subprocess, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE)); sys.path.insert(0, HERE)
from evalkit import score  # noqa: E402


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--work', default='work'); a = ap.parse_args()
    gt = json.load(open(f'{a.work}/gt.json'))
    out = 'library_eval_tags.json'
    subprocess.run([sys.executable, os.path.join(os.path.dirname(HERE), 'build_tags.py'), '--work', a.work, '--top', '1000',
                    '--no-scores', '--only', ','.join(gt), '--out', out], check=True, capture_output=True)
    tags = {str(t['id']): t for t in json.load(open(out))['tags']}
    by = {}
    for tid, g in gt.items():
        if tid not in tags:
            by.setdefault('rejected', []).append(0.0); continue
        t = tags[tid]
        parts = {p: [n for n in t['parts'][p] if 'r' not in (n[5] if len(n) > 5 else '')] for p in g}
        by.setdefault(t['source'], []).append(score(parts, g)[0])
    allv = [v for k, vs in by.items() if k != 'rejected' for v in vs]
    print('built', len(allv), 'of', len(gt), '— mean F1', round(float(np.mean(allv)), 3),
          {k: (len(v), round(float(np.mean(v)), 3)) for k, v in by.items()})


if __name__ == '__main__':
    main()
