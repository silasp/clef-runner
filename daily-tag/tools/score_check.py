#!/usr/bin/env python3
"""How accurate is the library? Compare its notes with arrangers' score files
and with numtags' transcriptions.

  score_check.py --work work --numtags numtags [--tags data/tags.json]

Pitch sequences are compared with repeated notes collapsed (so rhythm and
re-articulation don't count), after the best transposition (a score may be
in another key than the learning tracks) and, per part, the best octave.
Per part: recall (share of the reference's notes found), precision (share of
ours that are right), F1. Writes score_check.json.
"""
import argparse, glob, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from build_tags import align, collapse, PARTS  # noqa: E402
import score_parts, numtags_parts  # noqa: E402


def f1(ours, ref):
    if not ours or not ref:
        return 0.0, 0.0, 0.0
    recall, pairs = align(ours, ref)
    precision = len(pairs) / len(ours)
    return (2 * recall * precision / (recall + precision) if recall + precision else 0.0), recall, precision


def compare(ours, ref):
    """ours/ref: {part: [midi, ...]}. Best common shift, then best octave per part."""
    a = {p: collapse(ours[p]) for p in PARTS}
    best = None
    for sh in range(-11, 12):
        per = {}
        for p in PARTS:
            per[p] = max((f1(a[p], collapse([m + sh + o for m in ref[p]])) for o in (-12, 0, 12)), key=lambda x: x[0])
        mean = float(np.mean([v[0] for v in per.values()]))
        if best is None or mean > best[0]:
            best = (mean, sh, per)
    return best


def score_file(work, tid):
    for f in (f'{work}/notation/{tid}.mscz', f'{work}/notation/{tid}.xml', f'{work}/notation/{tid}.mxl', f'{work}/mxl/{tid}.mxl'):
        if os.path.exists(f) and os.path.getsize(f) > 0:
            return f
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    ap.add_argument('--numtags', default='numtags')
    ap.add_argument('--tags', default=os.path.join(os.path.dirname(__file__), '..', 'data', 'tags.json'))
    a = ap.parse_args()
    lib = {str(t['id']): t for t in json.load(open(a.tags))['tags']}
    nt = {}
    for f in glob.glob(f'{a.numtags}/data/tags/*.md'):
        meta, parts = numtags_parts.parse(open(f).read())
        if meta.get('tag_id') and all(len(parts[p]) >= 2 for p in PARTS):
            nt[str(meta['tag_id'])] = parts
    trans = {}
    for f in glob.glob(f'{a.work}/trans/*.json'):
        r = json.load(open(f))
        if r.get('ok'):
            trans[os.path.basename(f)[:-5]] = {p: [n[0] for n in r[p]['notes']] for p in PARTS}
    ids = sorted({os.path.basename(f).split('.')[0] for f in glob.glob(f'{a.work}/notation/*') + glob.glob(f'{a.work}/mxl/*.mxl')})
    report = {'scores': {}, 'numtags': {}}
    parsed = 0
    for tid in ids:
        f = score_file(a.work, tid)
        if not f:
            continue
        try:
            parts, _ = score_parts.to_parts(f)
        except Exception as e:  # noqa: BLE001
            report['scores'][tid] = {'file': f, 'error': str(e)[:120]}
            continue
        if not parts or any(sum(1 for n in parts[p] if n[0] is not None) < 2 for p in PARTS):
            report['scores'][tid] = {'file': f, 'error': 'could not split into four parts'}
            continue
        parsed += 1
        ref = {p: [n[0] for n in parts[p] if n[0] is not None] for p in PARTS}
        row = {'file': os.path.basename(f), 'notes': {p: len(ref[p]) for p in PARTS}}
        if tid in lib:
            m, sh, per = compare({p: [n[0] for n in lib[tid]['parts'][p]] for p in PARTS}, ref)
            row['library'] = {'source': lib[tid]['source'], 'f1': round(m, 3), 'shift': sh,
                              'parts': {p: [round(x, 2) for x in per[p]] for p in PARTS}}
        if tid in trans:
            m, sh, per = compare(trans[tid], ref)
            row['audio'] = {'f1': round(m, 3), 'shift': sh}
        if tid in nt:
            m, sh, per = compare(nt[tid], ref)
            row['numtags'] = {'f1': round(m, 3)}
        report['scores'][tid] = row
    # numtags vs library, where there's no score
    for tid, parts in nt.items():
        if tid in lib:
            m, sh, per = compare({p: [n[0] for n in lib[tid]['parts'][p]] for p in PARTS}, parts)
            report['numtags'][tid] = {'source': lib[tid]['source'], 'f1': round(m, 3)}
    json.dump(report, open('score_check.json', 'w'), indent=1)

    def summary(rows, key, by_source=True):
        out = {}
        for r in rows:
            if key not in r:
                continue
            s = r[key].get('source', 'all') if by_source else 'all'
            out.setdefault(s, []).append(r[key]['f1'])
        return {s: (len(v), round(float(np.mean(v)), 3), round(float(np.median(v)), 3)) for s, v in out.items()}

    rows = [r for r in report['scores'].values() if 'error' not in r]
    print(f'scores parsed: {parsed} of {len(ids)}')
    print('library vs score (n, mean F1, median F1) by source:', summary(rows, 'library'))
    print('audio transcription vs score:', summary(rows, 'audio', False))
    print('numtags vs score:', summary(rows, 'numtags', False))
    by = {}
    for r in report['numtags'].values():
        by.setdefault(r['source'], []).append(r['f1'])
    print('library vs numtags by source (n, mean F1):', {k: (len(v), round(float(np.mean(v)), 3)) for k, v in by.items()})
    errs = [(t, r['error']) for t, r in report['scores'].items() if 'error' in r]
    print('errors:', len(errs), errs[:8])


if __name__ == '__main__':
    main()
