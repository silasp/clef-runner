#!/usr/bin/env python3
"""Tune the audio note segmentation against arrangers' scores.

  audio_tune.py --work work [--trials 300]

Stage 1 — hyperparameter search. Note segmentation (voicing / loudness
gates, median smoothing, local tuning drift, glide absorption, gap
merging, minimum note length, octave-slip repair, contrast octave vote) is
parameterised; random search picks the parameters. Evaluation is grouped
5-fold cross-validation over tags: parameters chosen on 4 folds are scored
on the held-out fold, so the reported F1 is out-of-sample.

Stage 2 — a learned note filter. Each segmented note gets features
(duration, voicing, loudness, pitch stability, contrast agreement, interval
to neighbours, …) and a label from aligning to the ground truth: keep, move
up/down an octave, or drop. A gradient-boosted classifier (scikit-learn
HistGradientBoosting, class-weighted) is trained on 4 folds and applied to
the 5th; decisions are only taken above a confidence threshold, itself
chosen on the training folds.

Writes ml/audio_model.json (parameters) and ml/audio_clf.pkl (classifier,
trained on all ground-truth tags), and prints the CV report.
"""
import argparse, json, os, pickle, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from evalkit import f1, score, folds, PARTS, pitches  # noqa: E402
from build_tags import align, collapse  # noqa: E402

FR = 256 / 22050          # extract_notes HOP / SR

DEFAULT = dict(vthr=0.0, rms_rel=0.05, med_w=7, drift_s=0.0, glide_ms=60, gap_ms=45, min_ms=100,
               slip_dist=8, slip_margin=6, slip_win=4, cm_vote=0.5, cm_use=1)
SPACE = dict(vthr=[0.0, 0.1, 0.2, 0.3, 0.4, 0.5], rms_rel=[0.02, 0.035, 0.05, 0.08, 0.12],
             med_w=[3, 5, 7, 9, 11, 15], drift_s=[0.0, 1.0, 2.0, 4.0], glide_ms=[30, 45, 60, 90, 120],
             gap_ms=[20, 45, 80, 120], min_ms=[60, 80, 100, 130, 160, 200], slip_dist=[7, 8, 9, 10],
             slip_margin=[4, 6, 8], slip_win=[3, 4, 6], cm_vote=[0.35, 0.5, 0.65, 0.8], cm_use=[0, 1])


def medfilt(x, w):
    """NaN-aware running median (unvoiced frames stay unvoiced)."""
    if w <= 1 or len(x) == 0:
        return x
    import warnings
    h = w // 2
    pad = np.concatenate([np.full(h, np.nan), x, np.full(h, np.nan)])
    win = np.lib.stride_tricks.sliding_window_view(pad, 2 * h + 1)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        out = np.nanmedian(win, axis=1)
    return np.where(np.isnan(x), np.nan, out)


