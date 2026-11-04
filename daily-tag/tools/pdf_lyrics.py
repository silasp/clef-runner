#!/usr/bin/env python3
"""Read lyrics from a sheet-music PDF's embedded text and place each
syllable on its note — no OCR needed for PDFs exported from notation
software (Finale, Sibelius, MuseScore…), which keep both the lyrics and the
music-font glyphs as positioned text.

  pdf_lyrics.py SHEET.pdf [tags.json TAG_ID]

Method
* `pdftotext -bbox` gives every word with its box. Music-font glyphs are
  recognised by their characters: clefs (& V ?), noteheads (œ ˙ w), rests
  (Œ Ó ‰ ≈ ∑).
* Each clef starts a staff; every notehead/rest belongs to the staff whose
  clef is nearest vertically. Staves pair up into systems (Tenor/Lead over
  Bari/Bass), or come four to a system.
* A row of ordinary words below a staff is that staff's lyric line.
  "-" tokens join syllables of one word.
* A staff's onsets are its notehead/rest columns, left to right, system
  after system. Each syllable goes to the nearest column (left-aligned
  melisma syllables included) and so to the notes of that staff's voices
  that start there.
"""
import html, re, subprocess, sys
import xml.etree.ElementTree as ET

PARTS = ['Tenor', 'Lead', 'Bari', 'Bass']
CLEFS = set('&V?')
HEADS = set('œ˙wW')
RESTS = set('ŒÓ‰≈∑')
LABELS = {'tenor', 'lead', 'bari', 'baritone', 'bass', 'melody', 'tag', 'arr', 'arranged', 'by', 'words', 'music'}


def words(pdf, page=1):
    out = subprocess.run(['pdftotext', '-bbox', '-f', str(page), '-l', str(page), pdf, '-'],
                         capture_output=True, text=True).stdout
    out = re.sub(r'<!DOCTYPE[^>]*>', '', out)
    ws = []
    for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', out):
        x0, y0, x1, y1 = map(float, m.groups()[:4])
        t = html.unescape(m.group(5))
        ws.append({'x0': x0, 'x1': x1, 'y': (y0 + y1) / 2, 'y0': y0, 'y1': y1, 't': t})
    return ws


def is_glyph(t):
    return all(c in HEADS | RESTS | CLEFS | set('bn#x4321Ä') for c in t)


