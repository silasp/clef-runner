#!/usr/bin/env python3
"""Read an arranger's score file into the four barbershop parts.

  score_parts.py FILE            # .mscz/.mscx (MuseScore 1–4), .mxl/.xml/.musicxml
                                 # (Finale .musx: convert first with musx2mxl)

Returns, per part, a list of events  [midi|None, beat, beats, syllable, flags]
(beat/beats in quarter notes from the start; None = rest; syllable '' = held,
'lo-' = first syllable of a word; flags: '|' first event of a bar, '~' tied
to the next note).

Parts are taken from the score's layout: four staves in score order (or by
their names), or two staves with two voices each (upper voice = Tenor/Bari).
A staff written in chords is split by register at each onset. Lyrics found
in one part are shared with the others where their notes start together.
"""
import io, re, sys, zipfile
import xml.etree.ElementTree as ET
from fractions import Fraction as F

PARTS = ['Tenor', 'Lead', 'Bari', 'Bass']
DUR = {'longa': 16, 'breve': 8, 'whole': 4, 'half': 2, 'quarter': 1, 'eighth': F(1, 2), '16th': F(1, 4),
       '32nd': F(1, 8), '64th': F(1, 16), '128th': F(1, 32)}


class Ev:
    __slots__ = ('staff', 'voice', 'onset', 'dur', 'midis', 'ties', 'syl', 'grace')

    def __init__(self, staff, voice, onset, dur, midis, ties=None, syl=None, grace=False):
        self.staff, self.voice, self.onset, self.dur = staff, voice, F(onset), F(dur)
        self.midis = midis                       # [] = rest
        self.ties = ties or [False] * len(midis)
        self.syl = syl
        self.grace = grace


def _text(el, path, default=None):
    x = el.find(path)
    return x.text.strip() if x is not None and x.text else default


def _lyric_text(ly):
    t = _text(ly, 'text')
    if t is None:                                # MuseScore 1: rich text in html-data
        h = ly.find('html-data')
        if h is not None:
            t = re.sub(r'<[^>]+>', '', ET.tostring(h, encoding='unicode', method='xml'))
            t = re.sub(r'.*\}', '', t, flags=re.S) if '}' in t else t
            t = ' '.join(t.split())
        else:
            t = _text(ly, 'data')
    if t is None:
        return None
    t = re.sub(r'<[^>]+>', '', t).strip()
    syl = _text(ly, 'syllabic', 'single')
    return t + ('-' if syl in ('begin', 'middle') else '') if t else None


