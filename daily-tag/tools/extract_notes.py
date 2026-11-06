#!/usr/bin/env python3
"""Fetch popular tags from barbershoptags.com and transcribe every part.

Pipeline (re-runnable; caches everything in --work):
  1. Page through the public API (api.php, sorted by downloads) and keep
     4-part tags that have Tenor/Lead/Bari/Bass mp3 learning tracks.
  2. Demix. Every learning-track file of a tag shares the same full mix M
     (L+R is identical across the four files); the files differ only in how
     the voices are panned. So one side of file P is  a·voice_P + b·M, and
       voice_P ≈ side_P − c_P · M
     with one unknown c_P per part, fitted so the four recovered voices are
     mutually uncorrelated (c = 0 for "single part" tracks, where one side
     is already the bare voice). The residual correlation is the quality
     measure.
  3. Run pYIN on each recovered voice, quantise to semitones (with a
     per-track tuning offset), segment into notes, fix octave slips.
  4. Cross-check every part with an independent transcriber that needs no
     demixing: harmonic-sum CQT salience of each file, contrasted against
     the other three files (the note that is *boosted* in file P is part
     P's note). Agreement between the two methods is stored per part.

Then run tools/build_tags.py to assemble data/tags.json.

Requirements: python3 -m pip install librosa numpy scipy  (and curl, ffmpeg)
Be polite: downloads are sequential with a pause between files; the CPU
work runs in parallel worker processes.

Usage:
  extract_notes.py --work work --pages 20 download   # fetch metadata + mp3s
  extract_notes.py --work work process --workers 3   # demix + transcribe
"""
import argparse, glob, json, os, re, subprocess, time, warnings
import xml.etree.ElementTree as ET

import numpy as np
import librosa

warnings.filterwarnings('ignore')
API = 'https://www.barbershoptags.com/api.php'
PARTS = ['Tenor', 'Lead', 'Bari', 'Bass']
SR, HOP = 22050, 256
F0_RANGE = {'Bass': (55, 400), 'Bari': (80, 520), 'Lead': (90, 620), 'Tenor': (120, 1050)}


# ---------------------------------------------------------------- metadata
def fetch_meta(work, pages):
    os.makedirs(f'{work}/api', exist_ok=True)
    for i in range(pages):
        start = 1 + i * 100
        f = f'{work}/api/top{start}.xml'
        if not os.path.exists(f):
            subprocess.run(['curl', '-sS', '-m', '60', '--retry', '4', '--retry-delay', '6',
                            f'{API}?n=100&Sortby=Downloaded&start={start}', '-o', f], check=True)
            time.sleep(3)
    tags, seen = [], set()
    for f in glob.glob(f'{work}/api/top*.xml'):
        s = open(f, 'rb').read().decode('utf-8', 'replace')
        s = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', s)  # the feed has stray control chars
        for t in ET.fromstring(s.encode()).findall('tag'):
            d = {c.tag: (c.text or '').strip() for c in t}
            d['_types'] = {c.tag: c.get('type') for c in t if c.get('type')}
            if d['id'] not in seen:
                seen.add(d['id']); tags.append(d)
    tags.sort(key=lambda t: -int(t['Downloaded'] or 0))
    for i, t in enumerate(tags):
        t['rank'] = i + 1
    ok = [t for t in tags if t['Parts'] == '4' and 'Female' not in t['Type']
          and all(t['_types'].get(p) == 'mp3' for p in PARTS)]
    return ok


# ---------------------------------------------------------------- audio
def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 10000:
        return path
    for i in range(5):
        r = subprocess.run(['curl', '-sS', '-m', '90', '-L', url, '-o', path])
        if r.returncode == 0 and os.path.exists(path) and os.path.getsize(path) > 10000:
            time.sleep(1.0)
            return path
        time.sleep(4 * (i + 1))
    return None


def corr(a, b):
    n = min(len(a), len(b)); a = a[:n]; b = b[:n]
    return float(abs(np.dot(a, b)) / np.sqrt(np.dot(a, a) * np.dot(b, b) + 1e-12))