def segment(F, part, P):
    """Cached frame features → notes [[midi, start, dur, info]], info for the classifier."""
    f0, vp, rms, cm = F[f'{part}_f0'], F[f'{part}_vp'], F[f'{part}_rms'], F[f'{part}_cm']
    midi = 12 * np.log2(f0 / 440.0) + 69
    ok = ~np.isnan(midi) & (vp >= P['vthr']) & (rms > P['rms_rel'] * np.nanmax(rms))
    m = medfilt(np.where(ok, midi, np.nan), int(P['med_w']))
    v = ~np.isnan(m)
    if not v.any():
        return []
    # tuning: global, or drifting (rolling median of the fractional offset)
    frac = (m + 0.5) % 1 - 0.5
    if P['drift_s'] > 0:
        w = max(3, int(P['drift_s'] / FR))
        off = np.full(len(m), np.nan)
        idx = np.flatnonzero(v)
        off[idx] = medfilt(frac[idx], w)
    else:
        off = np.full(len(m), float(np.median(frac[v])))
    q = np.round(m - off)
    runs, i, n = [], 0, len(q)
    while i < n:
        if np.isnan(q[i]):
            i += 1; continue
        j = i
        while j + 1 < n and q[j + 1] == q[i]:
            j += 1
        runs.append([int(q[i]), i, j + 1]); i = j + 1
    # absorb glides (short runs) into the previous contiguous note, else the next — one pass
    minf = max(1, int(P['glide_ms'] / 1000 / FR))
    out, pending = [], None
    for r in runs:
        r = list(r)
        if pending is not None:
            if pending[2] == r[1]:
                r[1] = pending[1]
            else:
                out.append(pending)
            pending = None
        if r[2] - r[1] < minf:
            if out and out[-1][2] == r[1]:
                out[-1][2] = r[2]
                continue
            pending = r
            continue
        out.append(r)
    if pending is not None:
        out.append(pending)
    runs = out

    def merge(rs):
        out = []
        for r in rs:
            if out and out[-1][0] == r[0] and (r[1] - out[-1][2]) * FR < P['gap_ms'] / 1000:
                out[-1][2] = r[2]
            else:
                out.append(list(r))
        return out
    runs = merge(runs)
    runs = [r for r in runs if (r[2] - r[1]) * FR >= P['min_ms'] / 1000]
    runs = merge(runs)
    ps = np.array([r[0] for r in runs], float)
    W = int(P['slip_win'])
    for k in range(len(runs)):
        nb = np.concatenate([ps[max(0, k - W):k], ps[k + 1:k + 1 + W]])
        if len(nb) < 2:
            continue
        med = np.median(nb)
        for sh in (12, -12):
            if abs(ps[k] - med) > P['slip_dist'] and abs(ps[k] + sh - med) < abs(ps[k] - med) - P['slip_margin']:
                runs[k][0] += sh; ps[k] += sh; break
    runs = merge(runs)
    notes = []
    for r in runs:
        a, b = r[1], r[2]
        seg_cm = cm[a:b]
        seg_cm = np.round(seg_cm[~np.isnan(seg_cm)]).astype(int)
        mm = r[0]
        if P['cm_use'] and len(seg_cm):
            same_pc = seg_cm[(seg_cm - mm) % 12 == 0]
            if len(same_pc) >= P['cm_vote'] * len(seg_cm):
                vals, counts = np.unique(same_pc, return_counts=True)
                mm = int(vals[np.argmax(counts)])
        seg_m = m[a:b] - off[a:b]
        info = dict(dur=(b - a) * FR, vp=float(np.nanmean(vp[a:b])), rms=float(np.nanmean(rms[a:b]) / (np.nanmax(rms) + 1e-9)),
                    stab=float(np.nanstd(seg_m)) if np.isfinite(seg_m).any() else 1.0,
                    dev=float(np.nanmean(np.abs(seg_m - np.round(seg_m)))) if np.isfinite(seg_m).any() else 0.5,
                    cm_frac=float(np.mean(seg_cm == mm)) if len(seg_cm) else 0.0,
                    cm_cov=float(len(seg_cm) / max(1, b - a)), moved=int(mm != r[0]))
        notes.append([mm, round(a * FR, 3), round((b - a) * FR, 3), info])
    # collapse repeats (the metric ignores re-articulation)
    out = []
    for nt in notes:
        if out and out[-1][0] == nt[0] and nt[1] - (out[-1][1] + out[-1][2]) < 0.25:
            out[-1][2] = round(nt[1] + nt[2] - out[-1][1], 3)
            out[-1][3]['dur'] = out[-1][2]
        else:
            out.append(nt)
    return out


def transcribe(F, P):
    return {p: segment(F, p, P) for p in PARTS}


_CACHE = {}


def cached(t, F, P):
    key = (t, tuple(sorted(P.items())))
    if key not in _CACHE:
        if len(_CACHE) > 4000:
            _CACHE.clear()
        _CACHE[key] = transcribe(F, P)
    return _CACHE[key]