# ---------------------------------------------------------------- MuseScore
def read_mscx(path):
    if str(path).lower().endswith('.mscz'):
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.endswith('.mscx'))
            root = ET.fromstring(z.read(name))
    else:
        root = ET.parse(path).getroot()
    score = root.find('Score') if root.find('Score') is not None else root
    div = int(_text(score, 'Division', '480'))
    names = []
    for part in score.findall('Part'):
        nm = _text(part, 'trackName') or _text(part, 'Instrument/longName') or ''
        nm = re.sub(r'<[^>]+>', '', nm)
        for _ in part.findall('Staff'):
            names.append(nm)
    staves = [s for s in score.findall('Staff') if s.find('Measure') is not None]
    events, keys, bars = [], [], []
    for si, st in enumerate(staves):
        mstart = F(0)
        timesig = F(4)
        for meas in st.findall('Measure'):
            # MuseScore 3/4: <voice> containers; 1/2: elements with <track>/<tick>
            voices = meas.findall('voice')
            streams = [(vi, list(v)) for vi, v in enumerate(voices)] if voices else [(None, list(meas))]
            longest = F(0)
            lyr_by_tick = {}
            for vi0, elems in streams:
                pos = {}
                ratio = F(1)
                tuplets = {}
                cur_track = None
                for el in elems:
                    tag = el.tag
                    if tag == 'TimeSig':
                        n, d = _text(el, 'sigN') or _text(el, 'nom1'), _text(el, 'sigD') or _text(el, 'den')
                        if n and d:
                            timesig = F(int(re.match(r'\d+', n).group()), 1) * 4 / int(d)
                        continue
                    if tag == 'KeySig' and si == 0 and not keys:
                        acc = _text(el, 'accidental') or _text(el, 'concertKey') or _text(el, 'subtype')
                        try:
                            v = int(acc)
                            keys.append(v if -7 <= v <= 7 else ((v + 128) % 256) - 128 if v > 7 else v)
                        except (TypeError, ValueError):
                            pass
                        continue
                    if tag == 'Tuplet':
                        nn, an = _text(el, 'normalNotes'), _text(el, 'actualNotes')
                        r = F(int(nn), int(an)) if nn and an else F(1)
                        if el.get('id') is not None:
                            tuplets[el.get('id')] = r        # MuseScore 1/2: referenced by id
                        else:
                            ratio = r                         # MuseScore 3/4: applies until endTuplet
                        continue
                    if tag == 'endTuplet':
                        ratio = F(1)
                        continue
                    track = int(_text(el, 'track', '-1'))
                    voice = vi0 if vi0 is not None else (track % 4 if track >= 0 else (cur_track or 0))
                    if tag == 'location' or tag == 'Location':
                        fr = _text(el, 'fractions')
                        if fr:
                            pos[voice] = pos.get(voice, F(0)) + F(fr) * 4
                        continue
                    if tag == 'Lyrics':                       # MuseScore 1: lyrics beside the chords
                        tk = _text(el, 'tick')
                        if tk is not None and (_text(el, 'no', '0') in ('0', '1')):
                            lyr_by_tick[(int(tk), int(_text(el, 'track', str(si * 4))) % 4)] = _lyric_text(el)
                        continue
                    if tag not in ('Chord', 'Rest'):
                        continue
                    cur_track = voice
                    tk = _text(el, 'tick')
                    if tk is not None:
                        pos[voice] = F(int(tk), div) - mstart
                    p = pos.get(voice, F(0))
                    dt = _text(el, 'durationType', 'quarter')
                    if dt == 'measure':
                        d = F(_text(el, 'duration', '')) * 4 if _text(el, 'duration') else timesig
                    else:
                        d = F(DUR.get(dt, 1))
                        dots = int(_text(el, 'dots', '0'))
                        d = d * (2 - F(1, 2 ** dots))
                        tref = _text(el, 'Tuplet')
                        d *= tuplets.get(tref, ratio) if tref else ratio
                    grace = tag == 'Chord' and (el.find('acciaccatura') is not None or el.find('appoggiatura') is not None
                                                or (dt in ('eighth', '16th', '32nd') and el.find('grace4') is not None)
                                                or any(c.tag.startswith('grace') for c in el))
                    if tag == 'Rest':
                        events.append(Ev(si, voice, mstart + p, d, []))
                    else:
                        midis, ties = [], []
                        for n in el.findall('Note'):
                            pt = _text(n, 'pitch')
                            if pt is None:
                                continue
                            midis.append(int(pt))
                            sp = [s for s in n.findall('Spanner') if s.get('type') == 'Tie']
                            ties.append(n.find('Tie') is not None or any(s.find('next') is not None for s in sp))
                        syl = None
                        for ly in el.findall('Lyrics'):
                            if _text(ly, 'no', '0') in ('0', '1'):
                                syl = _lyric_text(ly)
                                break
                        if midis and not grace:
                            events.append(Ev(si, voice, mstart + p, d, midis, ties, syl))
                    if not grace:
                        pos[voice] = p + d
                        longest = max(longest, pos[voice])
            # attach MuseScore 1 lyrics by tick
            if lyr_by_tick:
                for e in events:
                    if e.staff == si and e.midis and e.syl is None:
                        k = (int((e.onset) * div), e.voice)
                        if k in lyr_by_tick:
                            e.syl = lyr_by_tick[k]
                        elif (int(e.onset * div), 0) in lyr_by_tick and e.voice != 0:
                            pass
            mlen = longest if longest > 0 else timesig
            irregular = meas.get('len')
            if irregular:
                mlen = F(irregular) * 4
            if si == 0:
                bars.append(mstart)
            mstart += mlen
    return events, names[:len(staves)], (keys[0] if keys else 0), bars


