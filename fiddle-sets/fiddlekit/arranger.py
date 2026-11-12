"""Run the techniques over a loaded set and post-process the result."""
from __future__ import annotations

from fractions import Fraction as F

from .instruments import INSTRUMENTS
from .loader import ArrangedSet
from .model import Bar, Ev
from .techniques import TECHNIQUES, chord_of
from .theory import diatonic_step, meter_info, spell


def runs(bars: list[Bar], voice: str):
    """Group consecutive bars sharing the same TechSpec uid."""
    cur, uid = [], None
    for i, b in enumerate(bars):
        s = b.specs[voice]
        if s.uid != uid and cur:
            yield cur
            cur = []
        cur.append(i)
        uid = s.uid
    if cur:
        yield cur


def arrange(aset: ArrangedSet) -> list[Bar]:
    bars = aset.bars
    for v in aset.voice_names:
        inst = INSTRUMENTS[aset.voices[v].get("instrument", "violin")]
        prev = None
        for idx in runs(bars, v):
            rb = [bars[i] for i in idx]
            spec = rb[0].specs[v]
            ctx = {"prev": prev}
            nxt = idx[-1] + 1
            if nxt < len(bars):
                nm = next((e.midi for e in bars[nxt].melody if e.midi), None)
                ctx["next_target"] = None if nm is None else nm - 9
            fn = TECHNIQUES[spec.tech]
            fn(rb, v, inst, spec, ctx)
            last = [e.midi for b in rb for e in b.out[v] if not e.is_rest]
            prev = last[-1] if last else prev
            if spec.get("suspensions"):
                add_suspensions(rb, v)
            if spec.get("dyn"):
                rb[0].dyn[v] = spec.get("dyn")
            if spec.get("articulation"):
                for b in rb:
                    for e in b.out[v]:
                        if not e.is_rest and spec.get("articulation") not in e.arts:
                            e.arts.append(spec.get("articulation"))
    for b in bars:
        if b.fermata_end:
            for v in aset.voice_names:
                evs = [e for e in b.out[v]]
                if evs:
                    evs[-1].orns = list(set(evs[-1].orns) | {"fermata"})
                    evs[-1].tie = False
    return bars


def add_suspensions(rbars: list[Bar], voice: str):
    """4–3 (and 9–8-ish) suspensions at cadences: where a phrase ends on a
    long chord-third in the arranged voice, delay it with the note a step
    above, prepared by the previous note when possible. Classic tension →
    release device."""
    done = set()
    for bi, b in enumerate(rbars):
        if not b.phrase_end:
            continue
        # the cadence *arrives* where the final chord begins (often a bar early)
        arrival = bi
        if bi > 0 and rbars[bi - 1].chords and b.chords and \
                rbars[bi - 1].chords[-1].symbol == b.chords[0].symbol and \
                rbars[bi - 1].chords[-1].off == 0:
            arrival = bi - 1
        if arrival == 0 or arrival in done:
            continue
        done.add(arrival)
        b = rbars[arrival]
        pb = rbars[arrival - 1]
        evs = b.out[voice]
        if not evs or evs[0].is_rest or evs[0].off != 0 or len(evs[0].pitches) != 1:
            continue
        e = evs[0]
        barlen, beat, _ = meter_info(b.meter)
        if e.dur < beat * (2 if barlen / beat >= 3 else 1):
            continue
        ch = chord_of(b, F(0))
        if e.midi % 12 != ch.third:
            continue
        sus = diatonic_step(e.midi, 1, b.key)
        if any((m.midi - sus) % 12 in (1, 2, 10, 11) for m in b.melody if m.midi and m.off < beat):
            continue
        # preparation: the previous note must be (or become) the suspended pitch
        pevs = pb.out[voice]
        if not pevs or pevs[-1].is_rest or len(pevs[-1].pitches) != 1:
            continue
        p = pevs[-1]
        if p.midi != sus:
            pch = chord_of(pb, p.off)
            clash = any((m.midi - sus) % 12 in (1, 11) for m in pb.melody
                        if m.midi and m.off < p.end and m.end > p.off)
            if sus % 12 not in pch.pcs or clash or p.dur < beat / 2 or abs(p.midi - sus) > 2:
                continue
            p.pitches = [spell(sus, pb.key, pch)]
            p.src = "suspension-prep"
        p.tie = True
        first = e.clone(dur=beat, tie=False, src="suspension", text=None)
        first.pitches = [spell(sus, b.key, ch)]
        rest = e.clone(off=e.off + beat, dur=e.dur - beat, src="suspension-resolve")
        b.out[voice] = [first, rest] + evs[1:]


def merge_pickups(bars: list[Bar], voices: list[str]) -> list[dict]:
    """Turn the bar list into printed measures: a pickup bar is spliced onto
    the end of the previous bar (truncating it), or becomes an anacrusis."""
    measures = []
    for b in bars:
        if b.is_pickup and measures:
            m = measures[-1]
            prevb = m["bars"][-1]
            cut = prevb.length - b.length
            for v in voices:
                m["out"][v] = truncate(m["out"][v], cut) + [e.clone(off=e.off + cut) for e in b.out[v]]
            m["chords"] = [c for c in m["chords"] if c[0] < cut] + \
                          [(c.off + cut, c.symbol) for c in b.chords]
            m["pickup_bars"].append((cut, b))
            continue
        measures.append({
            "bars": [b], "meter": b.meter, "key": b.key,
            "length": b.length, "full": b.full_length,
            "out": {v: [e.clone() for e in b.out[v]] for v in voices},
            "chords": [(c.off, c.symbol) for c in b.chords],
            "anacrusis": b.is_pickup, "pickup_bars": [],
        })
    return measures


def truncate(evs: list[Ev], cut: F) -> list[Ev]:
    out = []
    for e in evs:
        if e.off >= cut:
            continue
        if e.end > cut:
            e = e.clone(dur=cut - e.off, tie=False)
            e.orns = [o for o in e.orns if o != "fermata"]
        out.append(e)
    return out
