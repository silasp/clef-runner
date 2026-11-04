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


def part_agreement(a, b):
    """Recall of the sheet's notes b in the audio a, discounted when the
    audio has many notes the sheet lacks. Without the precision term a
    degenerate sheet (e.g. one repeated pitch) "matches" any recording."""
    if len(b) < 2:
        return 0.0
    recall, pairs = align(a, b)
    precision = len(pairs) / max(1, len(a))
    return recall * min(1.0, 0.4 + 1.2 * precision)


def agreement(audio, sheet):
    """Best transposition and per-part recall of the sheet's notes in the audio."""
    best = None
    for sh in range(-7, 8):
        sc = {p: part_agreement(collapse([n[0] for n in audio[p]]), collapse([n[0] + sh for n in sheet[p]])) for p in PARTS}
        mean = float(np.mean(list(sc.values())))
        if best is None or mean > best[0]:
            best = (mean, sh, sc)
    return best


def well_ordered(parts):
    """Stricter sanity check for sheet readings: voices in barbershop order
    (Tenor ≥ Lead-ish, Bass lowest, Bari above Bass and not above the Tenor)
    and few leaps over an octave within a part. Readings that fail it score
    0.79 F1 on ground-truth tags, against 0.91 for those that pass."""
    sung = {p: [n[0] for n in parts[p] if n[0] is not None] for p in PARTS}
    if any(len(v) < 2 for v in sung.values()):
        return False
    med = {p: float(np.median(v)) for p, v in sung.items()}
    order = (med['Tenor'] >= med['Lead'] - 2 and med['Lead'] >= med['Bass'] + 3
             and med['Bari'] >= med['Bass'] - 1 and med['Tenor'] >= med['Bari'] - 1)
    leaps = max(float(np.mean(np.abs(np.diff(v)) > 12)) for v in sung.values())
    return order and leaps <= 0.08


def plausible(parts, slack=2):
    if any(len(parts[p]) < 2 for p in PARTS):
        return False
    for p in PARTS:                       # every note inside the voice's range
        lo, hi = RANGE[p]
        if any(not lo - slack <= n[0] <= hi + slack for n in parts[p]):
            return False
    med = {p: float(np.median([n[0] for n in parts[p]])) for p in PARTS}
    return med['Bass'] <= min(med['Bari'], med['Lead']) and med['Tenor'] >= med['Lead'] - 2


