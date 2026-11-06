#!/usr/bin/env python3
"""When should the build trust a sheet reading over the audio transcription?
On ground-truth tags, compare sheet F1 and audio F1 with the sheet↔audio
agreement the build can compute without ground truth.  sheet_gate.py --work work"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE)); sys.path.insert(0, HERE)
import audio_tune as AT, fusion  # noqa: E402
from evalkit import score, PARTS  # noqa: E402
from build_tags import agreement  # noqa: E402


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--work', default='work'); a = ap.parse_args()
    mf = os.path.join(HERE, 'audio_model.json')
    P = json.load(open(mf))['params'] if os.path.exists(mf) else AT.DEFAULT
    data = fusion.load(a.work, P)
    rows = []
    for t, d in data.items():
        sheet = {p: [n for n in d['sheet'][p] if n[0] is not None] for p in PARTS}
        audio = {p: [n[:3] for n in d['audio'][p]] for p in PARTS}
        if any(len(audio[p]) < 2 for p in PARTS):
            continue
        mean, sh, sc = agreement(audio, sheet)
        rows.append((mean, min(sc.values()), score(d['sheet'], d['gt'])[0], score(d['audio'], d['gt'])[0]))
    rows = np.array(rows)
    print(f'n={len(rows)}  sheet F1 {rows[:, 2].mean():.3f}  audio F1 {rows[:, 3].mean():.3f}')
    for thr in (0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75):
        use = rows[:, 0] >= thr
        chosen = np.where(use, rows[:, 2], rows[:, 3])
        print(f'  use sheet when agreement ≥ {thr:.2f}: {use.sum():3d} sheet / {(~use).sum():3d} audio → F1 {chosen.mean():.3f}'
              f'   (sheet F1 among used {rows[use, 2].mean() if use.any() else 0:.3f}, rejected {rows[~use, 2].mean() if (~use).any() else 0:.3f})')


if __name__ == '__main__':
    main()
