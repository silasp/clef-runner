"""Checks and reports: playability, two-voice counterpoint, harmonic analysis."""
from __future__ import annotations

import json
from fractions import Fraction as F

from music21 import chord as m21chord, roman

from .instruments import INSTRUMENTS
from .theory import chord, chord_tension, meter_info, strength

NAMES = {1: "m2", 2: "M2", 10: "m7", 11: "M7", 0: "8ve/unison", 7: "5th"}


def _timeline(measures, voice):
    out = []
    t = F(0)
    for mi, M in enumerate(measures):
        for e in M["out"][voice]:
            out.append((t + e.off, e, mi, M))
        t += M["length"]
    return out


def _sounding(tl, t):
    for start, e, mi, M in tl:
        if start <= t < start + e.dur:
            return start, e
    return None, None


def report(aset, bars, measures) -> str:
    v1, v2 = aset.voice_names[0], aset.voice_names[1]
    lines = [f"# {aset.title} — arrangement report", ""]
    # ---- plan summary
    lines += ["## Plan", "", "| # | Tune / section | Part | Bars | Violin I | Violin II |",
              "|---|---|---|---|---|---|"]
    seen = []
    n = 0
    for b in bars:
        if b.is_pickup:
            continue
        key = (b.tune, b.part, b.pass_index, b.section_start)
        if b.section_start:
            n += 1
            techs = []
            for v in (v1, v2):
                s = b.specs[v]
                desc = s.tech + "".join(f" {k}={val}" for k, val in s.params.items()
                                         if k not in ("abc", "dyn"))
                techs.append(desc)
            # other techniques later in the same pass
            same = [bb for bb in bars if not bb.is_pickup and bb.item_index == b.item_index
                    and bb.pass_index == b.pass_index]
            nbar = len(same)
            later = []
            for bb in same:
                if bb.specs[v2].tech not in later:
                    later.append(bb.specs[v2].tech)
            if len(later) > 1:
                techs[1] = " → ".join(later)
            lines.append(f"| {b.rehearsal or ''} | {b.tune or 'transition'} | {b.part} | {nbar} | "
                         f"{techs[0]} | {techs[1]} |")
    # ---- duration
    secs = 0.0
    tempo = None
    for b in bars:
        if b.tempo:
            tempo = b.tempo
        if tempo:
            secs += float(b.length) / tempo.get("beat_ql", 1.0) / tempo["bpm"] * 60
    lines += ["", f"Approximate duration: **{int(secs // 60)}:{int(secs % 60):02d}** "
                  f"({len(measures)} printed bars).", ""]
    # ---- playability
    first = 0 if measures and measures[0]["anacrusis"] else 1
    lines += ["## Playability", "", "Bar numbers match the printed score.", ""]
    for v in aset.voice_names:
        inst = INSTRUMENTS[aset.voices[v].get("instrument", "violin")]
        hi, lo, ds_bad, shifts = [], [], [], []
        notes = 0
        for mi, M in enumerate(measures):
            for e in M["out"][v]:
                if e.is_rest:
                    continue
                notes += 1
                ms = sorted(p.midi for p in e.pitches)
                if ms[-1] > inst.first_position_top:
                    shifts.append(f"bar {mi+first}: {e.pitches[-1].nameWithOctave}")
                if ms[-1] > inst.max_high:
                    hi.append(f"bar {mi+first}")
                if ms[0] < inst.low:
                    lo.append(f"bar {mi+first}: {e.pitches[0].nameWithOctave}")
                for a, z in zip(ms, ms[1:]):
                    if not inst.double_stop_ok(a, z):
                        ds_bad.append(f"bar {mi+first}: {[p.nameWithOctave for p in e.pitches]}")
        name = aset.voices[v].get("name", v)
        lines.append(f"- **{name}**: {notes} notes; "
                     f"outside 1st position: {len(shifts)} {('(' + ', '.join(shifts[:8]) + ')') if shifts else ''}; "
                     f"below range: {len(lo)}; awkward double stops: {len(ds_bad)} "
                     f"{('(' + '; '.join(ds_bad[:6]) + ')') if ds_bad else ''}")
    # ---- counterpoint between the two violins
    lines += ["", "## Two-voice check (Violin I vs Violin II)", ""]
    tl1, tl2 = _timeline(measures, v1), _timeline(measures, v2)
    onsets = sorted({t for t, e, *_ in tl1 if not e.is_rest} | {t for t, e, *_ in tl2 if not e.is_rest})
    strong_diss, parallels, crossings = [], [], 0
    prev = None
    bar_starts = []
    t = F(0)
    for M in measures:
        bar_starts.append(t)
        t += M["length"]
    import bisect
    first = 0 if measures and measures[0]["anacrusis"] else 1
    for t in onsets:
        s1, e1 = _sounding(tl1, t)
        s2, e2 = _sounding(tl2, t)
        if e1 is None or e2 is None or e1.is_rest or e2.is_rest:
            prev = None
            continue
        mi = bisect.bisect_right(bar_starts, t) - 1
        M = measures[mi]
        off = t - bar_starts[mi]
        st = strength(off, M["meter"])
        a, b = e1.pitches[-1].midi, e2.pitches[-1].midi
        if b > a and (e2.src or "") in ("harmony", "counter", "counter-fill") and (e1.src or "") == "melody":
            crossings += 1
        ic = abs(a - b) % 12
        _, beat, _ = meter_info(M["meter"])
        if st >= 2 and ic in (1, 11, 2) and min(e1.dur, e2.dur) >= beat / 2:
            strong_diss.append(f"bar {mi+first} beat {float(off / beat) + 1:g}: "
                               f"{e1.pitches[-1].nameWithOctave}/{e2.pitches[-1].nameWithOctave} ({NAMES[ic]})")
        if prev is not None:
            pa, pb, pic = prev
            layers = {e1.src, e2.src}
            accompaniment = bool(layers & {"octave", "vamp", "drone"}) or layers == {"melody"}
            if pic == ic and ic in (0, 7) and a != pa and b != pb and not accompaniment:
                parallels.append(f"bar {mi+first}: {NAMES[ic]}")
        prev = (a, b, ic)
    lines.append(f"- Strong-beat seconds/sevenths (≥ ½ beat long): {len(strong_diss)}")
    for s in strong_diss[:30]:
        lines.append(f"  - {s}")
    lines.append(f"- Consecutive parallel 5ths/8ves (outside unison/octave doubling): {len(parallels)}")
    for s in parallels[:30]:
        lines.append(f"  - {s}")
    lines.append(f"- Onsets where Violin II sits above the tune: {crossings}")
    lines.append("")
    return "\n".join(lines)


def tune_analysis(tune) -> str:
    """Per-bar harmony, roman numerals, tension curve, phrases & motifs (JSON)."""
    out = {"id": tune.id, "title": tune.title, "meter": tune.meter,
           "key": str(tune.key), "parts": {}, "motifs": tune.data.get("motifs", {})}
    for name in tune.parts:
        bars, pickup = tune.part_bars(name)
        pdata = []
        for b in bars:
            cells = []
            for c in b.chords:
                ch = chord(c.symbol)
                try:
                    rn = roman.romanNumeralFromChord(m21chord.Chord(ch.pitches), b.key).figure
                except Exception:  # pragma: no cover
                    rn = "?"
                cells.append({"off": float(c.off), "dur": float(c.dur), "chord": c.symbol,
                              "roman": rn, "tension": round(chord_tension(ch, b.key), 2)})
            pdata.append({"bar": b.part_bar, "chords": cells, "tension": round(b.tension, 2),
                          "phrase_end": b.phrase_end, "peak": b.phrase_peak})
        out["parts"][name] = {"key": str(bars[0].key), "bars": pdata,
                              "phrases": tune.parts[name].get("phrases", [])}
    return json.dumps(out, indent=1, ensure_ascii=False)
