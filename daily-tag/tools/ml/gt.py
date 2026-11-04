#!/usr/bin/env python3
"""Ground truth for tuning: tags whose arranger score is machine-readable
with certainty (MuseScore / MusicXML / Finale .musx — not the .mus reader,
whose output is gated on agreeing with the audio and would make the
evaluation circular).

  gt.py --work work            → work/gt.json  {id: {part: [[midi|None, beat, beats], ...]}}

Also records which tags have an OMR reading and audio transcription.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import score_parts  # noqa: E402

PARTS = ['Tenor', 'Lead', 'Bari', 'Bass']


def score_file(work, tid):
    for f in (f'{work}/notation/{tid}.mscz', f'{work}/notation/{tid}.xml', f'{work}/notation/{tid}.mxl', f'{work}/mxl/{tid}.mxl'):
        if os.path.exists(f) and os.path.getsize(f) > 0:
            return f
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    a = ap.parse_args()
    ids = sorted({f.split('.')[0] for f in os.listdir(f'{a.work}/notation')} | {f.split('.')[0] for f in os.listdir(f'{a.work}/mxl')})
    gt = {}
    for tid in ids:
        if not tid.isdigit():
            continue
        f = score_file(a.work, tid)
        if not f:
            continue
        try:
            parts, _ = score_parts.to_parts(f)
        except Exception:  # noqa: BLE001
            continue
        if not parts or any(sum(1 for n in parts[p] if n[0] is not None) < 2 for p in PARTS):
            continue
        gt[tid] = {p: [[n[0], n[1], n[2]] for n in parts[p]] for p in PARTS}
    json.dump(gt, open(f'{a.work}/gt.json', 'w'))
    omr = sum(os.path.exists(f'{a.work}/sheets/{t}.musicxml') for t in gt)
    aud = sum(os.path.exists(f'{a.work}/trans/{t}.json') for t in gt)
    print(len(gt), 'ground-truth tags;', omr, 'with an OMR reading;', aud, 'with an audio transcription')


if __name__ == '__main__':
    main()
