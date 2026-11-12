"""A compact ABC-notation reader/writer for single-voice tune material.

Supported (the subset that fiddle-tune transcriptions actually use):
  notes, octave marks, accidentals (bar-scoped), lengths (2, /, 3/2, //),
  rests z / invisible x, broken rhythm > < >> <<, ties -, slurs ( ),
  tuplets (3 (2 (4 and (p:q:r, grace notes {..}, chords/double-stops [..],
  quoted chord symbols "A7" and annotations "^text",
  decorations ~ . H T u v and !name!, bar lines | || |] :| |: ::.
Repeat signs and endings are *ignored* – form is declared in YAML.
"""
from __future__ import annotations

from fractions import Fraction as F

from music21 import key as m21key, pitch as m21pitch

from .model import Ev
from .theory import key_signature_alters, spell

DECOS = {
    "fermata": ("orn", "fermata"), "H": ("orn", "fermata"),
    "trill": ("orn", "trill"), "T": ("orn", "trill"),
    "roll": ("orn", "roll"), "~": ("orn", "roll"), "turn": ("orn", "roll"),
    "staccato": ("art", "staccato"), ".": ("art", "staccato"),
    "accent": ("art", "accent"), ">": ("art", "accent"), "emphasis": ("art", "accent"),
    "tenuto": ("art", "tenuto"),
    "upbow": ("art", "upbow"), "u": ("art", "upbow"),
    "downbow": ("art", "downbow"), "v": ("art", "downbow"),
    "pp": ("dyn", "pp"), "p": ("dyn", "p"), "mp": ("dyn", "mp"),
    "mf": ("dyn", "mf"), "f": ("dyn", "f"), "ff": ("dyn", "ff"),
}


class ABCError(ValueError):
    pass


def _parse_len(s: str, i: int) -> tuple[F, int]:
    num = ""
    while i < len(s) and s[i].isdigit():
        num += s[i]
        i += 1
    mult = F(int(num)) if num else F(1)
    if i < len(s) and s[i] == "/":
        slashes = 0
        while i < len(s) and s[i] == "/":
            slashes += 1
            i += 1
        den = ""
        while i < len(s) and s[i].isdigit():
            den += s[i]
            i += 1
        if den:
            mult = mult / int(den) / (2 ** (slashes - 1))
        else:
            mult = mult / (2 ** slashes)
    return mult, i