def demix(Y, grid=np.linspace(-0.3, 1.3, 161), iters=4):
    """Recover each voice as side_P - c_P * M (see module docstring).

    Every correlation between candidate voices v_i = S_i - c_i M follows
    from the 5x5 Gram matrix of (S_1..S_4, M), so the fit costs one pass
    over the audio. Returns (residual_corr, side, [c_P], [voice signals])."""
    M = np.mean([Y[p].sum(0) for p in PARTS], 0)
    best = None
    for side in (0, 1):
        X = np.vstack([Y[p][side] for p in PARTS] + [M]).astype(np.float64)
        G = X @ X.T

        def dot(i, j, ci, cj):      # <S_i - ci M, S_j - cj M>
            return G[i, j] - cj * G[i, 4] - ci * G[4, j] + ci * cj * G[4, 4]

        def c2(i, j, ci, cj):
            num = dot(i, j, ci, cj)
            return num * num / (dot(i, i, ci, ci) * dot(j, j, cj, cj) + 1e-18)
        cs = np.zeros(4)
        for _ in range(iters):
            for i in range(4):
                scores = [sum(c2(i, j, c, cs[j]) for j in range(4) if j != i) for c in grid]
                cs[i] = grid[int(np.argmin(scores))]
        m = float(np.mean([np.sqrt(c2(i, j, cs[i], cs[j])) for i in range(4) for j in range(i + 1, 4)]))
        if best is None or m < best[0]:
            best = (m, side, cs.copy())
    m, side, cs = best
    return m, side, cs, [Y[PARTS[i]][side] - cs[i] * M for i in range(4)]


# ---------------------------------------------------------------- cross-check transcriber
BPS, CQT_MIN = 3, 24        # 3 bins per semitone from C1
CQT_FUND = (88 - CQT_MIN) * BPS
VOICE_MIDI = {'Bass': (33, 67), 'Bari': (43, 74), 'Lead': (45, 76), 'Tenor': (53, 86)}


def salience_db(y):
    C = np.abs(librosa.cqt(y, sr=SR, hop_length=HOP, fmin=librosa.midi_to_hz(CQT_MIN),
                           n_bins=CQT_FUND + 28 * BPS, bins_per_octave=12 * BPS))
    hs = np.zeros((CQT_FUND, C.shape[1]))
    for h, w in zip(range(1, 6), [1, .8, .6, .45, .3]):
        o = int(round(12 * BPS * np.log2(h)))
        hs += w * C[o:o + CQT_FUND]
    return 20 * np.log10(hs + 1e-6)


def contrast_midi(sides):
    """Frame-wise pitch per part from 'which pitch is boosted in this file'."""
    L = {p: salience_db(sides[p]) for p in PARTS}
    T = min(v.shape[1] for v in L.values())
    L = {p: v[:, :T] for p, v in L.items()}
    out = {}
    for p in PARTS:
        con = L[p] - np.mean([L[q] for q in PARTS if q != p], 0)
        lo, hi = VOICE_MIDI[p]
        b0, b1 = (lo - CQT_MIN) * BPS, (hi - CQT_MIN) * BPS
        fmax = L[p].max(0)
        score = con[b0:b1] + (L[p][b0:b1] - fmax)
        idx = score.argmax(0)
        val = L[p][b0:b1][idx, np.arange(T)]
        ok = (val > fmax - 25) & (con[b0:b1][idx, np.arange(T)] > 2) & (fmax > fmax.max() - 45)
        out[p] = np.where(ok, CQT_MIN + (b0 + idx) / BPS, np.nan)
    return out