def evaluate(ids, feats, gt, shifts, P, clf=None, thr=None):
    vals = []
    for t in ids:
        parts = cached(t, feats[t], P)
        if clf is not None:
            parts = apply_filter(parts, clf, thr)
        vals.append(score(parts, gt[t], shifts=[shifts[t]])[0])
    return float(np.mean(vals)), vals


# ---------------------------------------------------------------- note filter
def note_features(parts):
    rows = []
    for pi, p in enumerate(PARTS):
        ns = parts[p]
        for k, n in enumerate(ns):
            i = n[3]
            prev = ns[k - 1][0] if k else n[0]
            nxt = ns[k + 1][0] if k + 1 < len(ns) else n[0]
            med = float(np.median([x[0] for x in ns[max(0, k - 5):k + 6]]))
            # what the other parts sound at this note's midpoint (chord context)
            t = n[1] + n[2] / 2
            others = [x[0] for q in PARTS if q != p for x in parts[q] if x[1] <= t < x[1] + x[2]]
            pcs = {(o - n[0]) % 12 for o in others}
            consonant = len(pcs & {0, 3, 4, 7, 10, 9, 8}) / max(1, len(pcs))
            rows.append([pi, i['dur'], np.log(i['dur'] + 1e-3), i['vp'], i['rms'], i['stab'], i['dev'], i['cm_frac'], i['cm_cov'],
                         i['moved'], n[0] - prev, nxt - n[0], n[0] - med, abs(n[0] - med), len(others), consonant,
                         k / max(1, len(ns) - 1)])
    return np.array(rows, float)


def labels(parts, gt, shift):
    """Per note: 0 keep, 1 drop, 2 up an octave, 3 down an octave."""
    y = []
    for p in PARTS:
        ours = [n[0] for n in parts[p]]
        ref = collapse([m + shift for m in pitches(gt[p])])
        _, pairs = align(ours, ref)
        ok = {i for i, _ in pairs}
        up = {i for i, _ in align([m + 12 for m in ours], ref)[1]}
        dn = {i for i, _ in align([m - 12 for m in ours], ref)[1]}
        for i in range(len(ours)):
            y.append(0 if i in ok else 2 if i in up else 3 if i in dn else 1)
    return np.array(y)


def apply_filter(parts, clf, thr):
    X = note_features(parts)
    if not len(X):
        return parts
    pr = clf.predict_proba(X)
    cls = clf.classes_
    out, k = {}, 0
    for p in PARTS:
        keep = []
        for n in parts[p]:
            j = int(np.argmax(pr[k])); c = cls[j]; conf = pr[k][j]
            m = n[0]
            if c == 1 and conf >= thr['drop']:
                k += 1; continue
            if c == 2 and conf >= thr['oct']:
                m += 12
            elif c == 3 and conf >= thr['oct']:
                m -= 12
            keep.append([m] + n[1:]); k += 1
        out[p] = keep
    return out


