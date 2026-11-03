#!/usr/bin/env python3
"""Assemble data/tags.json from two independent transcriptions per tag.

Sources (see extract_notes.py and omr_batch.py):
  audio  <work>/trans/<id>.json      demixed learning tracks → pYIN, with an
                                     internal cross-check ('agree') per part
  sheet  <work>/sheets/<id>.musicxml homr OMR of the published sheet music

Per tag the best evidence wins:
  verified  audio and sheet agree (same notes, any transposition) → audio
            notes, whose timing matches the real recordings
  audio     no usable sheet, but the audio passes its internal checks
  sheet     audio unusable / missing → sheet notes (written pitches), timed
            against the recording's Lead line when there is one
Tags with no trustworthy source are dropped. Up to --limit tags, most
downloaded first.
"""
import argparse, json, os, re, subprocess, sys, time, urllib.parse

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import omr_parts  # noqa: E402

PARTS = ['Tenor', 'Lead', 'Bari', 'Bass']
RANGE = {'Tenor': (52, 84), 'Lead': (45, 76), 'Bari': (41, 74), 'Bass': (33, 65)}
SITE = 'https://www.barbershoptags.com/'


# ---------------------------------------------------------------- helpers
def clean_notes(notes, part):
    lo, hi = RANGE[part]
    out = [list(n) for n in notes if n[2] >= 0.12 and lo <= n[0] <= hi]
    merged = []
    for n in out:
        if merged and merged[-1][0] == n[0] and n[1] - (merged[-1][1] + merged[-1][2]) < 0.07:
            merged[-1][2] = round(n[1] + n[2] - merged[-1][1], 2)
        else:
            merged.append(n)
    while len(merged) > 3 and merged[-1][2] < 0.3 and merged[-2][2] >= 1.0:
        merged.pop()
    return merged


def collapse(seq):
    out = []
    for x in seq:
        if not out or out[-1] != x:
            out.append(x)
    return out


def align(a, b):
    """Edit-distance alignment of pitch sequences a (found) vs b (expected).
    Returns (recall of b, list of matched index pairs)."""
    n, m = len(a), len(b)
    if not m:
        return 0.0, []
    D = np.zeros((n + 1, m + 1)); D[:, 0] = np.arange(n + 1) * 0.6; D[0, :] = np.arange(m + 1)
    cost = lambda x, y: 0 if x == y else (0.7 if abs(x - y) == 1 else 1.2)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j - 1] + cost(a[i - 1], b[j - 1]), D[i - 1, j] + 0.6, D[i, j - 1] + 1)
    i, j, pairs = n, m, []
    while i > 0 and j > 0:
        if abs(D[i, j] - (D[i - 1, j - 1] + cost(a[i - 1], b[j - 1]))) < 1e-9:
            if a[i - 1] == b[j - 1]:
                pairs.append((i - 1, j - 1))
            i -= 1; j -= 1
        elif abs(D[i, j] - (D[i - 1, j] + 0.6)) < 1e-9:
            i -= 1
        else:
            j -= 1
    return len(pairs) / m, pairs[::-1]


def agreement(audio, sheet):
    """Best transposition and per-part recall of the sheet's notes in the audio."""
    best = None
    for sh in range(-7, 8):
        sc = {p: align(collapse([n[0] for n in audio[p]]), collapse([n[0] + sh for n in sheet[p]]))[0] for p in PARTS}
        mean = float(np.mean(list(sc.values())))
        if best is None or mean > best[0]:
            best = (mean, sh, sc)
    return best


def plausible(parts):
    if any(len(parts[p]) < 2 for p in PARTS):
        return False
    med = {p: float(np.median([n[0] for n in parts[p]])) for p in PARTS}
    return med['Bass'] <= min(med['Bari'], med['Lead']) and med['Tenor'] >= med['Lead'] - 2


def sheet_times(sheet, audio_lead, shift):
    """Map sheet beats to seconds. With a recording: anchor matched Lead
    notes (beat ↔ second) and interpolate; otherwise a steady 72 bpm."""
    sec_per_beat = 60 / 72
    anchors = []
    if audio_lead:
        s_lead = sheet['Lead']
        _, pairs = align([n[0] for n in audio_lead], [n[0] + shift for n in s_lead])
        for ia, js in pairs:
            b, s = s_lead[js][1], audio_lead[ia][1]
            if not anchors or (b > anchors[-1][0] and s > anchors[-1][1]):
                anchors.append((b, s))
    if len(anchors) >= 3:
        bs, ss = zip(*anchors)
        rate = (ss[-1] - ss[0]) / max(1e-6, bs[-1] - bs[0])
        def f(beat):
            if beat < bs[0]:
                return ss[0] - (bs[0] - beat) * rate
            if beat > bs[-1]:
                return ss[-1] + (beat - bs[-1]) * rate
            return float(np.interp(beat, bs, ss))
    else:
        f = lambda beat: 0.5 + beat * sec_per_beat
    out = {}
    for p in PARTS:
        out[p] = [[n[0] + shift, round(max(0.0, f(n[1])), 2), round(max(0.12, f(n[1] + n[2]) - f(n[1])), 2)] for n in sheet[p]]
    return out


def slug(title):
    return re.sub(r'[^A-Za-z0-9]+', '-', title).strip('-')