def fix_octaves(notes, cmidi):
    """Move each pYIN note to the octave the contrast transcriber hears it in.

    pYIN is precise about pitch class and timing but can lock onto the 2nd
    harmonic (low voices) or drop an octave; the cross-file contrast is
    good at octaves. A note moves when most contrast frames inside it are
    the same pitch class in another octave."""
    fr = HOP / SR
    out = []
    for m, s0, d in notes:
        seg = cmidi[int(s0 / fr):int((s0 + d) / fr) + 1]
        seg = np.round(seg[~np.isnan(seg)]).astype(int)
        same_pc = seg[(seg - m) % 12 == 0]
        if len(seg) and len(same_pc) >= 0.5 * len(seg):
            vals, counts = np.unique(same_pc, return_counts=True)
            m = int(vals[np.argmax(counts)])
        out.append([m, s0, d])
    return out


def agreement(notes_a, notes_b, step=0.05):
    """Share of A's sounding time where B has the same pitch."""
    if not notes_a:
        return 0.0
    T = max(n[1] + n[2] for n in notes_a + notes_b) + 1
    def grid(ns):
        g = np.full(int(T / step) + 1, np.nan)
        for m, s0, d in ns:
            g[int(s0 / step):int((s0 + d) / step)] = m
        return g
    a, b = grid(notes_a), grid(notes_b)
    v = ~np.isnan(a)
    return float(np.mean(a[v] == b[v])) if v.any() else 0.0


# ---------------------------------------------------------------- transcription
def nanmedfilt(x, w=7):
    out = x.copy(); h = w // 2
    for i in range(len(x)):
        if not np.isnan(x[i]):
            out[i] = np.nanmedian(x[max(0, i - h):i + h + 1])
    return out


def transcribe(y, part):
    """Monophonic transcription of an isolated voice (pYIN)."""
    lo, hi = F0_RANGE[part]
    f0, vf, _ = librosa.pyin(y, fmin=lo, fmax=hi, sr=SR, hop_length=HOP, frame_length=2048)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0][:len(f0)]
    midi = librosa.hz_to_midi(np.where(vf, f0, np.nan))
    ok = vf & (rms > 0.05 * np.nanmax(rms))
    return notes_from_midi(np.where(ok, midi, np.nan))


def notes_from_midi(m_raw):
    """Frame-wise MIDI (nan = unvoiced) → [[midi, start, dur]], tuning offset, stability."""
    fr = HOP / SR
    m = nanmedfilt(m_raw, 7)
    v = m[~np.isnan(m)]
    off = float(np.median((v + 0.5) % 1 - 0.5)) if len(v) else 0.0   # singer's tuning offset
    q = np.round(m - off)
    runs, i, n = [], 0, len(q)
    while i < n:
        if np.isnan(q[i]):
            i += 1; continue
        j = i
        while j + 1 < n and q[j + 1] == q[i]:
            j += 1
        runs.append([int(q[i]), i, j + 1]); i = j + 1
    # absorb glides (<60 ms) into the neighbouring note
    minf = int(0.06 / fr)
    changed = True
    while changed:
        changed = False
        for k, r in enumerate(runs):
            if r[2] - r[1] < minf:
                prev = runs[k - 1] if k > 0 and runs[k - 1][2] == r[1] else None
                nxt = runs[k + 1] if k + 1 < len(runs) and runs[k + 1][1] == r[2] else None
                if prev:
                    prev[2] = r[2]; runs.pop(k); changed = True; break
                if nxt:
                    nxt[1] = r[1]; runs.pop(k); changed = True; break

    def merge(rs, gap):
        out = []
        for r in rs:
            if out and out[-1][0] == r[0] and (r[1] - out[-1][2]) * fr < gap:
                out[-1][2] = r[2]
            else:
                out.append(list(r))
        return out
    runs = merge(runs, 0.045)
    runs = [r for r in runs if (r[2] - r[1]) * fr >= 0.1]
    runs = merge(runs, 0.045)
    # octave slips: a note an octave away from its neighbourhood
    ps = np.array([r[0] for r in runs], float)
    for k in range(len(runs)):
        nb = np.concatenate([ps[max(0, k - 4):k], ps[k + 1:k + 5]])
        if len(nb) < 2:
            continue
        med = np.median(nb)
        for sh in (12, -12):
            if abs(ps[k] - med) > 8 and abs(ps[k] + sh - med) < abs(ps[k] - med) - 6:
                runs[k][0] += sh; ps[k] += sh; break
    runs = merge(runs, 0.045)
    acc = float(np.mean(np.abs(v - off - np.round(v - off)) < 0.35)) if len(v) else 0
    notes = [[r[0], round(r[1] * fr, 2), round((r[2] - r[1]) * fr, 2)] for r in runs]
    return notes, off, acc


