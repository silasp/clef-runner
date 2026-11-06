#!/usr/bin/env python3
"""Turn an OMR'd barbershop sheet (MusicXML from homr) into four parts.

Barbershop tags are engraved on two staves: Tenor (stems up) + Lead (stems
down) on a treble-8 staff, Bari (up) + Bass (down) on a bass staff. homr
reads each staff as chords without voice labels, so voices are split by
register: at every onset, the highest sounding note on the top staff is
the Tenor and the lowest the Lead (one note = unison); likewise Bari/Bass
on the bottom staff. Treble-8 notes are dropped an octave.

Output notes are [midi, start_beats, dur_beats].
"""
import re
import xml.etree.ElementTree as ET

STEP = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def read_events(path):
    root = ET.parse(path).getroot()
    events = []                     # (staff, start, dur, midi)
    divisions = 1
    t = 0.0
    for part in root.findall('part')[:1]:
        for meas in part.findall('measure'):
            last_start = t
            for el in meas:
                if el.tag == 'attributes':
                    d = el.find('divisions')
                    if d is not None:
                        divisions = int(d.text)
                elif el.tag == 'backup':
                    t -= int(el.find('duration').text) / divisions
                elif el.tag == 'forward':
                    t += int(el.find('duration').text) / divisions
                elif el.tag == 'note':
                    dur_el = el.find('duration')
                    dur = int(dur_el.text) / divisions if dur_el is not None else 0
                    is_chord = el.find('chord') is not None
                    start = last_start if is_chord else t
                    staff = int((el.findtext('staff') or '1'))
                    p = el.find('pitch')
                    if p is not None:
                        midi = 12 * (int(p.findtext('octave')) + 1) + STEP[p.findtext('step')] + int(float(p.findtext('alter') or 0))
                        events.append((staff, start, dur, midi))
                    if not is_chord:
                        last_start = start
                        t = start + dur
    return events


def split_voices(events):
    parts = {'Tenor': [], 'Lead': [], 'Bari': [], 'Bass': []}
    for staff, (hi_name, lo_name), shift in ((1, ('Tenor', 'Lead'), -12), (2, ('Bari', 'Bass'), 0)):
        ev = [e for e in events if e[0] == staff]
        onsets = sorted({round(e[1], 4) for e in ev})
        for k, t in enumerate(onsets):
            nxt = onsets[k + 1] if k + 1 < len(onsets) else None
            sounding = [e for e in ev if e[1] <= t + 1e-6 < e[1] + e[2] - 1e-6]
            starting = {e[3] for e in ev if abs(e[1] - t) < 1e-6}
            if not sounding:
                continue
            hi = max(e[3] for e in sounding)
            lo = min(e[3] for e in sounding)
            end = nxt if nxt is not None else t + max(e[2] for e in sounding)
            for name, m in ((hi_name, hi), (lo_name, lo)):
                seq = parts[name]
                if seq and seq[-1][0] == m + shift and abs(seq[-1][1] + seq[-1][2] - t) < 1e-6 and m not in starting:
                    seq[-1][2] = round(end - seq[-1][1], 4)      # held through this onset
                else:
                    seq.append([m + shift, round(t, 4), round(end - t, 4)])
    return parts


def key_fifths(path):
    m = re.search(r'<fifths>(-?\d+)</fifths>', open(path).read())
    return int(m.group(1)) if m else 0


if __name__ == '__main__':
    import sys
    ps = split_voices(read_events(sys.argv[1]))
    for p, ns in ps.items():
        print(p, len(ns), ' '.join(str(n[0]) for n in ns))