def parse_abc(text: str, k: m21key.Key, unit: F = F(1, 8), strict_bars: bool = True
              ) -> list[dict]:
    """Parse ABC body text into a list of bars.

    Each bar is {'events': [Ev...], 'chords': [(off, symbol)], 'length': F}.
    `unit` is the L: field as a fraction of a whole note.
    """
    unit_ql = unit * 4
    keysig = key_signature_alters(k)
    s = text
    i = 0
    bars: list[dict] = []
    events: list[Ev] = []
    chords: list[tuple[F, str]] = []
    t = F(0)
    carry: dict[tuple[str, int], float] = {}
    pend_arts: list[str] = []
    pend_orns: list[str] = []
    pend_dyn: str | None = None
    pend_text: str | None = None
    pend_grace: list[m21pitch.Pitch] = []
    pend_slur = 0
    tuplet_left = 0
    tuplet_factor = F(1)
    broken_next = F(1)   # multiplier waiting for the next note

    def push_bar():
        nonlocal events, chords, t, carry
        if events or chords:
            bars.append({"events": events, "chords": chords, "length": t})
        events, chords, t, carry = [], [], F(0), {}

    def read_pitch(j: int) -> tuple[m21pitch.Pitch, int]:
        acc = None
        if s[j] in "^_=":
            if s.startswith("^^", j):
                acc, j = 2.0, j + 2
            elif s.startswith("__", j):
                acc, j = -2.0, j + 2
            else:
                acc, j = {"^": 1.0, "_": -1.0, "=": 0.0}[s[j]], j + 1
        letter = s[j]
        if letter.upper() not in "ABCDEFG":
            raise ABCError(f"expected note at {j}: {s[j:j+10]!r}")
        octave = 4 if letter.isupper() else 5
        j += 1
        while j < len(s) and s[j] in ",'":
            octave += 1 if s[j] == "'" else -1
            j += 1
        step = letter.upper()
        if acc is not None:
            carry[(step, octave)] = acc
            alter = acc
        else:
            alter = carry.get((step, octave), keysig[step])
        p = m21pitch.Pitch(step)
        p.octave = octave
        if alter:
            p.accidental = m21pitch.Accidental(alter)
        return p, j

    def add_event(pitches, mult, j):
        nonlocal t, pend_arts, pend_orns, pend_dyn, pend_text, pend_grace
        nonlocal pend_slur, tuplet_left, broken_next
        dur = mult * unit_ql * broken_next
        broken_next = F(1)
        # broken rhythm look-ahead
        k2 = j
        while k2 < len(s) and s[k2] == " ":
            k2 += 1
        if k2 < len(s) and s[k2] in "<>":
            n = 0
            ch = s[k2]
            while k2 < len(s) and s[k2] == ch:
                n += 1
                k2 += 1
            short = F(1, 2 ** n)
            longf = 2 - short
            if ch == ">":
                dur *= longf
                broken_next = short
            else:
                dur *= short
                broken_next = longf
            j = k2
        if tuplet_left > 0:
            dur *= tuplet_factor
            tuplet_left -= 1
        ev = Ev(off=t, dur=dur, pitches=pitches, arts=pend_arts, orns=pend_orns,
                dyn=pend_dyn, text=pend_text, grace=pend_grace)
        if pend_slur:
            ev.slur_start = True
            pend_slur -= 1
        events.append(ev)
        t += dur
        pend_arts, pend_orns, pend_dyn, pend_text, pend_grace = [], [], None, None, []
        return j

    while i < len(s):
        c = s[i]
        if c in " \t\r\n`\\":
            i += 1
        elif c == "%":
            while i < len(s) and s[i] != "\n":
                i += 1
        elif c == '"':
            j = s.index('"', i + 1)
            body = s[i + 1:j]
            if body[:1] in "^_<>@":
                pend_text = body[1:]
            else:
                chords.append((t, body))
            i = j + 1
        elif c == "!" or c == "+":
            j = s.index(c, i + 1)
            name = s[i + 1:j]
            kind = DECOS.get(name)
            if kind:
                if kind[0] == "art":
                    pend_arts.append(kind[1])
                elif kind[0] == "orn":
                    pend_orns.append(kind[1])
                else:
                    pend_dyn = kind[1]
            i = j + 1
        elif c in "~.HTuv":
            kind = DECOS[c]
            (pend_arts if kind[0] == "art" else pend_orns).append(kind[1])
            i += 1
        elif c == "{":
            j = s.index("}", i)
            body = s[i + 1:j].lstrip("/")
            jj = 0
            graces = []
            while jj < len(body):
                if body[jj] in "^_=ABCDEFGabcdefg":
                    saved_s = s
                    p, _ = _read_grace(body, jj, keysig, carry)
                    graces.append(p)
                    jj = _skip_note(body, jj)
                else:
                    jj += 1
            pend_grace = graces
            i = j + 1
        elif c == "(":
            if i + 1 < len(s) and s[i + 1].isdigit():
                j = i + 1
                p = int(s[j]); j += 1
                q = None
                r = p
                if j < len(s) and s[j] == ":":
                    j += 1
                    qs = ""
                    while j < len(s) and s[j].isdigit():
                        qs += s[j]; j += 1
                    q = int(qs) if qs else None
                    if j < len(s) and s[j] == ":":
                        j += 1
                        rs = ""
                        while j < len(s) and s[j].isdigit():
                            rs += s[j]; j += 1
                        r = int(rs) if rs else p
                if q is None:
                    q = {2: 3, 3: 2, 4: 3, 6: 2}.get(p, 2)
                tuplet_factor = F(q, p)
                tuplet_left = r
                i = j
            else:
                pend_slur += 1
                i += 1
        elif c == ")":
            if events:
                events[-1].slur_stop = True
            i += 1
        elif c == "-":
            if events:
                events[-1].tie = True
            i += 1
        elif c in "|:[]" and not (c == "[" and i + 1 < len(s) and
                                   (s[i + 1] in "^_=ABCDEFGabcdefg" or
                                    (s[i + 1].isalpha() and i + 2 < len(s) and s[i + 2] == ":"))):
            j = i
            while j < len(s) and s[j] in "|:[]":
                j += 1
            if j < len(s) and s[j].isdigit() and "|" in s[i:j] or (s[i:j] == "[" and j < len(s) and s[j].isdigit()):
                raise ABCError("endings ([1 / |2) are not supported – declare variants in YAML")
            if "|" in s[i:j] or "::" in s[i:j]:
                push_bar()
            i = j
        elif c == "[" and s[i + 1].isalpha() and s[i + 2] == ":":
            j = s.index("]", i)
            field_ = s[i + 1:j]
            if field_.startswith("K:"):
                from .theory import parse_key
                keysig = key_signature_alters(parse_key(field_[2:]))
            i = j + 1
        elif c == "[":
            j = i + 1
            pitches = []
            first_mult = None
            while s[j] != "]":
                if s[j] in " ":
                    j += 1
                    continue
                p, j = read_pitch(j)
                m, j = _parse_len(s, j)
                if j < len(s) and s[j] == "-":
                    j += 1
                pitches.append(p)
                if first_mult is None:
                    first_mult = m
            j += 1
            mult, j = _parse_len(s, j)
            j = add_event(pitches, (first_mult or F(1)) * mult, j)
            i = j
        elif c in "zx":
            mult, j = _parse_len(s, i + 1)
            hidden = c == "x"
            j = add_event([], mult, j)
            events[-1].hidden = hidden
            i = j
        elif c in "^_=ABCDEFGabcdefg":
            p, j = read_pitch(i)
            mult, j = _parse_len(s, j)
            i = add_event([p], mult, j)
        else:
            raise ABCError(f"unexpected {c!r} at {i}: …{s[max(0,i-10):i+10]!r}…")
    push_bar()
    return bars