def layout(ws):
    """→ list of staves [{'y', 'cols': [x...]}] in reading order, and lyric lines [(y, [words])]."""
    clefs = sorted([w for w in ws if w['t'] in CLEFS and w['x0'] < 200], key=lambda w: w['y'])
    if len(clefs) < 2:
        return None, None
    staves = [{'y': c['y'], 'glyphs': []} for c in clefs]
    first_note_x = min((w['x0'] for w in ws if set(w['t']) <= HEADS | RESTS), default=0)
    for w in ws:
        if set(w['t']) <= HEADS | RESTS and w['t']:
            s = min(staves, key=lambda s: abs(s['y'] - w['y']))
            if abs(s['y'] - w['y']) < 45:
                s['glyphs'].append(w)
    for s in staves:
        xs = sorted((g['x0'] + g['x1']) / 2 for g in s['glyphs'] if g['x0'] >= first_note_x - 1)
        cols = []
        for x in xs:
            if cols and x - cols[-1][0] < 7.5:          # a chord's seconds sit side by side
                cols[-1].append(x)
            else:
                cols.append([x])
        s['cols'] = [sum(c) / len(c) for c in cols]
    # lyric lines: rows of plain words below a staff
    plain = [w for w in ws if not is_glyph(w['t']) and re.search(r"[A-Za-z]|^-$|^–$", w['t'])
             and w['t'] not in ('u', 'U', '>', 'j', 'J', 'c', 'C')  # music-font fermatas/accents/common time
             and re.fullmatch(r"[A-Za-z’'‘\-–,.!?;:()\"“”…]+", w['t'])
             and w['t'].strip('().,!?:;').lower() not in LABELS and w['x0'] > 100]
    rows = []
    for w in sorted(plain, key=lambda w: (round(w['y']), w['x0'])):
        if rows and abs(rows[-1][0] - w['y']) < 3:
            rows[-1][1].append(w)
        else:
            rows.append([w['y'], [w]])
    top = staves[0]['y']
    gaps = sorted(b['y'] - a['y'] for a, b in zip(staves, staves[1:])) or [80]
    near = 0.8 * gaps[len(gaps) // 2]                         # a lyric line sits close under its staff
    boiler = re.compile(r'copyright|©|rights|reserved|arrang|words|music by|www\.|\.com|used by|permission|printed', re.I)
    lyric_rows = []
    for y, r in rows:
        above = [s['y'] for s in staves if s['y'] < y]
        if not above or y - max(above) > max(near, 30):
            continue
        if boiler.search(' '.join(w['t'] for w in r)):
            continue
        lyric_rows.append((y, sorted(r, key=lambda w: w['x0'])))
    return staves, lyric_rows


def syllables(row):
    """Words of a lyric row → [(syllable, center x)], '-' joining syllables of a word."""
    out = []
    for w in row:
        t = w['t']
        if t in ('-', '–', '_'):
            if out and not out[-1][0].endswith('-'):
                out[-1] = (out[-1][0] + '-', out[-1][1])
            continue
        parts = [p for p in re.split(r'(?<=[A-Za-z’\'])-(?=[A-Za-z])', t) if p]
        width = (w['x1'] - w['x0']) / max(1, len(parts))
        for k, p in enumerate(parts):
            out.append((p + ('-' if k < len(parts) - 1 else ''), w['x0'] + width * (k + 0.5), w['x0'] + width * k))
        out[-1] = out[-1][:2]
    return [(s[0], s[1]) for s in out]


def staff_lyrics(pdf):
    """→ {'staves': [{'role': 'upper'|'lower'|part, 'cols': [...], 'syl': [(col_index, text)]}]} in reading order."""
    ws = words(pdf)
    staves, rows = layout(ws)
    if not staves:
        return None
    for s in staves:
        s['syl'] = []
    for y, row in rows:
        above = [s for s in staves if s['y'] < y]
        if not above:
            continue
        s = max(above, key=lambda s: s['y'])
        if not s['cols']:
            continue
        for text, x in syllables(row):
            # nearest column at or just left of the syllable (melisma syllables are left-aligned)
            k = min(range(len(s['cols'])), key=lambda i: abs(s['cols'][i] - x) + (0 if s['cols'][i] <= x + 4 else 6))
            s['syl'].append((k, text))
    per_system = 4 if len(staves) % 4 == 0 and len(staves) >= 4 and len(staves) % 2 == 0 and _four_per_system(staves) else 2
    for i, s in enumerate(staves):
        s['role'] = (PARTS[i % 4] if per_system == 4 else ('upper' if i % 2 == 0 else 'lower'))
    return staves


def _four_per_system(staves):
    gaps = [b['y'] - a['y'] for a, b in zip(staves, staves[1:])]
    if len(gaps) < 4:
        return False
    big = sorted(gaps)[-max(1, len(staves) // 4 - 1):] if len(staves) > 4 else []
    return bool(big) and min(big) > 1.6 * sorted(gaps)[0]


def onsets(notes):
    """Cumulative beat onsets of a part's notes (rests included)."""
    t, out = 0.0, []
    for n in notes:
        out.append(round(t, 3))
        t += float(n[3] or 0)
    return out


def apply(parts, staves):
    """Put the PDF's syllables on parts {part: notes} in place. Returns the parts touched.
    A staff with (almost) no lyric line of its own sings the other staff's words."""
    if staves[0]['role'] == 'upper':
        roles = [('upper', ['Tenor', 'Lead']), ('lower', ['Bari', 'Bass'])]
    else:
        roles = [(p, [p]) for p in PARTS]
    maps = {}
    for role, members in roles:
        sts = [s for s in staves if s['role'] == role]
        cols = sum(len(s['cols']) for s in sts)
        union = sorted({o for p in members for o in onsets(parts[p])})
        if not cols or len(union) != cols:
            continue                                      # columns and onsets don't line up: leave this staff
        m, base = {}, 0
        for s in sts:
            for k, text in s['syl']:
                m.setdefault(union[base + k], text)
            base += len(s['cols'])
        maps[role] = (m, len(union))
    if not maps:
        return []
    richest = max(maps.values(), key=lambda v: len(v[0]) / max(1, v[1]))[0]
    done = []
    for role, members in roles:
        if role not in maps:
            continue
        own, n = maps[role]
        m = own if len(own) >= 0.5 * len(richest) * n / max(1, n) and len(own) >= 0.3 * n else {**richest, **own}
        if not m:
            continue
        for p in members:
            last = None
            for nt, o in zip(parts[p], onsets(parts[p])):
                if len(nt) > 5 and 'r' in nt[5]:
                    nt[4] = ''
                    continue
                nt[4] = m.get(o, '' if last is not None else None)
                if nt[4]:
                    last = nt[4]
            done.append(p)
    return done


def lyric_text(pdf, known=''):
    """For PDFs whose notes are drawn as shapes: the sung words in order, from
    text rows that look like the tag's lyrics (≥ half their words are known
    lyric words). Hyphenated syllables are joined back into words."""
    ws = [w for w in words(pdf) if re.fullmatch(r"[A-Za-z’'‘\-–,.!?;:()\"“”…]+", w['t'])]
    vocab = set(re.findall(r"[a-z']+", known.lower()))
    rows = []
    for w in sorted(ws, key=lambda w: (round(w['y']), w['x0'])):
        if rows and abs(rows[-1][0] - w['y']) < 3:
            rows[-1][1].append(w)
        else:
            rows.append([w['y'], [w]])
    out = []
    import statistics
    heights = [statistics.median(w['y1'] - w['y0'] for w in r) for _, r in rows]
    typical = statistics.median(heights) if heights else 0
    for (y, r), h in zip(rows, heights):
        if typical and h > 1.35 * typical:                 # titles and headings are set larger
            continue
        toks = [w['t'] for w in sorted(r, key=lambda w: w['x0'])]
        plain = [re.sub(r"[^a-z']", '', t.lower()) for t in toks if t not in ('-', '–')]
        if not plain or (vocab and sum(p in vocab for p in plain) < 0.5 * len(plain)):
            continue
        line = ' '.join(toks)
        line = re.sub(r'\s*[-–]\s*', '', line)               # "heav - en" → "heaven"
        out.append(line)
    return ' '.join(out)


if __name__ == '__main__':
    st = staff_lyrics(sys.argv[1])
    if not st:
        print('no staves found'); sys.exit(1)
    for s in st:
        print(s['role'], len(s['cols']), 'columns:', ' '.join(f'{k}:{t}' for k, t in s['syl']))
    if len(sys.argv) > 3:
        import json
        t = [x for x in json.load(open(sys.argv[2]))['tags'] if str(x['id']) == sys.argv[3]][0]
        print('touched', apply(t['parts'], st))
        for p in PARTS:
            print(p, [n[4] for n in t['parts'][p]])
