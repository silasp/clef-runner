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


def staff_lyrics_text(pdf):
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


def align_columns(sts, union, skip=0.06):
    """Map note columns (staff lines in reading order) to onsets. Equal counts map
    one-to-one; otherwise a DP aligns their positions (fraction of the way through
    the piece), allowing extra or missing columns. None if they clearly don't fit."""
    cols = [(si, k) for si, st in enumerate(sts) for k in range(len(st['cols']))]
    if len(cols) == len(union):
        return {c: o for c, o in zip(cols, union)}
    if abs(len(cols) - len(union)) > max(3, 0.25 * len(union)):
        return None
    total = union[-1] - union[0] or 1.0
    # columns: position by staff line and x within it; onsets: position in beats
    pc = []
    for si, st in enumerate(sts):
        x0 = min(st['cols']) if st['cols'] else 0
        x1 = max(st['cols']) if st['cols'] else 1
        for k, x in enumerate(st['cols']):
            pc.append((si + (x - x0) / max(1e-6, x1 - x0) * 0.98) / len(sts))
    po = [(o - union[0]) / total for o in union]
    n, m = len(pc), len(po)
    import numpy as _np
    D = _np.full((n + 1, m + 1), _np.inf); D[0, :] = _np.arange(m + 1) * skip; D[:, 0] = _np.arange(n + 1) * skip
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j - 1] + abs(pc[i - 1] - po[j - 1]), D[i - 1, j] + skip, D[i, j - 1] + skip)
    out, i, j = {}, n, m
    while i > 0 and j > 0:
        if abs(D[i, j] - (D[i - 1, j - 1] + abs(pc[i - 1] - po[j - 1]))) < 1e-9:
            out[cols[i - 1]] = union[j - 1]; i -= 1; j -= 1
        elif abs(D[i, j] - (D[i - 1, j] + skip)) < 1e-9:
            i -= 1
        else:
            j -= 1
    return out


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
        notes_only = staves[0].get('notes_only')
        union = sorted({o for p in members for n, o in zip(parts[p], onsets(parts[p]))
                        if not (notes_only and len(n) > 5 and 'r' in n[5])})
        if not cols or not union:
            continue
        colmap = align_columns(sts, union)
        if colmap is None:
            continue                                      # columns and onsets don't line up: leave this staff
        m = {}
        for si, st in enumerate(sts):
            for k, text in st['syl']:
                o = colmap.get((si, k))
                if o is not None:
                    m.setdefault(o, text)
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


# ---------------------------------------------------------------- font-independent reader
MUSIC_FONT = re.compile(r'maestro|opus|capella|mscore|bravura|petrucci|jazz|sonata|engraver|leland|emmentaler|feta|'
                        r'november|norfolk|fughetta|helsinki|reprise|inkpen|broadway|tamburo|anastasia|musical|'
                        r'finale ?(?!lyric)|sibelius|musescore|lassus|toccata|bach|golden', re.I)
LYRIC_CHARS = re.compile(r"[A-Za-z’'‘\-–,.!?;:()\"“”…]+")


def _staves(page):
    """Five evenly spaced long horizontal lines → staves [{'top','bottom','sp','x0','x1'}]."""
    ys = {}
    for d in page.get_drawings():
        for it in d['items']:
            if it[0] == 'l':
                a, b = it[1], it[2]
                if abs(a.y - b.y) < 0.4 and abs(b.x - a.x) > 30:
                    ys.setdefault(round((a.y + b.y) / 2, 1), []).append((min(a.x, b.x), max(a.x, b.x)))
            elif it[0] == 're':
                r = it[1]
                if r.height < 1.3 and r.width > 30:
                    ys.setdefault(round(r.y0 + r.height / 2, 1), []).append((r.x0, r.x1))
    lines = sorted((y, min(v[0] for v in segs), max(v[1] for v in segs)) for y, segs in ys.items()
                   if sum(v[1] - v[0] for v in segs) > 120)
    staves, i = [], 0
    while i + 4 < len(lines):
        grp = lines[i:i + 5]
        gaps = [b[0] - a[0] for a, b in zip(grp, grp[1:])]
        if 2.5 < min(gaps) and max(gaps) - min(gaps) < 0.8 and max(gaps) < 14:
            staves.append({'top': grp[0][0], 'bottom': grp[-1][0], 'sp': sum(gaps) / 4,
                           'x0': min(g[1] for g in grp), 'x1': max(g[2] for g in grp)})
            i += 5
        else:
            i += 1
    return staves