# ---------------------------------------------------------------- MusicXML
STEP = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def read_musicxml(path):
    data = open(path, 'rb').read()
    if data[:2] == b'PK':
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            cont = ET.fromstring(z.read('META-INF/container.xml'))
            rf = cont.find('.//{*}rootfile')
            name = rf.get('full-path') if rf is not None else next(n for n in z.namelist() if n.endswith(('.xml', '.musicxml')) and 'META' not in n)
            data = z.read(name)
    root = ET.fromstring(data)
    for el in root.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
    names = {sp.get('id'): (_text(sp, 'part-name') or '') for sp in root.iter('score-part')}
    events, staff_names, key = [], [], None
    staff_base = 0
    bars = []
    for part in root.findall('part'):
        nstaves = 1
        div = 1
        octave_shift = {}
        t = F(0)
        for meas in part.findall('measure'):
            mstart = t
            if staff_base == 0:
                bars.append(mstart)
            pos = F(0)
            longest = F(0)
            last_onset = F(0)
            for el in meas:
                if el.tag == 'attributes':
                    div = int(_text(el, 'divisions', str(div)))
                    nstaves = int(_text(el, 'staves', str(nstaves)))
                    if key is None and _text(el, 'key/fifths') is not None:
                        key = int(_text(el, 'key/fifths'))
                    for c in el.findall('clef'):
                        oc = _text(c, 'clef-octave-change')
                        octave_shift[int(c.get('number', '1'))] = int(oc) * 12 if oc else 0
                elif el.tag == 'backup':
                    pos -= F(int(_text(el, 'duration', '0')), div)
                elif el.tag == 'forward':
                    pos += F(int(_text(el, 'duration', '0')), div)
                    longest = max(longest, pos)
                elif el.tag == 'note':
                    if el.find('grace') is not None or el.find('cue') is not None:
                        continue
                    dur = F(int(_text(el, 'duration', '0')), div)
                    chord = el.find('chord') is not None
                    onset = last_onset if chord else pos
                    staff = int(_text(el, 'staff', '1'))
                    voice = int(re.sub(r'\D', '', _text(el, 'voice', '1')) or 1)
                    syl = None
                    for ly in el.findall('lyric'):
                        if ly.get('number', '1') in ('1', 'verse1', 'part1verse1') or syl is None:
                            tx = ''.join(x.text or '' for x in ly.findall('text'))
                            if tx:
                                s = _text(ly, 'syllabic', 'single')
                                syl = tx + ('-' if s in ('begin', 'middle') else '')
                            if ly.get('number', '1') in ('1',):
                                break
                    tie = any(x.get('type') == 'start' for x in el.findall('tie')) or \
                        any(x.get('type') == 'start' for x in el.findall('notations/tied'))
                    if el.find('rest') is not None:
                        ev = Ev(staff_base + staff - 1, voice, mstart + onset, dur, [])
                        events.append(ev)
                    else:
                        p = el.find('pitch')
                        m = (int(_text(p, 'octave')) + 1) * 12 + STEP[_text(p, 'step')] + int(float(_text(p, 'alter', '0')))
                        m += octave_shift.get(staff, 0)
                        if chord and events and events[-1].onset == mstart + onset and events[-1].staff == staff_base + staff - 1 and events[-1].midis:
                            events[-1].midis.append(m)
                            events[-1].ties.append(tie)
                            if syl and not events[-1].syl:
                                events[-1].syl = syl
                        else:
                            events.append(Ev(staff_base + staff - 1, voice, mstart + onset, dur, [m], [tie], syl))
                    if not chord:
                        last_onset = pos
                        pos += dur
                        longest = max(longest, pos)
            t = mstart + longest
        for k in range(nstaves):
            staff_names.append(names.get(part.get('id'), ''))
        staff_base += nstaves
    return events, staff_names, key or 0, bars


