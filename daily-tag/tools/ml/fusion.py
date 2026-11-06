#!/usr/bin/env python3
"""Fuse the sheet-music reading (homr OMR → score_parts) with the audio
transcription, trained and evaluated on arrangers' scores.

  fusion.py --work work            # cross-validated report + ml/fusion_clf.pkl
  (fuse(...) is imported by build_tags.py)

Steps, each kept only if it helps on held-out tags:
 1. Octave per staff pair (Tenor/Lead, Bari/Bass): the shift in {-12,0,+12}
    under which the sheet's notes best agree with the recording.
 2. Swapped voices within a staff (Tenor↔Lead, Bari↔Bass): swap when the
    recording agrees clearly better that way.
 3. Note-level arbitration: where an aligned audio note disagrees with the
    sheet's note, a gradient-boosted classifier decides which pitch to keep.
    Features: audio note duration/voicing/stability/contrast agreement, the
    pitch difference, whether each pitch is in the key, and how well each
    candidate forms a barbershop chord with the other three voices at that
    moment (major/minor triads, dominant/half-diminished/diminished sevenths,
    sixths and ninths are the barbershop vocabulary).
Grouped 5-fold CV over tags; thresholds chosen on training folds only.
"""
import argparse, json, os, pickle, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from evalkit import score, folds, PARTS, f1  # noqa: E402
from build_tags import align, collapse  # noqa: E402
import audio_tune as AT  # noqa: E402

# barbershop chord vocabulary as pitch-class sets relative to a root
CHORDS = [{0, 4, 7}, {0, 3, 7}, {0, 4, 7, 10}, {0, 3, 6, 10}, {0, 3, 6, 9}, {0, 4, 7, 9}, {0, 3, 7, 10},
          {0, 4, 7, 11}, {0, 4, 7, 10, 2}, {0, 4, 8}, {0, 3, 6}, {0, 4, 10}, {0, 7}, {0}, {0, 4}, {0, 3}]


def chord_fit(pcs):
    """1.0 if the pitch classes form (a subset of) a barbershop chord on some root."""
    pcs = {p % 12 for p in pcs}
    for root in range(12):
        rel = {(p - root) % 12 for p in pcs}
        for c in CHORDS:
            if rel <= c and len(rel) >= min(len(c), len(pcs)):
                return 1.0
    for root in range(12):
        rel = {(p - root) % 12 for p in pcs}
        if any(len(rel - c) <= 1 for c in CHORDS[:9]):
            return 0.5
    return 0.0


def sounding_at(parts, t, skip=None):
    return [n[0] for q in PARTS if q != skip for n in parts[q] if n[0] is not None and n[1] <= t < n[1] + n[2]]


def sheet_reading(work, tid):
    import score_parts
    f = f'{work}/sheets/{tid}.musicxml'
    if not os.path.exists(f):
        return None
    try:
        parts, key = score_parts.to_parts(f)
    except Exception:  # noqa: BLE001
        return None
    if not parts or any(sum(1 for n in parts[p] if n[0] is not None) < 2 for p in PARTS):
        return None
    return {p: [[n[0], n[1], n[2]] for n in parts[p]] for p in PARTS}, key


def agree(sheet_notes, audio_notes, shift):
    a = collapse([n[0] for n in audio_notes])
    s = collapse([n[0] + shift for n in sheet_notes if n[0] is not None])
    return f1(a, s)


def key_shift(sheet, audio):
    """Transposition sheet → recording, by best agreement."""
    best = (-1, 0)
    for sh in range(-11, 12):
        v = np.mean([agree(sheet[p], audio[p], sh) for p in PARTS])
        if v > best[0]:
            best = (v, sh)
    return best[1], best[0]


def fix_pairs(sheet, audio, sh, oct_margin=0.3, swap_margin=0.3):
    """Octave / voice repairs, only when the recording's evidence beats the
    sheet's by a margin (None = never)."""
    out = {p: [list(n) for n in sheet[p]] for p in PARTS}
    for pair in (('Tenor', 'Lead'), ('Bari', 'Bass')):
        def total(k):
            return sum(agree([[n[0] + k if n[0] is not None else None] + n[1:] for n in out[p]], audio[p], sh) for p in pair)
        k = max((-12, 0, 12), key=lambda k: (total(k), k == 0))
        if oct_margin is None or total(k) < total(0) + oct_margin:
            k = 0
        if k:
            for p in pair:
                for n in out[p]:
                    if n[0] is not None:
                        n[0] += k
        a, b = pair
        straight = agree(out[a], audio[a], sh) + agree(out[b], audio[b], sh)
        swapped = agree(out[b], audio[a], sh) + agree(out[a], audio[b], sh)
        if swap_margin is not None and swapped > straight + swap_margin:
            out[a], out[b] = out[b], out[a]
    return out