def _skip_note(body: str, j: int) -> int:
    while j < len(body) and body[j] in "^_=":
        j += 1
    j += 1
    while j < len(body) and (body[j] in ",'/" or body[j].isdigit()):
        j += 1
    return j


def _read_grace(body, j, keysig, carry):
    acc = None
    while body[j] in "^_=":
        acc = (acc or 0) + {"^": 1.0, "_": -1.0, "=": 0.0}[body[j]]
        j += 1
    letter = body[j]
    octave = 4 if letter.isupper() else 5
    j += 1
    while j < len(body) and body[j] in ",'":
        octave += 1 if body[j] == "'" else -1
        j += 1
    step = letter.upper()
    alter = acc if acc is not None else carry.get((step, octave), keysig[step])
    p = m21pitch.Pitch(step)
    p.octave = octave
    if alter:
        p.accidental = m21pitch.Accidental(alter)
    return p, j


# ------------------------------------------------------------------ writer --

def _abc_pitch(p: m21pitch.Pitch, keysig: dict, carry: dict) -> str:
    step = p.step
    octave = p.octave
    alter = p.accidental.alter if p.accidental is not None else 0.0
    expected = carry.get((step, octave), keysig[step])
    acc = ""
    if alter != expected:
        acc = {2.0: "^^", 1.0: "^", 0.0: "=", -1.0: "_", -2.0: "__"}[alter]
        carry[(step, octave)] = alter
    if octave >= 5:
        name = step.lower() + "'" * (octave - 5)
    else:
        name = step + "," * (4 - octave)
    return acc + name


def _abc_len(ql: F, unit_ql: F) -> str:
    m = F(ql) / unit_ql
    if m == 1:
        return ""
    if m.denominator == 1:
        return str(m.numerator)
    if m.numerator == 1:
        return "/" * {2: 1, 4: 2}.get(m.denominator, 0) or f"/{m.denominator}"
    return f"{m.numerator}/{m.denominator}"


def events_to_abc(bars: list[list[Ev]], k: m21key.Key, unit: F = F(1, 8)) -> str:
    """Write bars of events back to ABC (used to 'freeze' generated parts so
    they can be hand-edited)."""
    unit_ql = unit * 4
    keysig = key_signature_alters(k)
    out = []
    for evs in bars:
        carry: dict = {}
        toks = []
        idx = 0
        while idx < len(evs):
            e = evs[idx]
            dur = e.dur
            prefix = ""
            # simple triplet detection
            if dur.denominator % 3 == 0 and idx + 2 < len(evs) and \
                    evs[idx + 1].dur == dur and evs[idx + 2].dur == dur:
                prefix = "(3"
                group = evs[idx:idx + 3]
                parts = []
                for g in group:
                    parts.append(_tok(g, g.dur * F(3, 2), keysig, carry, unit_ql))
                toks.append(prefix + "".join(parts))
                idx += 3
                continue
            toks.append(_tok(e, dur, keysig, carry, unit_ql))
            idx += 1
        out.append(" ".join(toks))
    return " | ".join(out) + " |"


def _tok(e: Ev, dur: F, keysig, carry, unit_ql) -> str:
    deco = ""
    if "roll" in e.orns:
        deco += "~"
    if "fermata" in e.orns:
        deco += "H"
    if "staccato" in e.arts:
        deco += "."
    if e.is_rest:
        body = ("x" if e.hidden else "z")
    elif len(e.pitches) == 1:
        body = _abc_pitch(e.pitches[0], keysig, carry)
    else:
        body = "[" + "".join(_abc_pitch(p, keysig, carry) for p in e.pitches) + "]"
    return deco + body + _abc_len(dur, unit_ql) + ("-" if e.tie else "")