# ---------------------------------------------------------------- to parts
def _lanes(events, staff):
    """Monophonic lanes for one staff: per voice when the voices are
    single-line, else split chords by register (top, bottom)."""
    ev = sorted([e for e in events if e.staff == staff], key=lambda e: (e.onset, e.voice))
    voices = sorted({e.voice for e in ev if e.midis})
    single = all(len(e.midis) <= 1 for e in ev)
    if len(voices) >= 2 and single:
        lanes = []
        for v in voices[:2]:
            lanes.append([e for e in ev if e.voice == v])
        # upper lane first
        med = [sorted(m for e in ln for m in e.midis)[len([1 for e in ln for _ in e.midis]) // 2] for ln in lanes]
        if med[0] < med[1]:
            lanes.reverse()
        return lanes
    # register split at each onset (also for a single voice with chords)
    sounding_ev = [e for e in ev if e.midis]
    onsets = sorted({e.onset for e in ev})
    hi, lo = [], []
    for k, t in enumerate(onsets):
        nxt = onsets[k + 1] if k + 1 < len(onsets) else None
        now = [e for e in sounding_ev if e.onset <= t < e.onset + e.dur]
        starting = [e for e in now if e.onset == t]
        end = nxt if nxt is not None else t + max([e.dur for e in now] or [F(1)])
        if not now:
            for lane in (hi, lo):
                lane.append(Ev(staff, 0, t, end - t, []))
            continue
        pitches = sorted({m for e in now for m in e.midis})
        top, bot = pitches[-1], pitches[0]
        syl = next((e.syl for e in starting if e.syl), None)
        for lane, m in ((hi, top), (lo, bot)):
            started = any(m in e.midis for e in starting)
            prev = lane[-1] if lane else None
            if prev and prev.midis == [m] and not started and prev.onset + prev.dur == t:
                prev.dur = end - prev.onset            # held through this onset
            else:
                tie = any(e.ties[e.midis.index(m)] for e in now if m in e.midis and e.onset + e.dur == end)
                lane.append(Ev(staff, 0, t, end - t, [m], [tie], syl if started else None))
    return [hi, lo]


def _merge_rests(lane):
    out = []
    for e in sorted(lane, key=lambda e: e.onset):
        if out and not e.midis and not out[-1].midis and out[-1].onset + out[-1].dur == e.onset:
            out[-1].dur += e.dur
        else:
            out.append(e)
    return out


def score_parts(events, names, measure_starts=None):
    staves = sorted({e.staff for e in events if e.midis})
    lanes = {}
    named = {}
    for s in staves:
        nm = (names[s] if s < len(names) else '').lower()
        for p, keys in (('Tenor', ('tenor', 'tnr')), ('Lead', ('lead', 'melody')), ('Bari', ('bari',)), ('Bass', ('bass',))):
            if any(k in nm for k in keys) and not ('/' in nm or '&' in nm or ' and ' in nm):
                named[s] = p
    if len(staves) >= 4:
        if len(set(named.values())) == 4:
            order = {p: s for s, p in named.items()}
        else:
            order = dict(zip(PARTS, staves[:4]))
        for p in PARTS:
            ls = _lanes(events, order[p])
            lanes[p] = ls[0] if p in ('Tenor', 'Bari') or len(ls) == 1 else ls[0]
    elif len(staves) == 2:
        up, low = _lanes(events, staves[0]), _lanes(events, staves[1])
        lanes['Tenor'], lanes['Lead'] = up[0], up[-1]
        lanes['Bari'], lanes['Bass'] = low[0], low[-1]
    else:
        return None
    out = {}
    for p in PARTS:
        lane = _merge_rests(lanes[p])
        out[p] = lane
    return out


def to_parts(path):
    """Parse a score file into {part: [[midi|None, beat, beats, syl, flags], ...]}, key fifths."""
    p = str(path).lower()
    if p.endswith(('.mscz', '.mscx')):
        events, names, key, bars = read_mscx(path)
    else:
        events, names, key, bars = read_musicxml(path)
    lanes = score_parts(events, names)
    if not lanes:
        return None, key
    parts = {}
    lyric_part = max(PARTS, key=lambda q: sum(1 for e in lanes[q] if e.syl))
    lyr = {e.onset: e.syl for e in lanes[lyric_part] if e.syl}
    for q in PARTS:
        own = any(e.syl for e in lanes[q])
        seq = []
        for e in lanes[q]:
            syl = e.syl if own else lyr.get(e.onset)
            if e.midis:
                if syl is None and lyr:
                    syl = ''
                seq.append([e.midis[0], float(e.onset), float(e.dur), syl, ('~' if e.ties[0] else '')])
            else:
                seq.append([None, float(e.onset), float(e.dur), None, ''])
        for n in seq:
            if any(abs(n[1] - b) < 1e-6 for b in bars) and n is not seq[0]:
                n[4] = '|' + n[4]
        # tie only to an equal next pitch
        for k, n in enumerate(seq):
            if '~' in n[4] and not (k + 1 < len(seq) and seq[k + 1][0] == n[0]):
                n[4] = n[4].replace('~', '')
        parts[q] = seq
    fix_octaves(parts)
    return parts, key


def fix_octaves(parts):
    """Put each staff pair in its sounding octave. Scores (and converters)
    disagree on whether a tenor clef's octave is already applied, so judge by
    the music: choose octave shifts for the upper (Tenor/Lead) and lower
    (Bari/Bass) pair together so the four voices sit closest to their
    typical registers (medians measured on the recorded tags: Tenor ≈ F4,
    Lead ≈ C4, Bari ≈ A♯3, Bass ≈ D♯3)."""
    typical = {'Tenor': 65, 'Lead': 60, 'Bari': 58, 'Bass': 51}

    def med(p):
        ms = sorted(n[0] for n in parts[p] if n[0] is not None)
        return ms[len(ms) // 2] if ms else None
    meds = {p: med(p) for p in typical}
    if any(v is None for v in meds.values()):
        return
    best = None
    for ku in (-24, -12, 0, 12, 24):
        for kl in (-24, -12, 0, 12, 24):
            cost = sum((meds[p] + (ku if p in ('Tenor', 'Lead') else kl) - typical[p]) ** 2 for p in typical)
            cost += 0.01 * (abs(ku) + abs(kl))          # prefer leaving a score as written
            if best is None or cost < best[0]:
                best = (cost, ku, kl)
    _, ku, kl = best
    for p, k in (('Tenor', ku), ('Lead', ku), ('Bari', kl), ('Bass', kl)):
        if k:
            for n in parts[p]:
                if n[0] is not None:
                    n[0] += k

if __name__ == '__main__':
    parts, key = to_parts(sys.argv[1])
    if not parts:
        print('could not split into four parts')
        sys.exit(1)
    print('key fifths', key)
    for q in PARTS:
        print(q, ' '.join(f"{n[0]}{'.' if n[0] is None else ''}:{n[2]:g}{('/' + n[3]) if n[3] else ''}{n[4]}" for n in parts[q]))