def beat_clock(s_lead, audio_lead, shift, word_anchors=None):
    """Beat → seconds. With a recording: anchor matched Lead notes
    (beat ↔ second) and interpolate; failing that, anchor the words where
    speech recognition heard them sung; otherwise a steady 72 bpm."""
    sec_per_beat = 60 / 72
    anchors = []
    if audio_lead:
        _, pairs = align([n[0] for n in audio_lead], [n[0] + shift for n in s_lead])
        for ia, js in pairs:
            b, s = s_lead[js][1], audio_lead[ia][1]
            if not anchors or (b > anchors[-1][0] and s > anchors[-1][1]):
                anchors.append((b, s))
    words = []
    for b, s in word_anchors or []:
        if not words or (b > words[-1][0] and s > words[-1][1]):
            words.append((b, s))
    if len(anchors) < max(3, len(words) // 2):
        anchors = words
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
    return f


def sheet_times(sheet, audio_lead, shift):
    """Time sheet notes by the recording's Lead (or a steady tempo)."""
    f = beat_clock(sheet['Lead'], audio_lead, shift)
    out = {}
    for p in PARTS:
        out[p] = [[n[0] + shift, round(max(0.0, f(n[1])), 2), round(max(0.12, f(n[1] + n[2]) - f(n[1])), 2)] for n in sheet[p]]
    return out


def load_score(work, tid, written_key=None):
    """The arranger's own score (MuseScore / MusicXML / Finale .musx converted
    with musx2mxl / legacy Finale .mus read by finale_mus), as
    ({part: [[midi|None, beat, beats, syl, flags]]}, needs_check) or (None, False).
    needs_check: the reading isn't certain (.mus) — use it only if it agrees
    with the recording."""
    import score_parts, finale_mus
    f = f'{work}/notation/{tid}.mus'
    if os.path.exists(f) and os.path.getsize(f) > 0:
        try:
            parts = finale_mus.to_parts(f, written_key)
        except Exception:  # noqa: BLE001
            parts = None
        return (parts, True) if parts else (None, False)
    for f in (f'{work}/notation/{tid}.mscz', f'{work}/notation/{tid}.xml', f'{work}/notation/{tid}.mxl', f'{work}/mxl/{tid}.mxl'):
        if not (os.path.exists(f) and os.path.getsize(f) > 0):
            continue
        try:
            parts, _ = score_parts.to_parts(f)
        except Exception:  # noqa: BLE001 — unreadable or unusual layout
            return None, False
        if not parts or any(sum(1 for n in parts[p] if n[0] is not None) < 2 for p in PARTS):
            return None, False
        return parts, False
    return None, False


def sheet_reading(work, tid):
    """homr's MusicXML for the tag's sheet, read like an arranger's score."""
    import score_parts
    x = f'{work}/sheets/{tid}.musicxml'
    if not os.path.exists(x):
        return None
    try:
        parts, _ = score_parts.to_parts(x)
    except Exception:  # noqa: BLE001
        return None
    if not parts or any(sum(1 for n in parts[p] if n[0] is not None) < 2 for p in PARTS):
        return None
    for p in PARTS:                       # OMR lyrics are unreliable: time words from the recording instead
        for n in parts[p]:
            n[3] = None
    return parts


def clean_audio(info):
    """Voices separated almost perfectly and both pitch trackers agree."""
    ag = info.get('agree') or {}
    return info.get('resid', 1) <= 0.05 and ag and float(np.mean(list(ag.values()))) >= 0.75 and min(ag.values()) >= 0.5


def heard_text(work, tid):
    """No lyrics on record: the words speech recognition heard the Lead sing."""
    wf = f'{work}/words/{tid}.json'
    if not os.path.exists(wf):
        return ''
    return ' '.join(w for w, _, _ in json.load(open(wf)).get('Lead', []))


def tuned_audio(work, tid):
    """Audio transcription with the parameters (and note filter) learned on
    arrangers' scores (tools/ml/audio_tune.py), from cached features."""
    ml = os.path.join(os.path.dirname(__file__), 'ml')
    mf, ff = os.path.join(ml, 'audio_model.json'), f'{work}/feat/{tid}.npz'
    if not (os.path.exists(mf) and os.path.exists(ff)):
        return None
    sys.path.insert(0, ml)
    import audio_tune as AT
    model = json.load(open(mf))
    z = np.load(ff)
    parts = AT.transcribe({k: z[k] for k in z.files}, model['params'])
    if model.get('filter'):
        import pickle
        clf = pickle.load(open(os.path.join(ml, 'audio_clf.pkl'), 'rb'))
        parts = AT.apply_filter(parts, clf, model['thr'])
    return {p: [[n[0], float(n[1]), float(n[2])] for n in parts[p]] for p in PARTS}


def score_word_anchors(score, heard):
    """(beat, seconds) for the score's words, from where the recogniser heard them."""
    starts, words = [], []
    prev = ''
    for m, beat, beats, syl, flags in score['Lead']:
        if m is None or not syl:
            continue
        if not prev.endswith('-'):
            starts.append(beat)
            words.append(syl.rstrip('-'))
        else:
            words[-1] += syl.rstrip('-')
        prev = syl
    times = word_times(' '.join(words), heard) if words and heard else None
    return [(b, t) for b, t in zip(starts, times or []) if t is not None]


def score_times(score, audio_lead, shift, word_anchors=None):
    """Score events → app notes [midi, start, dur, beats, syl, flags]; rests
    become flagged notes ('r', keeping the previous pitch for display)."""
    sung = {p: [[n[0], n[1], n[2]] for n in score[p] if n[0] is not None] for p in PARTS}
    f = beat_clock(sung['Lead'], audio_lead, shift, word_anchors)
    out = {}
    for p in PARTS:
        seq, last = [], None
        for m, beat, beats, syl, flags in score[p]:
            rest = m is None
            pitch = (last if last is not None else next((x[0] for x in score[p] if x[0] is not None), 60)) if rest else m + shift
            if not rest:
                last = pitch
            start = max(0.0, f(beat))
            dur = max(0.08, f(beat + beats) - f(beat))
            fl = flags + ('r' if rest else '')
            note = [int(pitch), round(start, 2), round(dur, 2), round(float(beats), 3), '' if rest else (syl if syl is not None else None)]
            if fl:
                note.append(''.join(c for c in '|~r' if c in fl))
            seq.append(note)
        out[p] = seq
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


def tag_record(t, source, with_lyrics, parts, cache, a):
    has_tracks = all(t.get('_types', {}).get(p) == 'mp3' for p in PARTS)
    tracks = {p: resolve_track(t.get(p), cache) for p in PARTS} if has_tracks else {}
    json.dump(cache, open(a.cache, 'w'))
    return {
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
        # high: the arranger's score, or a sheet reading the recording confirms (≈0.95 F1);
        # low: one unconfirmed source (sheet ≈0.83, audio) — hidden from learners until fixed
        'confidence': 'high' if source in ('score', 'verified') else 'low',
        'lyricsTimed': with_lyrics == 4,
        'page': f"{SITE}tag-{t['id']}-{slug(t['Title'])}",
        'sheet': t.get('SheetMusicAlt') or '',
        'credit': ', '.join(x for x in [t.get('Quartet'), t.get('Teacher')] if x),
        'tracks': tracks,
        'parts': parts,
    }


# ---------------------------------------------------------------- main
def decide(t, work, a):
    """Return (parts, source, info) or (None, reason, info)."""
    audio, audio_ok, info = None, False, {}
    f = f'{work}/trans/{t["id"]}.json'
    if os.path.exists(f):
        tr = json.load(open(f))
        if tr.get('ok'):
            audio = tuned_audio(work, t['id']) or {p: clean_notes(tr[p]['notes'], p) for p in PARTS}
            info['resid'] = tr['resid']
            info['agree'] = {p: tr[p]['agree'] for p in PARTS}
            audio_ok = (tr['resid'] <= a.max_resid and all(tr[p]['acc'] >= a.min_acc for p in PARTS)
                        and all(tr[p]['agree'] >= a.min_agree for p in PARTS) and plausible(audio))
    score, needs_check = (None, False) if getattr(a, 'no_scores', False) else load_score(work, t['id'], t.get('WritKey'))
    if score:
        sung = {p: [[n[0], n[1], n[2]] for n in score[p] if n[0] is not None] for p in PARTS}
        if plausible(sung):
            shift, matched, mean = 0, False, 0.0
            if audio:
                mean, shift, sc = agreement(audio, sung)
                info['score_agree'] = {p: round(v, 2) for p, v in sc.items()}
                matched = mean >= 0.35
                if not matched:          # the recording may be another arrangement/key: keep the written key
                    shift = 0
            if needs_check and mean < 0.55:
                score = None             # an uncertain reading that the recording doesn't confirm
        else:
            score = None
    if score:
        info['shift'] = shift
        wf = f'{work}/words/{t["id"]}.json'
        heard = json.load(open(wf)).get('Lead', []) if os.path.exists(wf) else []
        anchors = score_word_anchors(score, heard)
        return score_times(score, audio['Lead'] if matched else None, shift, anchors), 'score', info
    # the sheet-music reading (homr OMR, read with score_parts: voices, octaves, rests, bars).
    # Measured on arrangers' scores it beats the audio transcription (F1 ≈ 0.92 vs 0.70),
    # so it wins whenever it's plausible and not flatly contradicted by the recording.
    sheet = sheet_reading(work, t['id'])
    if sheet:
        sung = {p: [[n[0], n[1], n[2]] for n in sheet[p] if n[0] is not None] for p in PARTS}
        if not plausible(sung):
            sheet = None
    if sheet:
        mean, shift, sc = (0.0, 0, {}) if not audio else agreement(audio, sung)
        info['sheet_agree'] = {p: round(v, 2) for p, v in sc.items()}
        trusted = well_ordered(sheet) or (bool(audio) and mean >= 0.75)
        # a clean recording that disagrees with the sheet is singing another version:
        # follow the recording (it's what the learner hears)
        if audio and clean_audio(info) and mean < a.max_disagree:
            trusted = False
            info['other_version'] = True
        info['well_ordered'] = well_ordered(sheet)
        if trusted and (not audio or mean >= a.min_sheet_agree):
            matched = bool(audio) and mean >= 0.35
            shift = shift if matched else 0
            info['shift'] = shift
            wf = f'{work}/words/{t["id"]}.json'
            heard = json.load(open(wf)).get('Lead', []) if os.path.exists(wf) else []
            timed = score_times(sheet, audio['Lead'] if matched else None, shift, score_word_anchors(sheet, heard))
            if audio or a.sheet_only:
                return timed, ('verified' if matched and mean >= 0.75 else 'sheet'), info
    if audio_ok or (audio and info.get('other_version') and plausible(audio)):
        return audio, 'audio', info
    if audio and sheet:
        return None, 'sources disagree', info
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
    ap.add_argument('--max-disagree', type=float, default=0.35,
                    help='with a clean recording, a sheet agreeing less than this is another version')
    ap.add_argument('--no-scores', action='store_true', help="ignore arrangers' score files (to measure the other sources)")
    ap.add_argument('--only', default='', help='comma-separated tag ids to build (for evaluation)')
    ap.add_argument('--min-sheet-agree', type=float, default=0.0,
                    help='use the sheet reading unless it agrees with the recording less than this (see ml/sheet_gate.py)')
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
        if a.only and t['id'] not in a.only.split(','):
            continue
        if not a.sheet_only and not all(t.get('_types', {}).get(p) == 'mp3' for p in PARTS):
            continue                       # only tags with per-part learning tracks
        parts, source, info = decide(t, a.work, a)
        if parts is None:
            rejected.append((t['rank'], t['Title'], source, {k: v for k, v in info.items() if not k.startswith('_')}))
            continue
        if source in ('score', 'sheet', 'verified'):   # notation (arranger's score or sheet reading): rhythm, ties, bars, rests as written
            lyr = t.get('Lyrics') or heard_text(a.work, t['id'])
            placed = [p for p in PARTS if any(n[4] for n in parts[p])]      # an arranger's file brings its own
            pdf = f'{a.work}/sheets/{t["id"]}.pdf'
            if not placed and os.path.exists(pdf):
                import pdf_lyrics
                try:
                    # most accurate first: music-font text (0.84 on-note), then staff lines + noteheads (0.44);
                    # either beats speech-recognition timing (0.15) — see ml/lyrics_eval.py
                    placed = []
                    for reader in (pdf_lyrics.staff_lyrics_text, pdf_lyrics.staff_lyrics):
                        st = reader(pdf)
                        placed = pdf_lyrics.apply(parts, st) if st else []
                        if placed:
                            break
                    if not placed:                      # words without note positions: still the right words
                        lyr = pdf_lyrics.lyric_text(pdf, lyr) or lyr
                except Exception:  # noqa: BLE001
                    placed = []
            if len(placed) < 4:
                wf = f'{a.work}/words/{t["id"]}.json'
                heard = json.load(open(wf)) if os.path.exists(wf) else {}
                for p in [q for q in PARTS if q not in placed]:
                    sung = [n for n in parts[p] if 'r' not in (n[5] if len(n) > 5 else '')]
                    times = word_times(lyr, heard.get(p, [])) or word_times(lyr, heard.get('Lead', []))
                    for n, sy in zip(sung, attach_syllables([n[:3] for n in sung], lyr, times)):
                        n[4] = sy
            with_lyrics = sum(1 for p in PARTS if any(n[4] for n in parts[p]))
            stats[source] = stats.get(source, 0) + 1
            tags.append(tag_record(t, source, with_lyrics, parts, cache, a))
            print(len(tags), t['rank'], source, t['Title'], flush=True)
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
        lyr = t.get('Lyrics') or heard_text(a.work, t['id'])
        lead_times = word_times(lyr, heard.get('Lead', []))
        with_lyrics = 0
        for p in PARTS:
            times = word_times(lyr, heard.get(p, [])) or lead_times
            for n, sy in zip(parts[p], attach_syllables(parts[p], lyr, times)):
                n.append(sy)
            with_lyrics += any(n[4] for n in parts[p])
        stats[source] = stats.get(source, 0) + 1
        tags.append(tag_record(t, source, with_lyrics, parts, cache, a))
        print(len(tags), t['rank'], source, t['Title'], flush=True)
    out = {
        'source': 'barbershoptags.com API — metadata, lyrics, sheet-music and learning-track links. '
                  'Notes from arrangers\' score files where available (MuseScore/MusicXML/Finale), else transcribed '
                  'from the learning tracks (demix + pYIN) and/or the sheet music (homr OMR).',
        'generated': time.strftime('%Y-%m-%d'),
        'tags': tags,
    }
    with open(a.out, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
    print('wrote', len(tags), 'tags', stats, '; rejected', len(rejected))
    json.dump(rejected, open('rejected.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
