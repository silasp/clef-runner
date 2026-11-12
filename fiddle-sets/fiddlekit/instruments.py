"""Instrument definitions and playability helpers (strings, positions,
double-stop voicings). Written generically so viola/cello/bass parts can be
generated with the same techniques later."""
from __future__ import annotations

from dataclasses import dataclass
from itertools import product

from music21 import pitch as m21pitch


def _m(name: str) -> int:
    return m21pitch.Pitch(name).midi


@dataclass(frozen=True)
class Instrument:
    name: str
    abbrev: str
    strings: tuple[int, ...]        # open strings, low → high (MIDI)
    reach: int                      # semitones above open covered in 1st position
    comfort_high: int               # top of 'easy' range
    max_high: int                   # absolute top we allow
    clef: str                       # 'treble', 'alto', 'bass'
    music21_class: str

    @property
    def low(self) -> int:
        return self.strings[0]

    @property
    def first_position_top(self) -> int:
        return self.strings[-1] + self.reach

    def string_options(self, midi: int, max_fret: int | None = None) -> list[tuple[int, int]]:
        """[(string index, semitones above open)] in first position."""
        mf = self.reach if max_fret is None else max_fret
        return [(i, midi - s) for i, s in enumerate(self.strings) if 0 <= midi - s <= mf]

    def is_first_position(self, midi: int) -> bool:
        return self.low <= midi <= self.first_position_top

    def double_stop_ok(self, lo: int, hi: int) -> bool:
        """Two notes on adjacent strings, both reachable in 1st position,
        with a fingering a learner can manage (no unison, no same finger
        stretching a semitone across strings unless one is open)."""
        if hi <= lo:
            return False
        return any(a == lo and b == hi for a, b, _ in
                   double_stops(self, {lo % 12, hi % 12}, lo=lo, hi=hi))

    def open_count(self, midis) -> int:
        return sum(1 for m in midis if m in self.strings)


VIOLIN = Instrument("Violin", "Vln.", (_m("G3"), _m("D4"), _m("A4"), _m("E5")),
                    reach=7, comfort_high=_m("B5"), max_high=_m("E6"),
                    clef="treble", music21_class="Violin")
VIOLA = Instrument("Viola", "Vla.", (_m("C3"), _m("G3"), _m("D4"), _m("A4")),
                   reach=7, comfort_high=_m("E5"), max_high=_m("A5"),
                   clef="alto", music21_class="Viola")
CELLO = Instrument("Violoncello", "Vc.", (_m("C2"), _m("G2"), _m("D3"), _m("A3")),
                   reach=4, comfort_high=_m("D4"), max_high=_m("A4"),
                   clef="bass", music21_class="Violoncello")
BASS = Instrument("Contrabass", "Cb.", (_m("E1"), _m("A1"), _m("D2"), _m("G2")),
                  reach=2, comfort_high=_m("D3"), max_high=_m("G3"),
                  clef="bass", music21_class="Contrabass")

INSTRUMENTS = {"violin": VIOLIN, "viola": VIOLA, "cello": CELLO, "bass": BASS}


# approximate finger used for each semitone above the open string (1st position)
FINGER = {0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4}


def double_stops(inst: Instrument, pcs: set[int], *, require: set[int] | None = None,
                 lo: int | None = None, hi: int | None = None, min_string: int = 0
                 ) -> list[tuple[int, int, int]]:
    """Playable adjacent-string double stops whose notes are in `pcs`.

    Returns (low, high, open_strings) using the friendliest fingering for each
    pitch pair: two different fingers (or one flat finger for a fifth), no
    4th-finger-on-the-lower-string when the upper note is lower in the hand,
    and a max stretch of a fourth between the two stopped notes."""
    best: dict[tuple[int, int], int] = {}
    lo = inst.low if lo is None else lo
    hi = inst.first_position_top if hi is None else hi
    for s in range(min_string, len(inst.strings) - 1):
        for f1 in range(inst.reach + 1):
            for f2 in range(inst.reach + 1):
                a = inst.strings[s] + f1
                b = inst.strings[s + 1] + f2
                if not (lo <= a < b <= hi):
                    continue
                if a % 12 not in pcs or b % 12 not in pcs:
                    continue
                if require and not ({a % 12, b % 12} & require):
                    continue
                if f1 and f2:
                    fa, fb = FINGER.get(f1, 4), FINGER.get(f2, 4)
                    if fa == fb and f1 != f2:
                        continue        # one finger can't stop two different frets
                    if abs(f1 - f2) > 5:
                        continue
                    if fa == 4 and fb < 4 and f1 - f2 > 2:
                        continue        # awkward reverse stretch
                opens = (f1 == 0) + (f2 == 0)
                if best.get((a, b), -1) < opens:
                    best[(a, b)] = opens
    return sorted((a, b, o) for (a, b), o in best.items())


def score_double_stop(inst: Instrument, ds, *, root: int, third: int | None,
                      prefer_open: float = 1.0, want_third: float = 1.0,
                      prev: tuple[int, int] | None = None, center: int | None = None) -> float:
    """Lower is better."""
    a, b, opens = ds
    iv = b - a
    cost = {3: 0.3, 4: 0.3, 5: 0.5, 7: 0.0, 8: 0.2, 9: 0.2, 12: 0.8}.get(iv, 1.5)
    cost -= 0.6 * prefer_open * opens
    if opens == 0:
        cost += 0.3
    pcs = {a % 12, b % 12}
    if third is not None and third in pcs:
        cost -= 0.5 * want_third
    if root in pcs:
        cost -= 0.3
    if prev is not None:
        cost += 0.05 * (abs(a - prev[0]) + abs(b - prev[1]))
    if center is not None:
        cost += 0.04 * abs((a + b) / 2 - center)
    return cost


def best_double_stop(inst: Instrument, chord, **kw) -> tuple[int, int] | None:
    lo = kw.pop("lo", None)
    hi = kw.pop("hi", None)
    pcs = kw.pop("pcs", None) or set(chord.pcs)
    require = kw.pop("require", None)
    min_string = kw.pop("min_string", 0)
    opts = double_stops(inst, pcs, require=require, lo=lo, hi=hi, min_string=min_string)
    if not opts:
        return None
    best = min(opts, key=lambda d: score_double_stop(inst, d, root=chord.root,
                                                     third=chord.third, **kw))
    return best[0], best[1]