def candidates(sheet, audio, sh, key_pc):
    """Sheet notes that an aligned audio note contradicts: (part, index, audio pitch, features)."""
    rows = []
    scale = {(key_pc + d) % 12 for d in (0, 2, 4, 5, 7, 9, 11)}
    for pi, p in enumerate(PARTS):
        sn = [(i, n) for i, n in enumerate(sheet[p]) if n[0] is not None]
        an = audio[p]
        if not sn or not an:
            continue
        s_p = [n[0] + sh for _, n in sn]
        a_p = [n[0] for n in an]
        # align with a substitution-friendly cost: we want mismatches paired
        n_, m_ = len(a_p), len(s_p)
        D = np.zeros((n_ + 1, m_ + 1)); D[:, 0] = np.arange(n_ + 1) * 0.8; D[0, :] = np.arange(m_ + 1) * 0.8
        cost = lambda x, y: 0 if x == y else (0.5 if abs(x - y) <= 2 else 0.9 if abs(x - y) % 12 == 0 else 1.0)
        for i in range(1, n_ + 1):
            for j in range(1, m_ + 1):
                D[i, j] = min(D[i - 1, j - 1] + cost(a_p[i - 1], s_p[j - 1]), D[i - 1, j] + 0.8, D[i, j - 1] + 0.8)
        i, j = n_, m_
        while i > 0 and j > 0:
            c = cost(a_p[i - 1], s_p[j - 1])
            if abs(D[i, j] - (D[i - 1, j - 1] + c)) < 1e-9:
                if a_p[i - 1] != s_p[j - 1] and c < 1.0:
                    idx, n = sn[j - 1]
                    inf = an[i - 1][3]
                    t = n[1] + n[2] / 2
                    others = [m + sh for m in sounding_at(sheet, t, skip=p)]
                    a_pitch = a_p[i - 1] - sh
                    rows.append((p, idx, a_pitch, [
                        pi, a_p[i - 1] - s_p[j - 1], abs(a_p[i - 1] - s_p[j - 1]), int(abs(a_p[i - 1] - s_p[j - 1]) % 12 == 0),
                        inf['dur'], inf['vp'], inf['stab'], inf['dev'], inf['cm_frac'], inf['cm_cov'],
                        int((s_p[j - 1]) % 12 in scale), int((a_p[i - 1]) % 12 in scale),
                        chord_fit(others + [s_p[j - 1]]), chord_fit(others + [a_p[i - 1]]), len(others), n[2]]))
                i -= 1; j -= 1
            elif abs(D[i, j] - (D[i - 1, j] + 0.8)) < 1e-9:
                i -= 1
            else:
                j -= 1
    return rows


def apply(sheet, rows, clf, thr):
    out = {p: [list(n) for n in sheet[p]] for p in PARTS}
    if not rows or clf is None:
        return out
    X = np.array([r[3] for r in rows], float)
    pr = clf.predict_proba(X)[:, 1]
    for (p, idx, a_pitch, _), q in zip(rows, pr):
        if q >= thr:
            out[p][idx][0] = int(a_pitch)
    return out


def load(work, P):
    gt = json.load(open(f'{work}/gt.json'))
    data = {}
    for t in gt:
        r = sheet_reading(work, t)
        fz = f'{work}/feat/{t}.npz'
        if not r or not os.path.exists(fz):
            continue
        z = np.load(fz)
        F = {k: z[k] for k in z.files}
        audio = AT.transcribe(F, P)
        sheet, key = r
        data[t] = dict(sheet=sheet, audio=audio, key=key, gt=gt[t])
    return data


