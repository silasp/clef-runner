"""Small music-theory helpers built on music21.

Everything here is instrument-agnostic: keys, scales, chord symbols, spelling,
metric strength and a simple harmonic-tension model.
"""
from __future__ import annotations

from fractions import Fraction as F
from functools import lru_cache

from music21 import harmony, key as m21key, pitch as m21pitch

MODES = {
    "": "major", "maj": "major", "ion": "major", "major": "major",
    "m": "minor", "min": "minor", "aeo": "minor", "minor": "minor",
    "dor": "dorian", "mix": "mixolydian", "lyd": "lydian", "phr": "phrygian",
    "loc": "locrian",
}


@lru_cache(maxsize=None)
def parse_key(s: str) -> m21key.Key:
    """Parse an ABC-style key ('A', 'D', 'Am', 'Edor', 'E dorian', 'Amix')."""
    s = s.strip()
    tonic = s[0].upper()
    rest = s[1:]
    if rest[:1] in ("#", "b"):
        tonic += "#" if rest[0] == "#" else "-"
        rest = rest[1:]
    rest = rest.strip().lower()
    mode = MODES.get(rest, MODES.get(rest[:3], "major"))
    return m21key.Key(tonic, mode)


def key_signature_alters(k: m21key.Key) -> dict[str, float]:
    """letter -> alter (e.g. {'F': 1, 'C': 1}) for the key signature."""
    out = {l: 0.0 for l in "ABCDEFG"}
    for p in k.alteredPitches:
        out[p.step] = p.alter
    return out


@lru_cache(maxsize=None)
def scale_pcs(k: m21key.Key) -> tuple[int, ...]:
    return tuple(p.pitchClass for p in k.getPitches()[:-1])


@lru_cache(maxsize=None)
def scale_names(k: m21key.Key) -> dict[int, str]:
    """pitch class -> spelled name in this key (e.g. 1 -> 'C#')."""
    return {p.pitchClass: p.name for p in k.getPitches()[:-1]}


class Chord:
    """A parsed chord symbol with the bits an arranger cares about."""

    def __init__(self, symbol: str):
        self.symbol = symbol
        cs = harmony.ChordSymbol(symbol)
        self.pitches = list(cs.pitches)
        self.pcs = frozenset(p.pitchClass for p in self.pitches)
        self.root = cs.root().pitchClass
        self.bass = cs.bass().pitchClass
        self.names = {p.pitchClass: p.name for p in self.pitches}
        third = cs.third
        fifth = cs.fifth
        seventh = cs.seventh
        self.third = third.pitchClass if third is not None else None
        self.fifth = fifth.pitchClass if fifth is not None else None
        self.seventh = seventh.pitchClass if seventh is not None else None
        self.is_minor = self.third is not None and (self.third - self.root) % 12 == 3
        self.is_dom7 = (self.seventh is not None and not self.is_minor
                        and (self.seventh - self.root) % 12 == 10)
        self.is_sus = "sus" in symbol

    def degree_of(self, pc: int) -> str | None:
        """'root', 'third', 'fifth', 'seventh', 'other' or None if not a chord tone."""
        if pc == self.root:
            return "root"
        if pc == self.third:
            return "third"
        if pc == self.fifth:
            return "fifth"
        if pc == self.seventh:
            return "seventh"
        if pc in self.pcs:
            return "other"
        return None

    @property
    def guide_tones(self) -> set[int]:
        g = set()
        if self.third is not None:
            g.add(self.third)
        if self.seventh is not None:
            g.add(self.seventh)
        return g

    def __repr__(self):
        return f"Chord({self.symbol})"


@lru_cache(maxsize=None)
def chord(symbol: str) -> Chord:
    return Chord(symbol)


def spell(midi: int, k: m21key.Key, ch: Chord | None = None) -> m21pitch.Pitch:
    """Spell a MIDI number sensibly for key k (and current chord)."""
    pc = midi % 12
    name = None
    if ch is not None and pc in ch.names and pc not in scale_names(k):
        name = ch.names[pc]
    if name is None:
        name = scale_names(k).get(pc)
    if name is None and ch is not None:
        name = ch.names.get(pc)
    if name is None:
        p = m21pitch.Pitch(midi=midi)
        # prefer sharps in sharp keys, flats in flat keys
        if k.sharps < 0 and p.accidental is not None and p.accidental.alter > 0:
            p = p.getEnharmonic()
        return p
    p = m21pitch.Pitch(name)
    # set octave so that midi matches (B#/Cb edge cases)
    p.octave = 4
    p.octave += (midi - p.midi) // 12
    assert p.midi == midi, (midi, name, p)
    return p