def train_clf(ids, feats, gt, shifts, P):
    from sklearn.ensemble import HistGradientBoostingClassifier
    X, Y = [], []
    for t in ids:
        parts = cached(t, feats[t], P)
        X.append(note_features(parts)); Y.append(labels(parts, gt[t], shifts[t]))
    X, Y = np.vstack(X), np.concatenate(Y)
    clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.06, max_leaf_nodes=15, l2_regularization=1.0,
                                         class_weight='balanced', random_state=0)
    clf.fit(X, Y)
    return clf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    ap.add_argument('--trials', type=int, default=300)
    ap.add_argument('--out', default=os.path.join(HERE, 'audio_model.json'))
    a = ap.parse_args()
    gt = json.load(open(f'{a.work}/gt.json'))
    feats = {}
    for t in gt:
        f = f'{a.work}/feat/{t}.npz'
        if os.path.exists(f):
            z = np.load(f)
            feats[t] = {k: z[k] for k in z.files}
    ids = sorted(feats)
    # each tag's key shift between score and recording, from the default segmentation
    shifts = {}
    for t in ids:
        shifts[t] = score(transcribe(feats[t], DEFAULT), gt[t])[1]
    base, base_vals = evaluate(ids, feats, gt, shifts, DEFAULT)
    # recordings that don't follow the score (another arrangement / version) can't teach anything
    usable = [t for t, v in zip(ids, base_vals) if v >= 0.35]
    print(f'{len(ids)} tags with features; {len(usable)} usable (recording follows the score); '
          f'default segmentation F1 {np.mean([v for v in base_vals if v >= 0.35]):.3f} on usable')
    rng = np.random.default_rng(1)
    trials = [DEFAULT] + [{k: (v[rng.integers(len(v))]) for k, v in SPACE.items()} for _ in range(a.trials)]
    # score every trial on every tag once; CV picks from these
    table = np.zeros((len(trials), len(usable)))
    for i, P in enumerate(trials):
        table[i] = evaluate(usable, feats, gt, shifts, P)[1]
        if i % 25 == 0:
            print(f'  trial {i}/{len(trials)}  best so far {table[:i + 1].mean(1).max():.3f}', flush=True)
    fl = folds(usable)
    pos = {t: j for j, t in enumerate(usable)}
    cv_seg, cv_clf, base_cv = [], [], []
    for k, test in enumerate(fl):
        train = [t for t in usable if t not in test]
        tr, te = [pos[t] for t in train], [pos[t] for t in test]
        best = int(np.argmax(table[:, tr].mean(1)))
        cv_seg.append(table[best, te].mean()); base_cv.append(table[0, te].mean())
        P = trials[best]
        clf = train_clf(train, feats, gt, shifts, P)
        # confidence thresholds chosen on the training folds
        best_thr, best_v = None, -1
        for d in (0.5, 0.6, 0.7, 0.8, 0.9, 1.01):
            for o in (0.5, 0.6, 0.7, 0.8, 0.9, 1.01):
                thr = {'drop': d, 'oct': o}
                v = evaluate(train, feats, gt, shifts, P, clf, thr)[0]
                if v > best_v:
                    best_v, best_thr = v, thr
        cv_clf.append(evaluate(test, feats, gt, shifts, P, clf, best_thr)[0])
        print(f'fold {k}: default {base_cv[-1]:.3f} → tuned {cv_seg[-1]:.3f} → +filter {cv_clf[-1]:.3f}  thr {best_thr}', flush=True)
    print(f'CV (held-out) F1: default {np.mean(base_cv):.3f}, tuned segmentation {np.mean(cv_seg):.3f}, '
          f'with learned filter {np.mean(cv_clf):.3f}')
    # final model on all usable tags
    best = int(np.argmax(table.mean(1)))
    P = trials[best]
    clf = train_clf(usable, feats, gt, shifts, P)
    best_thr, best_v = None, -1
    for d in (0.5, 0.6, 0.7, 0.8, 0.9, 1.01):
        for o in (0.5, 0.6, 0.7, 0.8, 0.9, 1.01):
            v = evaluate(usable, feats, gt, shifts, P, clf, {'drop': d, 'oct': o})[0]
            if v > best_v:
                best_v, best_thr = v, {'drop': d, 'oct': o}
    use_filter = np.mean(cv_clf) > np.mean(cv_seg) + 0.005
    json.dump({'params': {k: (float(v) if isinstance(v, (float, np.floating)) else int(v)) for k, v in P.items()},
               'filter': bool(use_filter), 'thr': best_thr,
               'cv': {'default': float(np.mean(base_cv)), 'tuned': float(np.mean(cv_seg)), 'filter': float(np.mean(cv_clf))},
               'n_tags': len(usable)}, open(a.out, 'w'), indent=1)
    pickle.dump(clf, open(os.path.join(HERE, 'audio_clf.pkl'), 'wb'))
    print('final params', P, 'filter' if use_filter else 'no filter', best_thr)


if __name__ == '__main__':
    main()