def key_pc_of(fifths):
    return (fifths * 7) % 12 if fifths is not None and -7 <= fifths <= 7 else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    a = ap.parse_args()
    model = json.load(open(os.path.join(HERE, 'audio_model.json'))) if os.path.exists(os.path.join(HERE, 'audio_model.json')) else None
    P = model['params'] if model else AT.DEFAULT
    data = load(a.work, P)
    ids = sorted(data)
    s0, s1, rows_by = {}, {}, {}
    for t in ids:
        d = data[t]
        sh, ag = key_shift(d['sheet'], d['audio'])
        d['sh'], d['ag'] = sh, ag
        s0[t] = score(d['sheet'], d['gt'])[0]
        d['variants'] = {}
        for om in (None, 0.2, 0.4, 0.6, 0.9):
            for sm in (None, 0.2, 0.4, 0.6, 0.9):
                fx = fix_pairs(d['sheet'], d['audio'], sh, om, sm) if ag >= 0.3 else d['sheet']
                d['variants'][(om, sm)] = (fx, score(fx, d['gt'])[0])
        s1[t] = None
    # choose the repair margins by cross-validation
    keys = list(data[ids[0]]['variants'])
    rep_cv = []
    for test in folds(ids):
        train = [t for t in ids if t not in test]
        kbest = max(keys, key=lambda kk: (np.mean([data[t]['variants'][kk][1] for t in train]), kk == (None, None)))
        rep_cv.extend(data[t]['variants'][kbest][1] for t in test)
    kfinal = max(keys, key=lambda kk: (np.mean([data[t]['variants'][kk][1] for t in ids]), kk == (None, None)))
    for t in ids:
        data[t]['fixed'], s1[t] = data[t]['variants'][kfinal]
    print(f'{len(ids)} tags with sheet + audio. sheet alone F1 {np.mean(list(s0.values())):.3f}; '
          f'+ octave/voice repair (margins by CV) {np.mean(rep_cv):.3f} held-out; chosen margins {kfinal}')
    for t in ids:
        d = data[t]
        sh, ag = d['sh'], d['ag']
        rows = candidates(d['fixed'], d['audio'], sh, key_pc_of(d['key'])) if ag >= 0.3 else []
        # label: the audio pitch is what the arranger wrote (at that position)
        lab = []
        for p, idx, a_pitch, _ in rows:
            trial = {q: [list(n) for n in d['fixed'][q]] for q in PARTS}
            trial[p][idx][0] = int(a_pitch)
            gain = score(trial, d['gt'])[0] - score(d['fixed'], d['gt'])[0]
            lab.append(1 if gain > 1e-9 else 0)
        rows_by[t] = (rows, np.array(lab))
    from sklearn.ensemble import HistGradientBoostingClassifier
    cv = []
    for k, test in enumerate(folds(ids)):
        train = [t for t in ids if t not in test]
        X = np.array([r[3] for t in train for r in rows_by[t][0]], float)
        Y = np.concatenate([rows_by[t][1] for t in train if len(rows_by[t][1])])
        if len(set(Y)) < 2:
            cv.extend(s1[t] for t in test); continue
        clf = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.06, max_leaf_nodes=12, l2_regularization=1.0,
                                             class_weight='balanced', random_state=0).fit(X, Y)
        best_thr, best_v = 1.01, np.mean([s1[t] for t in train])
        for thr in (0.5, 0.6, 0.7, 0.8, 0.9):
            v = np.mean([score(apply(data[t]['fixed'], rows_by[t][0], clf, thr), data[t]['gt'])[0] for t in train])
            if v > best_v:
                best_v, best_thr = v, thr
        fold = [score(apply(data[t]['fixed'], rows_by[t][0], clf, best_thr), data[t]['gt'])[0] for t in test]
        cv.extend(fold)
        print(f'fold {k}: sheet {np.mean([s0[t] for t in test]):.3f} → repair {np.mean([s1[t] for t in test]):.3f} '
              f'→ arbitration {np.mean(fold):.3f} (thr {best_thr})', flush=True)
    print(f'CV (held-out) F1: sheet {np.mean(list(s0.values())):.3f}, + repair {np.mean(list(s1.values())):.3f}, '
          f'+ learned arbitration {np.mean(cv):.3f}')
    # final classifier on all tags
    X = np.array([r[3] for t in ids for r in rows_by[t][0]], float)
    Y = np.concatenate([rows_by[t][1] for t in ids if len(rows_by[t][1])])
    clf = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.06, max_leaf_nodes=12, l2_regularization=1.0,
                                         class_weight='balanced', random_state=0).fit(X, Y)
    best_thr, best_v = 1.01, np.mean(list(s1.values()))
    for thr in (0.5, 0.6, 0.7, 0.8, 0.9):
        v = np.mean([score(apply(data[t]['fixed'], rows_by[t][0], clf, thr), data[t]['gt'])[0] for t in ids])
        if v > best_v:
            best_v, best_thr = v, thr
    use = np.mean(cv) > np.mean(list(s1.values())) + 0.003
    pickle.dump({'clf': clf, 'thr': best_thr, 'use_arbitration': bool(use), 'margins': kfinal,
                 'cv': {'sheet': float(np.mean(list(s0.values()))), 'repair': float(np.mean(list(s1.values()))),
                        'arbitration': float(np.mean(cv))}}, open(os.path.join(HERE, 'fusion_clf.pkl'), 'wb'))
    print('saved; arbitration', 'on' if use else 'off', 'thr', best_thr)


if __name__ == '__main__':
    main()
