#!/usr/bin/env python3
"""Read the notes out of a legacy Finale .mus file (Finale 2000s–2011, the
"ENIGMA BINARY FILE" format) — no Finale needed.

  finale_mus.py FILE.mus [Major:Eb]

Format notes (worked out from barbershoptags.com's files; not official):
* After a text header, the file is a sequence of chunks:
  type (u16) · compressed length (u32) · checksum (u32) · zlib stream.
  Type 0x16 holds note *entries*, 0x17 text (lyrics, titles), 0x1a "others"
  and 0x1b "details" records (layout, frames, lyric assignments…).
* An entry record is 32 + 6·max(1, n) bytes, little-endian:
    0  u32 entry number      6  u32 previous entry   10  u32 next entry
   14  i16 duration (EDUs: 1024 = quarter)           20  u16 flags (0x4000 = note)
   24  i16 number of notes n
   26+6j  note j: i16 pitch = harmonic level·16 + alteration (1 = ♯, 9 = ♭,
          2 = ♯♯, 10 = ♭♭), i16 —, u16 flags (0x4000 = tie to next)
  harmonic level = scale steps from the key's tonic (middle-C octave).
* Entries form doubly linked lists, one per staff layer, running through the
  whole piece; "previous = 0" marks the first entry of a bar.

The four barbershop voices are the four lists with the most notes, ranked by
register (frames, which would name each list's staff, aren't decoded; check
the result against a recording). Lyrics (in details records) aren't read.
"""
import re, struct, sys, zlib

PARTS = ['Tenor', 'Lead', 'Bari', 'Bass']
MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]
ALT = {0: 0, 1: 1, 2: 2, 9: -1, 10: -2}
PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def chunks(data):
    if not data.startswith(b'ENIGMA BINARY FILE'):
        raise ValueError('not a Finale .mus (ENIGMA BINARY FILE)')
    out, off = {}, 0
    while True:
        i = data.find(b'\x78', off)
        if i < 0:
            break
        if i >= 10 and data[i + 1] in (0x01, 0x5e, 0x9c, 0xda):
            try:
                o = zlib.decompressobj()
                d = o.decompress(data[i:])
                used = len(data) - i - len(o.unused_data)
                if len(d) > 8:
                    typ = struct.unpack_from('<H', data, i - 10)[0]
                    out[typ] = out.get(typ, b'') + d
                    off = i + used
                    continue
            except zlib.error:
                pass
        off = i + 1
    return out


def entries(block):
    E, k = {}, 0
    while k + 38 <= len(block):
        n = struct.unpack_from('<h', block, k + 24)[0]
        if not 0 <= n <= 12:
            break
        ent, = struct.unpack_from('<I', block, k)
        prev, = struct.unpack_from('<I', block, k + 6)
        nxt, = struct.unpack_from('<I', block, k + 10)
        dur = struct.unpack_from('<h', block, k + 14)[0]
        flags = struct.unpack_from('<H', block, k + 20)[0]
        notes = [struct.unpack_from('<hhH', block, k + 26 + 6 * j) for j in range(n)]
        E[ent] = {'prev': prev, 'next': nxt, 'dur': dur, 'flags': flags, 'notes': notes}
        k += 32 + 6 * max(1, n)
    return E


def chains(E):
    targets = {e['next'] for e in E.values()}
    out = []
    for h, e in E.items():
        if e['prev'] != 0 or h in targets:
            continue
        c, x, seen = [], h, set()
        while x and x in E and x not in seen:
            seen.add(x)
            c.append(x)
            x = E[x]['next']
        out.append(c)
    return out


def parse_key(written):
    """'Major:Eb' / 'Minor:C#' → (tonic pc, scale)."""
    m = re.match(r'\s*(Major|Minor)\s*:\s*([A-G])([#b]?)', written or '', re.I)
    if not m:
        return 0, MAJOR
    pc = (PC[m.group(2)] + (1 if m.group(3) == '#' else -1 if m.group(3) == 'b' else 0)) % 12
    return pc, (MINOR if m.group(1).lower() == 'minor' else MAJOR)


def to_parts(path, written_key=None):
    """{part: [[midi|None, beat, beats, syl, flags]]} or None, like score_parts.to_parts."""
    blocks = chunks(open(path, 'rb').read())
    E = entries(blocks.get(0x16, b''))
    cs = chains(E)
    total = lambda c: sum(max(0, E[x]['dur']) for x in c)
    sounding = lambda c: [x for x in c if E[x]['notes'] and E[x]['dur'] > 0]
    # voices: the four lists carrying the most real notes (placeholder lists
    # hold one repeated pitch); a voice split over several lists is lost
    cand = [c for c in cs if len(sounding(c)) >= 3 and len({E[x]['notes'][0][0] for x in sounding(c)}) >= 2]
    if len(cand) < 4:
        return None
    group = sorted(cand, key=lambda c: -len(sounding(c)))[:4]
    if min(total(c) for c in group) < 0.5 * max(total(c) for c in group):
        return None                      # not four whole voices
    tonic, scale = parse_key(written_key)

    def midi(raw):
        lev, alt = raw >> 4, ALT.get(raw & 15, 0)
        o, step = divmod(lev, 7)
        return 60 + tonic + 12 * o + scale[step] + alt

    lanes = []
    for c in group:
        seq, beat = [], 0.0
        for x in c:
            e = E[x]
            if e['dur'] <= 0:          # grace notes and empty placeholders
                continue
            beats = e['dur'] / 1024
            bar = '|' if e['prev'] == 0 and seq else ''
            if e['notes'] and e['flags'] & 0x4000:
                ns = sorted(e['notes'], key=lambda n: n[0])
                tie = '~' if any(n[2] & 0x4000 for n in ns) else ''
                seq.append([[midi(n[0]) for n in ns], beat, beats, None, bar + tie])
            else:
                seq.append([None, beat, beats, None, bar])
            beat += beats
        lanes.append(seq)
    med = lambda s: sorted(n[0][-1] for n in s if n[0] is not None)[len([1 for n in s if n[0] is not None]) // 2]
    lanes.sort(key=med, reverse=True)
    parts = dict(zip(PARTS, lanes))
    # divisi / optional notes: the tenor takes the upper, everyone else the lower
    for q in PARTS:
        for n in parts[q]:
            if n[0] is not None:
                n[0] = n[0][-1] if q == 'Tenor' else n[0][0]
    for q in PARTS:     # ties only between equal pitches
        s = parts[q]
        for k, n in enumerate(s):
            if '~' in n[4] and not (k + 1 < len(s) and s[k + 1][0] == n[0]):
                n[4] = n[4].replace('~', '')
    import score_parts
    score_parts.fix_octaves(parts)
    return parts


if __name__ == '__main__':
    sys.path.insert(0, __import__('os').path.dirname(__file__))
    parts = to_parts(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    if not parts:
        print('no four-voice layout found')
        sys.exit(1)
    for q in PARTS:
        print(q, ' '.join(f"{n[0] if n[0] is not None else 'r'}:{n[2]:g}{n[4]}" for n in parts[q]))
