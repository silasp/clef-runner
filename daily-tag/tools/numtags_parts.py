#!/usr/bin/env python3
"""Read a numtags catalog file (github.com/bumbleblue/numtags, CC0 data) into
pitch sequences for the four parts.

numtags writes tags in scale-degree ("numbered") notation, one line per voice
(Tenor, Lead, Bari, Bass) per system: `#4` sharp, `b3` flat, `'`/`,` octave
up/down, `/` shorter, `-` hold, `0` rest, `~` tied from the previous note.
Only pitches are needed here (as a cross-check), so durations are ignored.
"""
import re, sys

PARTS = ['Tenor', 'Lead', 'Bari', 'Bass']
DEG = {1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11}
KEY_PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
TOKEN = re.compile(r"^(~)?([#b]?)([1-7])([',]*)[/.]*$")


def key_pc(name):
    m = re.match(r'\s*([A-Ga-g])([#b♯♭]?)', name or 'C')
    if not m:
        return 0
    pc = KEY_PC[m.group(1).upper()]
    return (pc + (1 if m.group(2) in '#♯' and m.group(2) else -1 if m.group(2) in 'b♭' and m.group(2) else 0)) % 12


def parse(text):
    """Returns (meta, {part: [midi, ...]}) — tied continuations merged."""
    meta, body = {}, text
    m = re.match(r'^---\n(.*?)\n---\n(.*)$', text, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ':' in line:
                k, v = line.split(':', 1)
                meta[k.strip()] = v.strip().strip('"')
        body = m.group(2)
    tonic = key_pc(meta.get('original_key'))
    parts = {p: [] for p in PARTS}
    for block in re.split(r'\n\s*\n', body):
        lines = [l for l in block.splitlines() if '|' in l]
        if len(lines) != 4:
            continue
        for p, line in zip(PARTS, lines):
            line = re.sub(r'^\s*\w+:\s*', '', line)
            for tok in line.replace('|', ' ').split():
                t = TOKEN.match(tok)
                if not t:
                    continue
                tied, acc, deg, octs = t.groups()
                midi = 60 + tonic + DEG[int(deg)] + (1 if acc == '#' else -1 if acc == 'b' else 0)
                midi += 12 * (octs.count("'") - octs.count(','))
                if tied and parts[p] and parts[p][-1] == midi:
                    continue
                parts[p].append(midi)
    return meta, parts


if __name__ == '__main__':
    meta, parts = parse(open(sys.argv[1]).read())
    print(meta.get('title'), meta.get('tag_id'), meta.get('original_key'))
    for p in PARTS:
        print(p, parts[p])
