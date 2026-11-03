#!/usr/bin/env python3
"""Fetch popular tags from barbershoptags.com and transcribe every part.

Pipeline (re-runnable; caches everything in --work):
  1. Page through the public API (api.php, sorted by downloads) and keep
     4-part tags that have Tenor/Lead/Bari/Bass mp3 learning tracks.
  2. Prefer tags whose tracks are "single part only" — in those the part
     is alone on one stereo channel. (The "stereo" tracks put a mix of all
     voices on both channels, which cannot be transcribed reliably.)
  3. For each part track, find the isolated channel: the one whose
     waveform is uncorrelated with every channel of the other three tracks.
  4. Run pYIN on that channel, quantise to semitones (with a per-track
     tuning offset), segment into notes, fix octave slips.

Then run tools/build_tags.py to assemble data/tags.json.

Requirements: python3 -m pip install librosa numpy scipy  (and curl, ffmpeg)
Be polite: downloads are sequential with a pause between files.
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


def isolated_channels(Y, max_corr):
    """For each part pick the channel least correlated with all other tracks."""
    iso = {}
    for p in PARTS:
        best = None
        for c in (0, 1):
            x = Y[p][c][::2]
            if np.sqrt(np.mean(x ** 2)) < 1e-3:
                continue
            m = max(corr(x, Y[q][d][::2]) for q in PARTS if q != p for d in (0, 1))
            if best is None or m < best[0]:
                best = (m, c)
        if best is None or best[0] > max_corr:
            return None, f'{p} not isolated ({best and round(best[0], 2)})'
        iso[p] = best
    return iso, None


# ---------------------------------------------------------------- transcription
def nanmedfilt(x, w=7):
    out = x.copy(); h = w // 2
    for i in range(len(x)):
        if not np.isnan(x[i]):
            out[i] = np.nanmedian(x[max(0, i - h):i + h + 1])
    return out


def transcribe(y, part):
    lo, hi = F0_RANGE[part]
    f0, vf, _ = librosa.pyin(y, fmin=lo, fmax=hi, sr=SR, hop_length=HOP, frame_length=2048)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0][:len(f0)]
    fr = HOP / SR
    midi = librosa.hz_to_midi(np.where(vf, f0, np.nan))
    ok = vf & (rms > 0.05 * np.nanmax(rms))
    m = nanmedfilt(np.where(ok, midi, np.nan), 7)
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


def process(t, work, max_corr):
    files = [download(t[p], f'{work}/audio/{t["id"]}_{p}.mp3') for p in PARTS]
    if None in files:
        return {'ok': False, 'why': 'download'}
    Y = {}
    for p, f in zip(PARTS, files):
        y, _ = librosa.load(f, sr=SR, mono=False)
        Y[p] = y if y.ndim == 2 else np.vstack([y, y])
    iso, why = isolated_channels(Y, max_corr)
    if why:
        return {'ok': False, 'why': why}
    res = {'ok': True}
    for p in PARTS:
        notes, off, acc = transcribe(Y[p][iso[p][1]].astype('float32'), p)
        res[p] = {'ch': iso[p][1], 'xc': round(iso[p][0], 3), 'tuning': round(off, 3), 'acc': round(acc, 3), 'notes': notes}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    ap.add_argument('--pages', type=int, default=20, help='API pages of 100 tags to scan')
    ap.add_argument('--target', type=int, default=170, help='stop after this many transcribed tags')
    ap.add_argument('--max-corr', type=float, default=0.2)
    a = ap.parse_args()
    os.makedirs(f'{a.work}/audio', exist_ok=True); os.makedirs(f'{a.work}/trans', exist_ok=True)
    meta = fetch_meta(a.work, a.pages)
    json.dump(meta, open(f'{a.work}/meta.json', 'w'))
    todo = [t for t in meta if 'single' in t['Recording']]
    print(len(meta), 'four-part tags,', len(todo), 'with single-part tracks')
    good = 0
    for t in todo:
        if good >= a.target:
            break
        out = f'{a.work}/trans/{t["id"]}.json'
        if not os.path.exists(out):
            try:
                res = process(t, a.work, a.max_corr)
            except Exception as e:  # corrupt download etc.
                res = {'ok': False, 'why': str(e)[:200]}
            json.dump(res, open(out, 'w'))
            print(t['rank'], t['Title'], 'OK' if res['ok'] else res['why'], flush=True)
        good += bool(json.load(open(out)).get('ok'))


if __name__ == '__main__':
    main()
