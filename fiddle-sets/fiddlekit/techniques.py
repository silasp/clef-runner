"""Arranging techniques.

Each technique fills `bar.out[voice]` for a run of consecutive bars that share
one TechSpec. They read the *source melody* (bar.melody), the chord grid
(bar.chords), the key/meter and the instrument, so the same techniques work
for any tune, any voice and (later) any string instrument.

Techniques
----------
melody      play the tune
unison      double the tune (optionally an octave lower where it fits)
harmony     a parallel harmony line (3rds/6ths) below (or `above: true`) the
            tune, chosen by dynamic programming over chord tones, metric
            weight, voice-leading and two-voice counterpoint rules. `density`
            (melody|beat|half|bar) thins the rhythm for easier playing.
counter     a slower counter-melody built from guide tones (3rds/7ths) with
            stepwise voice-leading and contrary motion; where the tune holds a
            long note it answers with a fill – an *echo* of the tune's last
            motif or a *scale* run into the next chord.
drone       open-string drones / double stops, sustained or pulsed, that
            follow the harmony when the drone would clash.
vamp        rhythmic backing: bass note + double-stop chord on the off-beats,
            with meter-specific patterns (waltz, polka, reel, jig, slip jig).
rest        tacet.
abc         hand-written ABC for this voice (one string, bars separated by |).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from fractions import Fraction as F

from .abc import parse_abc
from .instruments import Instrument, best_double_stop
from .model import Bar, Ev, TechSpec
from .theory import (DISSONANT, PERFECT, Chord, candidates, chord, diatonic_step,
                     meter_info, scale_pcs, spell, strength)

INF = float("inf")


# ------------------------------------------------------------ utilities ----

@dataclass
class MelNote:
    abs: F
    dur: F
    midi: int | None
    ev: Ev
    bar_i: int
    off: F

    @property
    def end(self):
        return self.abs + self.dur


@dataclass
class Slot:
    bar_i: int
    off: F
    dur: F
    abs: F
    m: int | None                       # melody pitch at onset (primary)
    mel: list[tuple[int, F, float]]     # (midi, overlap, onset strength or -1 if held)
    ch: Chord
    st: float
    tie_from_prev: bool = False
    src: Ev | None = None
    phrase_end: bool = False
    fill: bool = False
    fill_start: F | None = None         # bar offset where a fill begins


def bar_starts(bars: list[Bar]) -> list[F]:
    out, t = [], F(0)
    for b in bars:
        out.append(t)
        t += b.length
    return out


def melody_notes(bars: list[Bar]) -> list[MelNote]:
    out = []
    starts = bar_starts(bars)
    for i, (b, s) in enumerate(zip(bars, starts)):
        for e in b.melody:
            out.append(MelNote(s + e.off, e.dur, e.midi, e, i, e.off))
    return out


def chord_of(bar: Bar, off: F) -> Chord:
    c = bar.chord_at(off)
    if c is None:
        return chord(bar.key.tonic.name.replace("-", "b") + ("m" if bar.key.mode in ("minor", "dorian", "phrygian") else ""))
    return chord(c.symbol)


def overlaps(mel: list[MelNote], a: F, b: F, bars: list[Bar]) -> list[tuple[int, F, float]]:
    res = []
    for n in mel:
        if n.midi is None or n.end <= a or n.abs >= b:
            continue
        ov = min(b, n.end) - max(a, n.abs)
        st = strength(n.off, bars[n.bar_i].meter) if n.abs >= a else -1.0
        res.append((n.midi, ov, st))
    return res


def sounding_at(mel: list[MelNote], t: F) -> MelNote | None:
    for n in mel:
        if n.abs <= t < n.end:
            return n
    return None


def leap_cost(a: int, b: int, table: dict[int, float], big: float) -> float:
    d = abs(a - b)
    return table.get(d, big)


def viterbi(slots: list[Slot], cands: list[list[int]], local, trans, prev: int | None
            ) -> list[int | None]:
    """Generic Viterbi. slots with no candidates break the chain (rest)."""
    result: list[int | None] = [None] * len(slots)
    i = 0
    while i < len(slots):
        if not cands[i]:
            i += 1
            continue
        j = i
        while j < len(slots) and cands[j]:
            j += 1
        # chain i..j-1
        costs = [{} for _ in range(i, j)]
        back = [{} for _ in range(i, j)]
        for c in cands[i]:
            lc = local(i, c)
            if prev is not None and i > 0 and slots[i - 1].m is not None:
                lc += trans(i, prev, c) * 0.5
            elif prev is not None:
                lc += 0.05 * abs(c - prev)
            costs[0][c] = lc
        for k in range(i + 1, j):
            for c in cands[k]:
                lc = local(k, c)
                if lc == INF:
                    continue
                best, arg = INF, None
                for p, pc in costs[k - 1 - i].items():
                    if pc == INF:
                        continue
                    tc = pc + trans(k, p, c)
                    if tc < best:
                        best, arg = tc, p
                costs[k - i][c] = best + lc
                back[k - i][c] = arg
        # backtrack
        last = min(costs[-1], key=lambda c: costs[-1][c])
        path = [last]
        for k in range(j - 1, i, -1):
            path.append(back[k - i][path[-1]])
        path.reverse()
        for k, c in zip(range(i, j), path):
            result[k] = c
        prev = path[-1]
        i = j
    return result


# --------------------------------------------------------- slot builders ---

def slots_from_melody(bars: list[Bar], mel: list[MelNote]) -> list[Slot]:
    slots = []
    prev_tie = False
    for n in mel:
        b = bars[n.bar_i]
        if n.midi is None:
            slots.append(Slot(n.bar_i, n.off, n.dur, n.abs, None, [], chord_of(b, n.off),
                              strength(n.off, b.meter), src=n.ev))
            prev_tie = False
            continue
        s = Slot(n.bar_i, n.off, n.dur, n.abs, n.midi, [(n.midi, n.dur, strength(n.off, b.meter))],
                 chord_of(b, n.off), strength(n.off, b.meter), tie_from_prev=prev_tie, src=n.ev)
        prev_tie = n.ev.tie
        slots.append(s)
    return slots


def slots_from_grid(bars: list[Bar], mel: list[MelNote], unit: str) -> list[Slot]:
    """Slots on a beat / half-beat / bar grid, merged across held notes."""
    starts = bar_starts(bars)
    slots: list[Slot] = []
    for i, b in enumerate(bars):
        barlen, beat, sub = meter_info(b.meter)
        step = {"beat": beat, "half": sub, "bar": barlen}[unit]
        if unit == "bar" and barlen / beat >= 4:
            step = barlen / 2
        pts = set()
        t = F(0)
        while t < b.length:
            pts.add(t)
            t += step
        for c in b.chords:
            if c.off < b.length:
                pts.add(c.off)
        pts = sorted(pts) + [b.length]
        for a, z in zip(pts, pts[1:]):
            A, Z = starts[i] + a, starts[i] + z
            ov = overlaps(mel, A, Z, bars)
            sn = sounding_at(mel, A)
            m = sn.midi if sn is not None else None
            if m is None:
                onsets = [x for x in ov if x[2] >= 0]
                m = onsets[0][0] if onsets else None
            s = Slot(i, a, z - a, A, m, ov, chord_of(b, a), strength(a, b.meter))
            # merge with previous slot if melody simply holds and chord is unchanged
            if slots and sn is not None and sn.abs < A and slots[-1].bar_i == i and \
                    slots[-1].ch.symbol == s.ch.symbol and slots[-1].m == m and \
                    not any(x[2] >= 0 for x in ov):
                slots[-1].dur += s.dur
                slots[-1].mel += ov
                continue
            slots.append(s)
    return slots


def mark_phrase_ends(slots: list[Slot], bars: list[Bar]):
    for s in slots:
        b = bars[s.bar_i]
        if b.phrase_end and s.st >= 2:
            s.phrase_end = True


# --------------------------------------------------------------- harmony ---

HARM_LEAP = {0: 0.15, 1: 0, 2: 0, 3: 0.25, 4: 0.25, 5: 0.6, 6: 1.4, 7: 0.9, 8: 1.5, 9: 1.5,
             10: 2.0, 11: 2.5, 12: 2.0}


def gen_harmony(bars, voice, inst: Instrument, spec: TechSpec, ctx):
    above = spec.get("above", False)
    density = spec.get("density", "melody")
    max_gap = spec.get("max_gap", 16)
    mel = melody_notes(bars)
    slots = slots_from_melody(bars, mel) if density == "melody" else slots_from_grid(bars, mel, density)
    mark_phrase_ends(slots, bars)
    top = inst.comfort_high + spec.get("stretch", 0)
    cands = []
    for s in slots:
        b = bars[s.bar_i]
        if s.m is None:
            cands.append([])
            continue
        if above:
            lo, hi = s.m + 1, min(s.m + max_gap, top)
        else:
            lo, hi = max(inst.low, s.m - max_gap), min(s.m - 1, top)
            if spec.get("allow_unison", True):
                hi = min(s.m, top)
        cs = candidates(lo, hi, b.key, s.ch)
        # 'flip': when the tune dips too low (or climbs too high) to harmonise
        # on the usual side, allow a 3rd/6th on the other side, at a cost.
        if spec.get("flip", True):
            if above:
                flo, fhi = max(inst.low, s.m - 9), s.m - 3
            else:
                flo, fhi = s.m + 3, min(s.m + 9, top)
            cs += [c for c in candidates(flo, fhi, b.key, s.ch) if c not in cs]
        if not cs:  # nothing fits: fall back to unison
            cs = [s.m] if inst.low <= s.m <= inst.max_high else []
        cands.append(cs)

    prefer6 = spec.get("prefer", None)  # 'thirds' / 'sixths' bias

    def local(i, c):
        s = slots[i]
        m = s.m
        iv = abs(m - c)
        ic = iv % 12
        cost = 0.0
        heavy = s.st >= 2 or s.dur >= meter_info(bars[s.bar_i].meter)[1]
        if ic in (3, 4):
            cost += 0.0 if iv < 12 else 0.4
            if prefer6 == "sixths":
                cost += 0.3
        elif ic in (8, 9):
            cost += 0.1
            if prefer6 == "thirds":
                cost += 0.3
        elif ic == 5:
            cost += 1.2
        elif ic == 7:
            cost += 1.0
        elif ic == 0:
            cost += 0.4 if (s.phrase_end and c % 12 == s.ch.root) else 2.2
        elif ic == 6:
            gt = s.ch.guide_tones
            cost += 0.3 if (s.ch.is_dom7 and m % 12 in gt and c % 12 in gt) else 2.0
        else:  # seconds / sevenths
            cost += 4.0 if heavy else 1.8
        for mm, ov, st in s.mel[1:]:
            if (mm - c) % 12 in DISSONANT:
                cost += 1.5 * float(ov / s.dur) * (1.0 if st >= 1 else 0.5)
        deg = s.ch.degree_of(c % 12)
        if deg is None:
            cost += 2.5 if heavy else 0.5
        elif deg in ("third", "seventh"):
            cost -= 0.4
        if c > inst.first_position_top:
            cost += 1.5
        if (c > m) != above and c != m:
            cost += 1.6       # flipped to the other side of the tune
        return cost

    def trans(i, p, c):
        s, sp = slots[i], slots[i - 1]
        if s.tie_from_prev and c != p:
            return INF
        if sp.m is None:
            return 0.05 * abs(c - p)
        cost = HARM_LEAP.get(abs(c - p), 4.0)
        if c == p and s.m == sp.m:
            cost = 0
        ivp, ivc = (sp.m - p) % 12, (s.m - c) % 12
        if ivp == ivc and ivc in PERFECT and c != p and s.m != sp.m:
            cost += 4.0
        if ivc in PERFECT and (c - p) * (s.m - sp.m) > 0 and abs(c - p) > 2 and s.st >= 2:
            cost += 0.8
        if {ivp, ivc} <= {3, 4} or {ivp, ivc} <= {8, 9}:
            cost -= 0.25
        if (c > s.m) != (p > sp.m) and c != s.m and p != sp.m:
            cost += 0.8       # crossing over/under the tune mid-phrase
        return cost

    path = viterbi(slots, cands, local, trans, ctx.get("prev"))
    _emit(bars, voice, slots, path, density == "melody", "harmony-above" if above else "harmony")
    return path


def _emit(bars, voice, slots, path, copy_rhythm, src):
    per_bar: dict[int, list[Ev]] = {i: [] for i in range(len(bars))}
    for s, c in zip(slots, path):
        b = bars[s.bar_i]
        if c is None:
            e = Ev(s.off, s.dur, [], src=src)
        else:
            p = spell(c, b.key, s.ch)
            if copy_rhythm and s.src is not None:
                e = s.src.clone(pitches=[p], grace=[], orns=[o for o in s.src.orns if o == "fermata"],
                                text=None, dyn=None, src=src)
                e.arts = [a for a in e.arts if a in ("staccato", "tenuto", "accent")]
            else:
                e = Ev(s.off, s.dur, [p], src=src)
        per_bar[s.bar_i].append(e)
    for i, b in enumerate(bars):
        evs = per_bar[i]
        if not evs:
            evs = [Ev(F(0), b.length, [], src=src)]
        b.out[voice] = _fill_gaps(evs, b.length)
        # ties: join identical consecutive pitches across a held melody note
    return per_bar


def _fill_gaps(evs: list[Ev], length: F) -> list[Ev]:
    evs = sorted(evs, key=lambda e: e.off)
    out, t = [], F(0)
    for e in evs:
        if e.off > t:
            out.append(Ev(t, e.off - t, []))
        out.append(e)
        t = e.end
    if t < length:
        out.append(Ev(t, length - t, []))
    return out


# --------------------------------------------------------------- counter ---

COUNTER_LEAP = {0: 0.5, 1: -0.1, 2: -0.1, 3: 0.4, 4: 0.4, 5: 1.0, 6: 2.5, 7: 1.4,
                8: 2.5, 9: 2.5, 10: 3.0, 11: 4.0, 12: 2.5}


def counter_slots(bars, mel, rhythm):
    if rhythm in ("beat", "half"):
        slots = slots_from_grid(bars, mel, rhythm)
    else:
        starts = bar_starts(bars)
        slots = []
        for i, b in enumerate(bars):
            barlen, beat, sub = meter_info(b.meter)
            pts = {F(0)} | {c.off for c in b.chords if c.off < b.length}
            nbeats = barlen / beat
            if rhythm == "auto" and nbeats >= 4 and b.length == barlen:
                pts.add(barlen / 2)
            if rhythm == "auto" and nbeats == 2 and barlen <= 2 and False:
                pass
            pts = sorted(p for p in pts if p < b.length) + [b.length]
            for a, z in zip(pts, pts[1:]):
                A, Z = starts[i] + a, starts[i] + z
                ov = overlaps(mel, A, Z, bars)
                sn = sounding_at(mel, A)
                m = sn.midi if sn is not None else None
                if m is None:
                    on = [x for x in ov if x[2] >= 0]
                    m = on[0][0] if on else None
                slots.append(Slot(i, a, z - a, A, m, ov, chord_of(b, a), strength(a, b.meter)))
    return slots


# a walking line: steps are rewarded, repeats and skips cost
WALK_LEAP = {0: 0.9, 1: -0.4, 2: -0.4, 3: 0.5, 4: 0.5, 5: 1.2, 6: 2.5, 7: 1.5,
             8: 2.5, 9: 2.5, 10: 3.0, 11: 4.0, 12: 2.5}


def gen_counter(bars, voice, inst: Instrument, spec: TechSpec, ctx):
    rhythm = spec.get("rhythm", "auto")
    fills = spec.get("fills", "echo")      # echo | scale | none
    mel = melody_notes(bars)
    mm = [n.midi for n in mel if n.midi is not None]
    avg = sum(mm) / len(mm) if mm else inst.low + 17
    lo_lim = _pitch_param(spec.get("low"), inst.low)
    hi_lim = _pitch_param(spec.get("high"), min(inst.comfort_high, int(avg) + 2))
    # sit roughly a sixth under the tune's average pitch
    center = _pitch_param(spec.get("center"), max(inst.low + 7, int(avg) - 9))
    slots = counter_slots(bars, mel, rhythm)
    mark_phrase_ends(slots, bars)
    if fills != "none":
        _mark_fills(slots, bars, mel, every=spec.get("fill_every", 1))
    cands = []
    for s in slots:
        b = bars[s.bar_i]
        if s.m is None and not s.mel:
            # melody rests: counter may still sound (answer phrase)
            cs = candidates(lo_lim, hi_lim, b.key, s.ch, chord_only=True)
            cands.append(cs)
            continue
        heavy = [mm for mm, ov, st in s.mel if st >= 2 or st == -1 or ov >= meter_info(b.meter)[1] / 2]
        ceiling = min(heavy + [s.m]) - 1 if (heavy or s.m) else hi_lim
        hi = min(hi_lim, ceiling)
        moving = rhythm in ("beat", "half") and s.st < 3
        cs = candidates(lo_lim, hi, b.key, s.ch, chord_only=not moving)
        if not cs:
            cs = candidates(lo_lim, hi, b.key, s.ch)
        cands.append(cs)
    moving_line = rhythm in ("beat", "half")

    def local(i, c):
        s = slots[i]
        deg = s.ch.degree_of(c % 12)
        nct = (0.5 if s.st < 3 else 1.8) if moving_line else (1.0 if s.st < 2 else 1.6)
        cost = {"third": -0.6, "seventh": -0.8, "root": 0.0, "fifth": 0.3, "other": 0.2,
                None: nct}[deg]
        for mm, ov, st in s.mel:
            ic = (mm - c) % 12
            w = float(ov / s.dur)
            if ic in DISSONANT:
                cost += 2.5 * w * (1.5 if st >= 2 else 0.6 if st >= 1 else 0.3 if st >= 0 else 1.0)
            elif ic == 6 and not (s.ch.is_dom7 and {mm % 12, c % 12} <= s.ch.guide_tones):
                cost += 0.8 * w
            elif ic == 0:
                cost += 0.4 * w
        if s.m is not None:
            d = s.m - c
            if d < 3:
                cost += 1.2
            if d > 15:
                cost += 0.1 * (d - 15)
        cost += 0.03 * abs(c - center)
        return cost

    def trans(i, p, c):
        s, sp = slots[i], slots[i - 1]
        cost = (WALK_LEAP if moving_line else COUNTER_LEAP).get(abs(c - p), 6.0)
        if moving_line:
            # non-chord tones must be approached and left by step
            if s.ch.degree_of(c % 12) is None and abs(c - p) > 2:
                cost += 3.0
            if sp.ch.degree_of(p % 12) is None and abs(c - p) > 2:
                cost += 3.0
        if s.m is not None and sp.m is not None:
            ivp, ivc = (sp.m - p) % 12, (s.m - c) % 12
            if ivp == ivc and ivc in PERFECT and c != p and s.m != sp.m:
                cost += 3.0
            dm, dc = s.m - sp.m, c - p
            if dm * dc < 0:
                cost -= 0.3
        return cost

    path = viterbi(slots, cands, local, trans, ctx.get("prev"))
    per_bar = {i: [] for i in range(len(bars))}
    for k, (s, c) in enumerate(zip(slots, path)):
        b = bars[s.bar_i]
        if c is None:
            per_bar[s.bar_i].append(Ev(s.off, s.dur, [], src="counter"))
            continue
        nxt = next((path[j] for j in range(k + 1, len(path)) if path[j] is not None), None)
        if nxt is None and ctx.get("next_target") is not None:
            nxt = ctx["next_target"]
        if s.fill and fills != "none":
            evs = _realize_fill(s, c, nxt, bars, mel, inst, fills, lo_lim, hi_lim)
            per_bar[s.bar_i].extend(evs)
        else:
            per_bar[s.bar_i].append(Ev(s.off, s.dur, [spell(c, b.key, s.ch)], src="counter"))
    for i, b in enumerate(bars):
        b.out[voice] = _merge_ties(_fill_gaps(per_bar[i], b.length))
    return path


def _merge_ties(evs):
    return evs


def _pitch_param(v, default):
    if v is None:
        return default
    if isinstance(v, int):
        return v
    from music21 import pitch as m21pitch
    return m21pitch.Pitch(v).midi


def _mark_fills(slots, bars, mel, every=1):
    last_fill = -99
    for k, s in enumerate(slots):
        b = bars[s.bar_i]
        barlen, beat, sub = meter_info(b.meter)
        if s.dur < 2 * beat and not (beat == F(3, 2) and s.dur >= 2 * beat):
            continue
        tail_start = s.abs + beat
        tail_end = s.abs + s.dur
        onsets = [n for n in mel if n.midi is not None and tail_start <= n.abs < tail_end]
        if onsets:
            continue
        if k - last_fill <= every:
            continue
        s.fill = True
        s.fill_start = s.off + beat
        last_fill = k


def _realize_fill(s: Slot, c: int, target: int | None, bars, mel, inst, mode, lo, hi) -> list[Ev]:
    b = bars[s.bar_i]
    barlen, beat, sub = meter_info(b.meter)
    head = s.fill_start - s.off
    tail = s.dur - head
    held = sounding_at(mel, s.abs + head)
    ceiling = (held.midi - 1) if (held is not None and held.midi is not None) else hi
    out = [Ev(s.off, head, [spell(c, b.key, s.ch)], src="counter")]
    target = c if target is None else target
    fig = None
    if mode == "echo":
        fig = _echo_figure(s, c, target, bars, mel, tail, ceiling, lo)
    if fig is None:
        fig = _scale_figure(s, c, target, bars, tail, sub, ceiling, lo)
    t = s.fill_start
    for midi, d in fig:
        out.append(Ev(t, d, [spell(midi, b.key, s.ch)] if midi is not None else [], src="counter-fill"))
        t += d
    return out


def _scale_figure(s, c, target, bars, tail, sub, ceiling, lo):
    b = bars[s.bar_i]
    n = int(tail / sub)
    if n <= 0:
        return [(c, tail)]
    # walk from c toward target, finishing a step away from it
    sp = scale_pcs(b.key)
    best = None
    for direction in (1, -1):
        seq = []
        cur = c
        d_steps = _steps_between(c, target, b.key)
        for k in range(n):
            remaining = n - k
            dist = _steps_between(cur, target, b.key)
            if abs(dist) > remaining:
                step = 1 if dist > 0 else -1
            elif abs(dist) == remaining:
                step = 1 if dist > 0 else -1
            else:
                step = direction if (remaining - abs(dist)) > 1 else (1 if dist > 0 else -1 if dist < 0 else direction)
            cur = diatonic_step(cur, step, b.key)
            seq.append(cur)
        cost = sum(5 for m in seq if m > ceiling or m < lo)
        cost += abs(_steps_between(seq[-1], target, b.key)) * 0.5
        if best is None or cost < best[0]:
            best = (cost, seq)
    seq = best[1]
    if best[0] >= 5:
        return [(c, tail)]
    return [(m, sub) for m in seq]


def _steps_between(a: int, b: int, k) -> int:
    sp = scale_pcs(k)
    def idx(m):
        while m % 12 not in sp:
            m -= 1
        octave, pc = divmod(m, 12)
        return octave * len(sp) + sorted(sp).index(pc)
    return idx(b) - idx(a)


def _echo_figure(s, c, target, bars, mel, tail, ceiling, lo):
    """Imitate the melody figure that precedes the held note."""
    b = bars[s.bar_i]
    held_start = s.abs
    # the melody immediately before the slot (the 'call')
    call = [n for n in mel if n.abs >= held_start - tail and n.end <= held_start + F(1, 1000)]
    if not call or any(n.midi is None for n in call):
        return None
    if sum((n.dur for n in call), F(0)) != tail:
        return None
    if len(call) < 2:
        return None
    best = None
    held = sounding_at(mel, s.abs + (s.fill_start - s.off))
    for shift in range(-9, 3):
        seq = [diatonic_step(n.midi, shift, b.key) if shift else n.midi for n in call]
        if max(seq) > ceiling or min(seq) < lo:
            continue
        cost = 0.0
        if seq[0] % 12 not in s.ch.pcs:
            cost += 1.0
        t = held_start + (s.fill_start - s.off)
        for n, m in zip(call, seq):
            st = strength((t - s.abs) + s.off, b.meter)
            if held is not None and held.midi is not None:
                ic = (held.midi - m) % 12
                if ic in (1, 11):
                    cost += 2.0 if st >= 1 else 0.6
                elif ic in (2, 10):
                    cost += 0.6 if st >= 2 else 0.2
            t += n.dur
        cost += 0.3 * abs(seq[-1] - target) if abs(seq[-1] - target) > 2 else 0
        if abs(seq[0] - c) > 7:
            cost += 0.5
        if best is None or cost < best[0]:
            best = (cost, seq)
    if best is None or best[0] > 2.5:
        return None
    return [(m, n.dur) for m, n in zip(best[1], call)]


# ----------------------------------------------------------------- drone ---

def gen_drone(bars, voice, inst: Instrument, spec: TechSpec, ctx):
    fixed = spec.get("notes")
    fixed_midis = None
    if fixed:
        from music21 import pitch as m21pitch
        fixed_midis = tuple(sorted(m21pitch.Pitch(n).midi for n in fixed.split()))
    follow = spec.get("follow", True)
    rhythm = spec.get("rhythm", "sustain")
    high = _pitch_param(spec.get("high"), None)
    prev = None
    events_per_bar = []
    for i, b in enumerate(bars):
        barlen, beat, sub = meter_info(b.meter)
        spans = []
        pts = sorted({F(0)} | {c.off for c in b.chords if c.off < b.length}) + [b.length]
        for a, z in zip(pts, pts[1:]):
            spans.append((a, z, chord_of(b, a)))
        evs = []
        mel = sorted(e.midi for e in b.melody if e.midi)
        # keep the drone under the tune: below the bar's lower-quartile note
        ceiling = high if high is not None else (mel[len(mel) // 4] - 3 if mel else inst.low + 21)
        for a, z, ch in spans:
            if fixed_midis and (not follow or {m % 12 for m in fixed_midis} <= ch.pcs):
                ds = fixed_midis
            else:
                ds = None
                for hi in (ceiling, ceiling + 5, inst.low + 21):
                    ds = best_double_stop(inst, ch, pcs={ch.root, ch.fifth} - {None} or set(ch.pcs),
                                          require={ch.root}, prefer_open=2.0, want_third=0.0,
                                          prev=prev, center=inst.low + 9, hi=hi)
                    if ds:
                        break
                if ds is None:
                    ds = best_double_stop(inst, ch, prefer_open=2.0, prev=prev)
            prev = ds
            pitches = [spell(m, b.key, ch) for m in ds]
            if rhythm == "sustain":
                evs.append(Ev(a, z - a, pitches, src="drone"))
            else:
                step = beat if rhythm == "beat" else (barlen if rhythm == "bar" else F(rhythm))
                t = a
                while t < z:
                    d = min(step, z - t)
                    evs.append(Ev(t, d, [p for p in pitches], src="drone"))
                    t += d
        events_per_bar.append(evs)
    # ties for sustained drones over identical pitches
    flat = [e for evs in events_per_bar for e in evs]
    if rhythm == "sustain":
        for e1, e2 in zip(flat, flat[1:]):
            if [p.midi for p in e1.pitches] == [p.midi for p in e2.pitches]:
                e1.tie = True
    for b, evs in zip(bars, events_per_bar):
        b.out[voice] = evs
    return [prev[0]] if prev else None


# ------------------------------------------------------------------ vamp ---

VAMP_PATTERNS = {
    # (offset, duration, kind) kind: B = bass root, F = bass fifth, C = chord, R = rest
    "waltz": {"3/4": [(0, 1, "B"), (1, 1, "C"), (2, 1, "C")]},
    "waltz-lilt": {"3/4": [(0, 1, "B"), (1, F(3, 2), "C"), (F(5, 2), F(1, 2), "C")]},
    "polka": {"2/4": [(0, F(1, 2), "B"), (F(1, 2), F(1, 2), "C"), (1, F(1, 2), "F"), (F(3, 2), F(1, 2), "C")]},
    "polka-quarters": {"2/4": [(0, 1, "B"), (1, 1, "C")]},
    "reel": {"4/4": [(0, 1, "B"), (1, 1, "C"), (2, 1, "F"), (3, 1, "C")],
             "2/2": [(0, 1, "B"), (1, 1, "C"), (2, 1, "F"), (3, 1, "C")]},
    "reel-drive": {"4/4": [(0, F(1, 2), "B"), (F(1, 2), F(1, 2), "C"), (1, F(1, 2), "R"), (F(3, 2), F(1, 2), "C"),
                           (2, F(1, 2), "F"), (F(5, 2), F(1, 2), "C"), (3, F(1, 2), "R"), (F(7, 2), F(1, 2), "C")]},
    "jig": {"6/8": [(0, 1, "B"), (1, F(1, 2), "C"), (F(3, 2), 1, "F"), (F(5, 2), F(1, 2), "C")]},
    "slip": {"9/8": [(0, 1, "B"), (1, F(1, 2), "C"), (F(3, 2), 1, "F"), (F(5, 2), F(1, 2), "C"),
                     (3, 1, "B"), (4, F(1, 2), "C")]},
}
DEFAULT_VAMP = {"3/4": "waltz", "2/4": "polka", "4/4": "reel", "2/2": "reel",
                "6/8": "jig", "9/8": "slip"}


def gen_vamp(bars, voice, inst: Instrument, spec: TechSpec, ctx):
    prev_ds = None
    for b in bars:
        pname = spec.get("pattern") or DEFAULT_VAMP.get(b.meter)
        pat = VAMP_PATTERNS[pname][b.meter]
        if b.is_pickup:
            b.out[voice] = [Ev(F(0), b.length, [], src="vamp")]
            continue
        evs = []
        last_root_chord = None
        for off, dur, kind in pat:
            off, dur = F(off), F(dur)
            if off >= b.length:
                break
            ch = chord_of(b, off)
            if kind == "R":
                evs.append(Ev(off, dur, [], src="vamp"))
                continue
            if kind in ("B", "F"):
                use_fifth = kind == "F" and last_root_chord == ch.symbol and ch.fifth is not None
                pc = ch.fifth if use_fifth else ch.bass
                m = inst.low + ((pc - inst.low) % 12)
                if spec.get("bass_high") and m + 12 <= inst.low + 16:
                    m += 12
                evs.append(Ev(off, dur, [spell(m, b.key, ch)], src="vamp",
                              arts=["tenuto"] if dur >= 1 else []))
                last_root_chord = ch.symbol
            else:
                bass_m = evs[-1].pitches[0].midi if evs and evs[-1].pitches else inst.low
                ds = best_double_stop(inst, ch, lo=bass_m + 1, hi=inst.low + 23, prefer_open=0.5,
                                      want_third=2.5, prev=prev_ds, center=inst.low + 17,
                                      min_string=1)
                if ds is None:
                    ds = best_double_stop(inst, ch, lo=inst.low + 5, hi=inst.low + 23,
                                          want_third=1.5, prev=prev_ds, center=inst.low + 14)
                if ds is None:
                    evs.append(Ev(off, dur, [], src="vamp"))
                    continue
                prev_ds = ds
                evs.append(Ev(off, dur, [spell(m, b.key, ch) for m in ds], src="vamp",
                              arts=["staccato"] if spec.get("staccato", True) else []))
        b.out[voice] = _fill_gaps(evs, b.length)
    return None


# --------------------------------------------------------------- simple ----

def gen_melody(bars, voice, inst, spec, ctx):
    shift = spec.get("octave", 0) * 12
    for b in bars:
        evs = [e.clone(src="melody") for e in b.melody]
        if shift:
            ok = all(e.is_rest or (inst.low <= e.midi + shift <= inst.max_high) for e in evs)
            if ok:
                for e in evs:
                    e.pitches = [p.transpose(shift) for p in e.pitches]
                    e.grace = [] if shift < 0 else [g.transpose(shift) for g in e.grace]
                    e.src = "octave"
        if spec.get("plain"):
            for e in evs:
                e.grace, e.orns = [], [o for o in e.orns if o == "fermata"]
        b.out[voice] = evs
    return None


def gen_rest(bars, voice, inst, spec, ctx):
    for b in bars:
        b.out[voice] = [Ev(F(0), b.length, [], src="rest")]


def gen_abc(bars, voice, inst, spec, ctx):
    from .theory import parse_key
    text = spec.get("abc")
    parsed = parse_abc(text, bars[0].key)
    if len(parsed) != len(bars):
        raise ValueError(f"abc for {voice} has {len(parsed)} bars, expected {len(bars)}: {text}")
    for b, pb in zip(bars, parsed):
        if pb["length"] != b.length:
            raise ValueError(f"abc bar length {pb['length']} != {b.length}: {text}")
        for e in pb["events"]:
            e.src = "abc"
        b.out[voice] = pb["events"]


TECHNIQUES = {
    "melody": gen_melody,
    "unison": gen_melody,
    "harmony": gen_harmony,
    "counter": gen_counter,
    "drone": gen_drone,
    "vamp": gen_vamp,
    "rest": gen_rest,
    "abc": gen_abc,
}
