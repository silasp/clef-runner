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


# ---------------------------------------------------------------- lyrics → syllables on notes
def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def norm_word(w):
    return re.sub(r"[^a-z0-9']", '', w.lower().replace('’', "'"))


def lyric_words(text):
    return [w for w in re.split(r'\s+', text or '') if norm_word(w)]


def word_times(lyrics, heard):
    """Give each lyric word a sung start time by aligning the recogniser's
    (approximate) words to the real lyric text. Unmatched words between
    two matched ones are spaced evenly; leading/trailing ones are dropped."""
    L = [norm_word(w) for w in lyric_words(lyrics)]
    H = [(norm_word(w), s) for w, s, _ in heard if norm_word(w)]
    n, m = len(L), len(H)
    if not n or not m:
        return None
    sub = lambda a, b: lev(a, b) / max(len(a), len(b), 1)
    D = np.zeros((n + 1, m + 1)); D[:, 0] = np.arange(n + 1) * 0.7; D[0, :] = np.arange(m + 1) * 0.7
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j - 1] + sub(L[i - 1], H[j - 1][0]), D[i - 1, j] + 0.7, D[i, j - 1] + 0.7)
    times = [None] * n
    i, j = n, m
    while i > 0 and j > 0:
        c = sub(L[i - 1], H[j - 1][0])
        if abs(D[i, j] - (D[i - 1, j - 1] + c)) < 1e-9:
            if c <= 0.5:
                times[i - 1] = H[j - 1][1]
            i -= 1; j -= 1
        elif abs(D[i, j] - (D[i - 1, j] + 0.7)) < 1e-9:
            i -= 1
        else:
            j -= 1
    known = [k for k, t in enumerate(times) if t is not None]
    if len(known) < max(2, n // 4):
        return None
    for a_, b_ in zip(known, known[1:]):
        for k in range(a_ + 1, b_):
            times[k] = times[a_] + (times[b_] - times[a_]) * (k - a_) / (b_ - a_)
    return times


_pyphen = None


def syllables(word):
    global _pyphen
    if _pyphen is None:
        import pyphen
        _pyphen = pyphen.Pyphen(lang='en_US')
    clean = re.sub(r'[^A-Za-z\'’-]', '', word) or word
    parts = _pyphen.inserted(clean).split('-')
    return [p for p in parts if p] or [clean]


def attach_syllables(notes, lyrics, times, skip_cost=0.8, max_off=1.5):
    """5th field per note: syllable ('lo-' / 'ving'), '' = held over (melisma),
    None = no lyric info.

    Each timed word starts on its own note, in order, as near as possible to
    its recognised start (dynamic programming; a word may be skipped at a
    cost). Notes after a word's first note, up to the next word, carry the
    rest of its syllables and then the melisma."""
    syl = [None] * len(notes)
    if times is None or not notes:
        return syl
    timed = [(w, t) for w, t in zip(lyric_words(lyrics), times) if t is not None]
    W, N = len(timed), len(notes)
    on = [n[1] for n in notes]
    INF = 1e9
    # best[i][j]: cost with word i starting at note j; prev pointers for backtrack
    best = np.full((W, N), INF); prev = np.full((W, N), -2, dtype=int)
    skipped = np.zeros(W + 1)          # cost of skipping words 0..i-1 entirely
    for i in range(W):
        skipped[i + 1] = skipped[i] + skip_cost
    for i, (_, t) in enumerate(timed):
        for j in range(N):
            c = min(abs(on[j] - t), max_off)
            cand, arg = skipped[i], -1      # all earlier words skipped
            for i2 in range(i):             # previous placed word i2 at note j2 < j
                pen = (i - i2 - 1) * skip_cost
                row = best[i2, :j]
                if len(row):
                    j2 = int(np.argmin(row))
                    if row[j2] + pen < cand:
                        cand, arg = row[j2] + pen, i2 * N + j2
            best[i, j] = cand + c
            prev[i, j] = arg
    final, end_state = skipped[W], None
    for i in range(W):
        for j in range(N):
            v = best[i, j] + (W - 1 - i) * skip_cost
            if v < final:
                final, end_state = v, (i, j)
    starts = {}
    while end_state is not None:
        i, j = end_state
        starts[j] = i
        p = prev[i, j]
        end_state = None if p < 0 else (p // N, p % N)
    order = sorted(starts)
    for k, j in enumerate(order):
        stop = order[k + 1] if k + 1 < len(order) else N
        idx = list(range(j, stop))
        sy = syllables(timed[starts[j]][0])
        if len(idx) < len(sy):
            sy = sy[:len(idx) - 1] + [''.join(sy[len(idx) - 1:])]
        for q, ni in enumerate(idx):
            syl[ni] = sy[q] + ('-' if q < len(sy) - 1 else '') if q < len(sy) else ''
    return syl


# ---------------------------------------------------------------- rhythm
VALUES = np.array([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8])


def quantise_beats(x):
    return float(VALUES[np.argmin(np.abs(np.log(VALUES) - np.log(max(x, 0.1))))])


def note_spans(notes):
    """Inter-onset interval (or own length before a rest) for each note."""
    out = []
    for i, n in enumerate(notes):
        if i + 1 < len(notes) and notes[i + 1][1] - (n[1] + n[2]) < 0.35:
            out.append(notes[i + 1][1] - n[1])
        else:
            out.append(n[2])
    return out


def estimate_spb(all_spans):
    spans = np.array([s for s in all_spans if 0.12 < s < 4])
    if not len(spans):
        return 0.6
    best = None
    for spb in np.arange(0.3, 1.3, 0.01):
        x = spans / spb
        err = np.mean(np.abs(np.log(x) - np.log([quantise_beats(v) for v in x])))
        err += 0.08 * abs(np.log(spb / 0.6))     # mild prior towards ~100 bpm
        if best is None or err < best[0]:
            best = (err, spb)
    return best[1]


def add_rhythm(parts, sheet=None, shift=0):
    """4th field per note: length in beats (quarter notes). From the sheet
    music where an audio note matches a written one, else quantised from
    the recording at an estimated tempo."""
    spans = {p: note_spans(parts[p]) for p in PARTS}
    spb = estimate_spb([s for p in PARTS for s in spans[p]])
    for p in PARTS:
        written = {}
        if sheet and sheet.get(p):
            _, pairs = align([n[0] for n in parts[p]], [n[0] + shift for n in sheet[p]])
            written = {ia: sheet[p][js][2] for ia, js in pairs}
        for i, n in enumerate(parts[p]):
            b = written.get(i)
            if b is None or b <= 0:
                b = quantise_beats(spans[p][i] / spb)
            n[3:] = [round(float(b), 3)]
    return parts


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
        info['_sheet'] = sheet
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
        info['_sheet'], info['shift'] = sheet, 0
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
    ap.add_argument('--with-sheet-only', dest='sheet_only', action='store_true',
                    help='also include tags that have only sheet music (no learning tracks)')
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
        if not a.sheet_only and not all(t.get('_types', {}).get(p) == 'mp3' for p in PARTS):
            continue                       # only tags with per-part learning tracks
        parts, source, info = decide(t, a.work, a)
        if parts is None:
            rejected.append((t['rank'], t['Title'], source, {k: v for k, v in info.items() if not k.startswith('_')}))
            continue
        parts = {p: [list(n[:3]) for n in sorted(parts[p], key=lambda n: n[1])] for p in PARTS}
        sheet = info.get('_sheet')
        if source == 'sheet':     # pitches came from the sheet: take its rhythm directly
            add_rhythm(parts, {p: [[n[0], n[1], n[2]] for n in sheet[p]] for p in PARTS}, info.get('shift', 0))
        else:
            add_rhythm(parts, sheet, info.get('shift', 0))
        # lyrics: each part's own recognised words, falling back to the Lead's timing
        wf = f'{a.work}/words/{t["id"]}.json'
        heard = json.load(open(wf)) if os.path.exists(wf) else {}
        lyr = t.get('Lyrics') or ''
        lead_times = word_times(lyr, heard.get('Lead', []))
        with_lyrics = 0
        for p in PARTS:
            times = word_times(lyr, heard.get(p, [])) or lead_times
            for n, sy in zip(parts[p], attach_syllables(parts[p], lyr, times)):
                n.append(sy)
            with_lyrics += any(n[4] for n in parts[p])
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
            'lyricsTimed': with_lyrics == 4,
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