def resolve_track(url, cache):
    """dbaction.php download links redirect to a static, range-seekable mp3."""
    if not url:
        return None
    if url in cache:
        return cache[url]
    direct = None
    for attempt in range(3):
        r = subprocess.run(['curl', '-sS', '-I', '-m', '30', url], capture_output=True, text=True)
        m = re.search(r'^location:\s*(\S+)', r.stdout, re.I | re.M)
        if m:
            q = urllib.parse.parse_qs(urllib.parse.urlparse(m.group(1)).query)
            if 'f' in q:
                direct = SITE + urllib.parse.quote(q['f'][0])
            break
        time.sleep(2 * (attempt + 1))
    cache[url] = direct or url
    time.sleep(0.3)
    return cache[url]


# ---------------------------------------------------------------- main
def decide(t, work, a):
    """Return (parts, source, info) or (None, reason, info)."""
    audio, audio_ok, info = None, False, {}
    f = f'{work}/trans/{t["id"]}.json'
    if os.path.exists(f):
        tr = json.load(open(f))
        if tr.get('ok'):
            audio = {p: clean_notes(tr[p]['notes'], p) for p in PARTS}
            info['resid'] = tr['resid']
            info['agree'] = {p: tr[p]['agree'] for p in PARTS}
            audio_ok = (tr['resid'] <= a.max_resid and all(tr[p]['acc'] >= a.min_acc for p in PARTS)
                        and all(tr[p]['agree'] >= a.min_agree for p in PARTS) and plausible(audio))
    sheet = None
    x = f'{work}/sheets/{t["id"]}.musicxml'
    if os.path.exists(x):
        try:
            sheet = omr_parts.split_voices(omr_parts.read_events(x))
        except Exception:
            sheet = None
        if sheet and not plausible(sheet):
            sheet = None
    if audio and sheet:
        mean, shift, sc = agreement(audio, sheet)
        info['sheet_agree'] = {p: round(v, 2) for p, v in sc.items()}
        info['shift'] = shift
        if mean >= 0.75 and min(sc.values()) >= 0.55 and plausible(audio):
            return audio, 'verified', info
        if audio_ok:
            return audio, 'audio', info
        if sc['Lead'] >= 0.6:                 # the sheet matches the recording's melody
            return sheet_times(sheet, audio['Lead'], shift), 'sheet', info
        return None, 'sources disagree', info
    if audio_ok:
        return audio, 'audio', info
    if sheet and not audio and a.sheet_only:
        return sheet_times(sheet, None, 0), 'sheet', info
    return None, 'no trustworthy source', info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'data', 'tags.json'))
    ap.add_argument('--cache', default='track_cache.json')
    ap.add_argument('--top', type=int, default=1000, help='consider the N most-downloaded tags')
    ap.add_argument('--limit', type=int, default=1000)
    ap.add_argument('--min-acc', type=float, default=0.8)
    ap.add_argument('--min-agree', type=float, default=0.6)
    ap.add_argument('--max-resid', type=float, default=0.12)
    ap.add_argument('--no-sheet-only', dest='sheet_only', action='store_false')
    a = ap.parse_args()

    import omr_batch
    ranked = omr_batch.all_tags(a.work)[:a.top]
    cache = json.load(open(a.cache)) if os.path.exists(a.cache) else {}
    tags, stats, rejected = [], {}, []
    for t in ranked:
        if len(tags) >= a.limit:
            break
        if t['Parts'] != '4' or 'Female' in t['Type']:
            continue
        parts, source, info = decide(t, a.work, a)
        if parts is None:
            rejected.append((t['rank'], t['Title'], source, info))
            continue
        parts = {p: sorted(parts[p], key=lambda n: n[1]) for p in PARTS}
        stats[source] = stats.get(source, 0) + 1
        has_tracks = all(t.get('_types', {}).get(p) == 'mp3' for p in PARTS)
        tracks = {p: resolve_track(t.get(p), cache) for p in PARTS} if has_tracks else {}
        json.dump(cache, open(a.cache, 'w'))
        tags.append({
            'id': int(t['id']),
            'title': t['Title'],
            'alt': t.get('AltTitle') or '',
            'version': t.get('Version') or '',
            'arranger': t.get('Arranger') or '',
            'writtenKey': t.get('WritKey') or '',
            'lyrics': re.sub(r'\s+\n', '\n', (t.get('Lyrics') or '').strip()),
            'downloads': int(t.get('Downloaded') or 0),
            'rank': t['rank'],
            'source': source,
            'page': f"{SITE}tag-{t['id']}-{slug(t['Title'])}",
            'sheet': t.get('SheetMusicAlt') or '',
            'credit': ', '.join(x for x in [t.get('Quartet'), t.get('Teacher')] if x),
            'tracks': tracks,
            'parts': parts,
        })
        print(len(tags), t['rank'], source, t['Title'], flush=True)
    out = {
        'source': 'barbershoptags.com API — metadata, lyrics, sheet-music and learning-track links. '
                  'Notes transcribed from the learning tracks (demix + pYIN) and/or the sheet music (homr OMR).',
        'generated': time.strftime('%Y-%m-%d'),
        'tags': tags,
    }
    with open(a.out, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
    print('wrote', len(tags), 'tags', stats, '; rejected', len(rejected))
    json.dump(rejected, open('rejected.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
