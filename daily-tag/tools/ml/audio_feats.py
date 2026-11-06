#!/usr/bin/env python3
"""Cache the expensive audio analysis once per tag, so note segmentation can
be tuned and learned quickly:

  audio_feats.py --work work [--ids gt|all] [--workers 3]

For each part of each tag: the demixed voice's pYIN f0 (Hz, nan unvoiced),
voiced probability and RMS, plus the cross-file "contrast" pitch track
(octave-reliable). Saved to <work>/feat/<id>.npz.
"""
import argparse, json, os, sys
from concurrent.futures import ProcessPoolExecutor

os.environ.setdefault('OMP_NUM_THREADS', '1')
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
PARTS = ['Tenor', 'Lead', 'Bari', 'Bass']


def one(args):
    tid, work = args
    out = f'{work}/feat/{tid}.npz'
    if os.path.exists(out):
        return tid, 'cached'
    import librosa
    import extract_notes as X
    try:
        Y = {}
        for p in PARTS:
            y, _ = librosa.load(f'{work}/audio/{tid}_{p}.mp3', sr=X.SR, mono=False)
            Y[p] = y if y.ndim == 2 else np.vstack([y, y])
        n = min(y.shape[1] for y in Y.values())
        Y = {p: y[:, :n] for p, y in Y.items()}
        resid, side, cs, voices = X.demix(Y)
        cm = X.contrast_midi({p: Y[p][side] for p in PARTS})
        arrs = {'resid': np.array(resid)}
        for i, p in enumerate(PARTS):
            v = voices[i]
            v = (v / (np.abs(v).max() + 1e-9)).astype('float32')
            lo, hi = X.F0_RANGE[p]
            f0, vf, vp = librosa.pyin(v, fmin=lo, fmax=hi, sr=X.SR, hop_length=X.HOP, frame_length=2048)
            rms = librosa.feature.rms(y=v, frame_length=2048, hop_length=X.HOP)[0][:len(f0)]
            T = min(len(f0), len(cm[p]))
            arrs[f'{p}_f0'] = np.where(vf, f0, np.nan)[:T].astype('float32')
            arrs[f'{p}_vp'] = vp[:T].astype('float32')
            arrs[f'{p}_rms'] = rms[:T].astype('float32')
            arrs[f'{p}_cm'] = cm[p][:T].astype('float32')
        np.savez_compressed(out, **arrs)
        return tid, 'ok'
    except Exception as e:  # noqa: BLE001
        return tid, f'error {e}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    ap.add_argument('--ids', default='gt')
    ap.add_argument('--workers', type=int, default=3)
    a = ap.parse_args()
    os.makedirs(f'{a.work}/feat', exist_ok=True)
    gt = list(json.load(open(f'{a.work}/gt.json')))
    have = {f.split('_')[0] for f in os.listdir(f'{a.work}/audio')}
    if a.ids == 'gt':
        ids = [t for t in gt if t in have]
    else:
        trans = [f[:-5] for f in os.listdir(f'{a.work}/trans')]
        ids = [t for t in gt if t in have] + sorted(t for t in trans if t in have and t not in gt)
    with ProcessPoolExecutor(a.workers) as ex:
        for k, (tid, st) in enumerate(ex.map(one, [(t, a.work) for t in ids])):
            print(k + 1, len(ids), tid, st, flush=True)


if __name__ == '__main__':
    main()