def process(t, work):
    files = [f'{work}/audio/{t["id"]}_{p}.mp3' for p in PARTS]
    Y = {}
    for p, f in zip(PARTS, files):
        y, _ = librosa.load(f, sr=SR, mono=False)
        Y[p] = y if y.ndim == 2 else np.vstack([y, y])
    n = min(y.shape[1] for y in Y.values())
    Y = {p: y[:, :n] for p, y in Y.items()}
    resid, side, cs, voices = demix(Y)
    res = {'ok': True, 'resid': round(resid, 4), 'side': side, 'c': [round(float(c), 3) for c in cs]}
    cm = contrast_midi({p: Y[p][side] for p in PARTS})
    for i, p in enumerate(PARTS):
        v = voices[i]
        notes, off, acc = transcribe((v / (np.abs(v).max() + 1e-9)).astype('float32'), p)
        alt, _, _ = notes_from_midi(cm[p])
        fixed = fix_octaves(notes, cm[p])
        before, after = agreement(notes, alt), agreement(fixed, alt)
        if after <= before:        # only trust the octave vote when it helps
            fixed, after = notes, before
        res[p] = {'tuning': round(off, 3), 'acc': round(acc, 3), 'agree': round(after, 3),
                  'octfix': sum(a[0] != b[0] for a, b in zip(notes, fixed)), 'notes': fixed}
    return res


def cmd_download(meta, work):
    for t in meta:
        for p in PARTS:
            download(t[p], f'{work}/audio/{t["id"]}_{p}.mp3')
        print('downloaded', t['rank'], t['Title'], flush=True)


def _job(args):
    t, work = args
    out = f'{work}/trans/{t["id"]}.json'
    try:
        res = process(t, work)
    except Exception as e:  # corrupt download etc.
        res = {'ok': False, 'why': str(e)[:200]}
    json.dump(res, open(out, 'w'))
    return t['rank'], t['Title'], res.get('resid'), {p: res[p]['agree'] for p in PARTS} if res.get('ok') else res.get('why')


def cmd_process(meta, work, workers, wait):
    from multiprocessing import Pool
    pending = list(meta)
    with Pool(workers) as pool:
        while pending:
            ready = [t for t in pending if all(os.path.exists(f'{work}/audio/{t["id"]}_{p}.mp3') for p in PARTS)
                     and not os.path.exists(f'{work}/trans/{t["id"]}.json')]
            done = [t for t in pending if os.path.exists(f'{work}/trans/{t["id"]}.json')]
            for t in done:
                pending.remove(t)
            if not ready:
                if not wait:
                    break
                time.sleep(20); continue
            for r in pool.imap_unordered(_job, [(t, work) for t in ready[:workers * 4]]):
                print(*r, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    ap.add_argument('--pages', type=int, default=20, help='API pages of 100 tags to scan')
    ap.add_argument('--limit', type=int, default=1300, help='candidate tags (most downloaded first)')
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('download')
    pr = sub.add_parser('process')
    pr.add_argument('--workers', type=int, default=3)
    pr.add_argument('--wait', action='store_true', help='keep polling for new downloads')
    a = ap.parse_args()
    os.makedirs(f'{a.work}/audio', exist_ok=True); os.makedirs(f'{a.work}/trans', exist_ok=True)
    meta = fetch_meta(a.work, a.pages)[:a.limit]
    json.dump(meta, open(f'{a.work}/meta.json', 'w'))
    if a.cmd == 'download':
        cmd_download(meta, a.work)
    else:
        cmd_process(meta, a.work, a.workers, a.wait)


if __name__ == '__main__':
    main()
