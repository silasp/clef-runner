#!/usr/bin/env python3
"""Lyrics accuracy against arrangers' score files that carry lyrics.

Two measures, per part, averaged:
  on-note  — share of the score's syllables placed on the same note
  words    — F1 of the syllable sequence (right words in the right order)
Methods, all applied to the score's own notes:
  pdf-glyph  — PDF text with Finale-style music-font glyphs (pdf_lyrics.staff_lyrics_text)
  pdf-any    — font-independent: staff lines + note-sized glyphs/shapes (pdf_lyrics.staff_lyrics)
  speech     — words from the tag's lyrics, timed by speech recognition (the build's fallback)
  lyrics_eval.py --work work"""
import argparse, copy, json, os, re, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE)); sys.path.insert(0, HERE)
import pdf_lyrics, score_parts, build_tags as B  # noqa: E402
from gt import score_file  # noqa: E402
from evalkit import f1  # noqa: E402
norm = lambda s: re.sub(r"[^a-z']", '', (s or '').lower())


def on_note(pred, ref, parts):
    hit = tot = 0
    for p in parts:
        for a, b in zip(pred[p], ref[p]):
            if b[4]:
                tot += 1; hit += norm(a[4]) == norm(b[4])
    return hit / tot if tot else None


def words(pred, ref, parts):
    vals = []
    for p in parts:
        r = [norm(n[4]) for n in ref[p] if n[4]]
        q = [norm(n[4]) for n in pred[p] if n[4]]
        if r:
            ids = {w: i for i, w in enumerate(sorted(set(r) | set(q)))}
            vals.append(f1([ids[w] for w in q], [ids[w] for w in r]) if q else 0.0)
    return float(np.mean(vals)) if vals else None


def blank(ref):
    pred = copy.deepcopy(ref)
    for p in pred:
        for n in pred[p]:
            n[4] = None
    return pred


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--work', default='work'); a = ap.parse_args()
    meta = {t['id']: t for t in __import__('omr_batch').all_tags(a.work)}
    R = {k: {'on': [], 'words': [], 'tags': 0} for k in ('pdf-glyph', 'pdf-any', 'speech')}
    for tid in json.load(open(f'{a.work}/gt.json')):
        pdf = f'{a.work}/sheets/{tid}.pdf'
        f = score_file(a.work, tid)
        if not (f and os.path.exists(pdf)):
            continue
        parts, _ = score_parts.to_parts(f)
        if not parts or not any(n[3] for p in B.PARTS for n in parts[p]):
            continue
        audio = B.tuned_audio(a.work, tid)
        wf = f'{a.work}/words/{tid}.json'
        heard = json.load(open(wf)) if os.path.exists(wf) else {}
        timed = B.score_times(parts, audio['Lead'] if audio else None, 0,
                              B.score_word_anchors({p: [[n[0], n[1], n[2], None, ''] for n in parts[p]] for p in B.PARTS}, heard.get('Lead', [])))
        ref = {p: [n[:4] + [parts[p][i][3] or ('' if n[0] is not None else '')] + [n[5] if len(n) > 5 else ''] for i, n in enumerate(timed[p])] for p in B.PARTS}
        for name, reader in (('pdf-glyph', pdf_lyrics.staff_lyrics_text), ('pdf-any', pdf_lyrics.staff_lyrics)):
            try:
                st = reader(pdf)
            except Exception:  # noqa: BLE001
                st = None
            pred = blank(ref)
            done = pdf_lyrics.apply(pred, st) if st else []
            if done:
                R[name]['tags'] += 1
                R[name]['on'].append(on_note(pred, ref, done)); R[name]['words'].append(words(pred, ref, done))
        pred = blank(ref)
        lyr = meta[tid].get('Lyrics') or B.heard_text(a.work, tid)
        for p in B.PARTS:
            sung = [n for n in pred[p] if 'r' not in n[5]]
            times = B.word_times(lyr, heard.get(p, [])) or B.word_times(lyr, heard.get('Lead', []))
            for n, sy in zip(sung, B.attach_syllables([n[:3] for n in sung], lyr, times)):
                n[4] = sy
        R['speech']['tags'] += 1
        R['speech']['on'].append(on_note(pred, ref, B.PARTS)); R['speech']['words'].append(words(pred, ref, B.PARTS))
    for k, v in R.items():
        on = [x for x in v['on'] if x is not None]; wd = [x for x in v['words'] if x is not None]
        print(f"{k:10s} tags {v['tags']:3d}  on-note {np.mean(on) if on else 0:.3f}  words {np.mean(wd) if wd else 0:.3f}")


if __name__ == '__main__':
    main()