def candidates(lo: int, hi: int, k: m21key.Key, ch: Chord | None,
               chord_only: bool = False) -> list[int]:
    """MIDI pitches in [lo, hi] that are diatonic (or chord tones)."""
    pcs = set(ch.pcs) if ch is not None else set()
    if not chord_only:
        pcs |= set(scale_pcs(k))
        # a chromatic chord (e.g. E7 in A minor, B7 in E dorian) should not
        # leave its contradicted scale note available
        if ch is not None:
            for c in ch.pcs:
                for clash in ((c + 1) % 12, (c - 1) % 12):
                    if clash in pcs and clash not in ch.pcs and c not in scale_pcs(k):
                        pcs.discard(clash)
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]


def diatonic_step(midi: int, steps: int, k: m21key.Key) -> int:
    """Move `steps` scale steps from midi (snapping chromatic notes first)."""
    sp = scale_pcs(k)
    m = midi
    if m % 12 not in sp:  # snap down to nearest scale note
        while m % 12 not in sp:
            m -= 1
    direction = 1 if steps > 0 else -1
    for _ in range(abs(steps)):
        m += direction
        while m % 12 not in sp:
            m += direction
    return m


# ---------------------------------------------------------------- meter ----

def meter_info(ts: str) -> tuple[F, F, F]:
    """(bar length, beat length, subdivision) in quarter lengths."""
    num, den = (int(x) for x in ts.split("/"))
    bar = F(num * 4, den)
    if den == 8 and num % 3 == 0 and num > 3:  # compound
        beat = F(3, 2)
        sub = F(1, 2)
    elif den == 2:
        beat = F(2)
        sub = F(1)
    else:
        beat = F(4, den)
        sub = beat / 2
    return bar, beat, sub


def strength(off: F, ts: str) -> float:
    """Metric strength of an offset inside a bar: 3 downbeat, 2 beat,
    2.5 for the mid-bar beat of 4/4 & 2/2-ish meters, 1 subdivision, 0 other."""
    bar, beat, sub = meter_info(ts)
    if off == 0:
        return 3.0
    if off % beat == 0:
        nbeats = bar / beat
        if nbeats == 4 and off == bar / 2:
            return 2.5
        return 2.0
    if off % sub == 0:
        return 1.0
    return 0.0


# ---------------------------------------------------------------- tension --

def chord_tension(ch: Chord, k: m21key.Key, next_ch: Chord | None = None) -> float:
    """Rough functional tension of a chord in a key (0 = home, 4 = very tense).

    Used for dynamics shaping, analysis output and choosing where to place
    suspensions/pedals. Deliberately simple and explainable.
    """
    tonic = k.tonic.pitchClass
    r = (ch.root - tonic) % 12
    base = {0: 0.0, 9: 1.0, 4: 1.2, 5: 1.5, 10: 1.5, 3: 1.5, 8: 2.0,
            2: 2.0, 7: 3.0, 11: 3.0, 1: 2.5, 6: 3.0}[r]
    major = not ch.is_minor
    if r == 2 and major:          # V/V
        base = 3.0
    if r == 4 and major:          # V/vi
        base = 2.5
    if r == 9 and major:          # V/ii
        base = 2.5
    if ch.is_dom7:
        base += 0.5
    if ch.is_sus:
        base += 0.5
    if r == 0 and ch.bass != ch.root and (ch.bass - ch.root) % 12 == 7:
        base = 3.0                # cadential 6-4
    elif ch.bass != ch.root:
        base += 0.3               # inversions are less stable
    return min(base, 4.0)


def interval_class(a: int, b: int) -> int:
    return abs(a - b) % 12


DISSONANT = {1, 2, 10, 11}
PERFECT = {0, 7}