def _noteheads(page, staves):
    """Notehead x positions per staff: music-font glyphs about a notehead wide that occur at
    several heights, plus small filled shapes the size of a notehead (notes drawn as paths)."""
    raw = page.get_text('rawdict')
    spans = [sp for b in raw['blocks'] for l in b.get('lines', []) for sp in l['spans']]
    # a font is a music font by name, or by content (mostly music symbols / private-use codes)
    SYM = set('œ˙wW&?Vbn#ŒÓ‰≈∑jJ>Uu.ÏÚú') | set('\uf000')
    per_font = {}
    for sp in spans:
        f = per_font.setdefault(sp['font'], [0, 0])
        for c in sp['chars']:
            f[1] += 1
            f[0] += c['c'] in SYM or 0xE000 <= ord(c['c']) <= 0xF8FF
    music_fonts = {f for f, (sym, n) in per_font.items()
                   if (MUSIC_FONT.search(f) and 'lyric' not in f.lower()) or (n and sym / n >= 0.6)}
    music = [sp for sp in spans if sp['font'] in music_fonts]
    by_code = {}
    for sp in music:
        for c in sp['chars']:
            x0, _, x1, _ = c['bbox']
            by_code.setdefault(c['c'], []).append(((x0 + x1) / 2, c['origin'][1], x1 - x0))
    heads = [[] for _ in staves]
    def staff_of(y):
        for k, st in enumerate(staves):
            if st['top'] - 4 * st['sp'] <= y <= st['bottom'] + 4 * st['sp']:
                return k
        return None
    for code, occ in by_code.items():
        ks = [staff_of(y) for _, y, _ in occ]
        occ = [(x, y, w, k) for (x, y, w), k in zip(occ, ks) if k is not None]
        if not occ:
            continue
        sp_ = staves[occ[0][3]]['sp']
        wid = sorted(w for _, _, w, _ in occ)[len(occ) // 2] / sp_
        heights = len({round(y / (sp_ / 2)) for _, y, _, _ in occ})
        if 1.0 <= wid <= 1.9 and heights >= 3 and code.strip() and not code.isdigit():
            for x, y, w, k in occ:
                heads[k].append(x)
    for d in page.get_drawings():              # notes drawn as shapes (e.g. MuseScore PDFs)
        if not d.get('fill'):
            continue
        r = d['rect']
        k = staff_of((r.y0 + r.y1) / 2)
        if k is None:
            continue
        sp_ = staves[k]['sp']
        if 1.0 <= r.width / sp_ <= 1.7 and 0.6 <= r.height / sp_ <= 1.2:
            heads[k].append((r.x0 + r.x1) / 2)
    return heads, music


def _systems(staves):
    if len(staves) < 2:
        return []
    gaps = [b['top'] - a['bottom'] for a, b in zip(staves, staves[1:])]
    lo, hi = min(gaps), max(gaps)
    cut = (lo + hi) / 2 if hi > 1.3 * lo else hi + 1
    systems, cur = [], [0]
    for i, g in enumerate(gaps):
        if g > cut:
            systems.append(cur); cur = []
        cur.append(i + 1)
    systems.append(cur)
    return systems


def staff_lyrics(pdf):
    """Font-independent: staves from staff lines, notes from note-sized glyphs or shapes,
    lyric lines from the words under each staff. Falls back to the text-glyph reader."""
    try:
        import fitz
    except ImportError:
        return staff_lyrics_text(pdf)
    try:
        page = fitz.open(pdf)[0]
    except Exception:  # noqa: BLE001
        return None
    staves = _staves(page)
    systems = _systems(staves)
    if not staves or not systems or any(len(s) not in (2, 4) for s in systems):
        return staff_lyrics_text(pdf)
    heads, music = _noteheads(page, staves)
    for st, xs in zip(staves, heads):
        cols = []
        for x in sorted(xs):
            if cols and x - cols[-1][0] < 1.6 * st['sp']:     # a chord's seconds sit side by side
                cols[-1].append(x)
            else:
                cols.append([x])
        st['cols'] = [sum(c) / len(c) for c in cols]
        st['syl'] = []
        st['y'] = st['top']
    # lyric words: text (not music glyphs) in rows under a staff
    mboxes = [c['bbox'] for sp in music for c in sp['chars']]
    words_ = []
    for x0, y0, x1, y1, w, *_ in page.get_text('words'):
        if not LYRIC_CHARS.fullmatch(w) or (len(w) == 1 and w not in 'aAIoO'):
            continue
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if any(b[0] <= cx <= b[2] and b[1] <= cy <= b[3] and (b[3] - b[1]) > 3 * (y1 - y0) for b in mboxes[:0]):
            continue
        if w.strip('().,!?:;').lower() in LABELS and staves and x1 < min(s['x0'] for s in staves) + 15:
            continue                                          # part names in the margin, not lyrics
        words_.append({'x0': x0, 'x1': x1, 'y': (y0 + y1) / 2, 'y0': y0, 'y1': y1, 't': w})
    rows = []
    for w in sorted(words_, key=lambda w: (round(w['y']), w['x0'])):
        if rows and abs(rows[-1][0] - w['y']) < 3:
            rows[-1][1].append(w)
        else:
            rows.append([w['y'], [w]])
    boiler = re.compile(r'copyright|©|rights|reserved|arrang|words|music by|www\.|\.com|used by|permission|printed', re.I)
    for y, r in rows:
        above = [st for st in staves if st['bottom'] < y]
        if not above:
            continue
        st = max(above, key=lambda s: s['bottom'])
        if y - st['bottom'] > 9 * st['sp'] or boiler.search(' '.join(w['t'] for w in r)) or not st['cols']:
            continue
        nxt = [s for s in staves if s['top'] > st['bottom']]
        if nxt and y > min(s['top'] for s in nxt):
            continue
        for text, x in syllables(sorted(r, key=lambda w: w['x0'])):
            k = min(range(len(st['cols'])), key=lambda i: abs(st['cols'][i] - x) + (0 if st['cols'][i] <= x + 4 else 6))
            st['syl'].append((k, text))
    order = [i for sysm in systems for i in sysm]
    out = []
    for sysm in systems:
        for j, i in enumerate(sysm):
            st = staves[i]
            st['role'] = ('upper' if j == 0 else 'lower') if len(sysm) == 2 else PARTS[j]
            out.append(st)
    st0 = out
    st0[0]['notes_only'] = True
    return st0


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
