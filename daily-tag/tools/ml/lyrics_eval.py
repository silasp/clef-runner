#!/usr/bin/env python3
"""Lyric placement accuracy against arrangers' score files that carry lyrics:
PDF-text method vs the speech-recognition method.  lyrics_eval.py --work work"""
import argparse, copy, json, os, re, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE)); sys.path.insert(0, HERE)
import pdf_lyrics, score_parts, build_tags as B  # noqa: E402
from gt import score_file  # noqa: E402
norm = lambda s: re.sub(r"[^a-z']", '', (s or '').lower())


def acc(pred, ref, parts=None):
    """Share of the score's syllables found on the same note (in the given parts)."""
    hit = tot = 0
    for p in parts or B.PARTS:
        for a, b in zip(pred[p], ref[p]):
            if b[4]:
                tot += 1
                hit += norm(a[4]) == norm(b[4])
    return hit / tot if tot else None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--work', default='work'); a = ap.parse_args()
    meta = {t['id']: t for t in __import__('omr_batch').all_tags(a.work)}
    res = {'pdf': [], 'speech': [], 'pdf_cover': 0, 'n': 0}
    for tid in json.load(open(f'{a.work}/gt.json')):
        pdf = f'{a.work}/sheets/{tid}.pdf'
        f = score_file(a.work, tid)
        if not (f and os.path.exists(pdf)):
            continue
        parts, _ = score_parts.to_parts(f)
        if not parts or not any(n[3] for p in B.PARTS for n in parts[p]):
            continue
        ref = {p: [[n[0], n[1], n[2], n[2], n[3], 'r' if n[0] is None else ''] for n in parts[p]] for p in B.PARTS}
        st = pdf_lyrics.staff_lyrics(pdf)
        if not st:
            res.setdefault('no_text', 0); res['no_text'] += 1
            continue
        res['n'] += 1
        pred = copy.deepcopy(ref)
        for p in B.PARTS:
            for n in pred[p]:
                n[4] = None
        done = pdf_lyrics.apply(pred, st)
        if done:
            res['pdf_cover'] += 1
            res['pdf'].append(acc(pred, ref, done))
        # speech method on the same notes, timed as the build would time them
        wf = f'{a.work}/words/{tid}.json'
        heard = json.load(open(wf)) if os.path.exists(wf) else {}
        lyr = meta[tid].get('Lyrics') or ''
        sp = copy.deepcopy(ref)
        for p in B.PARTS:
            sung = [n for n in sp[p] if 'r' not in n[5]]
            times = B.word_times(lyr, heard.get(p, [])) or B.word_times(lyr, heard.get('Lead', []))
            # score notes are in beats: put them on a seconds axis via the recorded Lead's span
            for n, sy in zip(sung, B.attach_syllables([[n[0], n[1] * 0.6, n[2] * 0.6] for n in sung], lyr, times)):
                n[4] = sy
        res['speech'].append(acc(sp, ref))
    pdfv = [v for v in res['pdf'] if v is not None]; spv = [v for v in res['speech'] if v is not None]
    print(f"{res['n']} tags with score lyrics + text PDF; PDF method placed lyrics on {res['pdf_cover']}: "
          f"accuracy on the parts it placed {np.mean(pdfv):.3f} (median {np.median(pdfv):.3f}); "
          f"{res.get('no_text', 0)} PDFs had no embedded music text")


if __name__ == '__main__':
    main()
