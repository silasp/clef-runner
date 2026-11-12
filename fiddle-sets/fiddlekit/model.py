"""Core data structures: events, bars, technique specs."""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from fractions import Fraction as F
from typing import Any

from music21 import key as m21key, pitch as m21pitch


@dataclass
class Ev:
    """One note, chord (double stop) or rest inside a bar."""
    off: F                      # offset inside the bar (quarter lengths)
    dur: F                      # sounding duration (quarter lengths)
    pitches: list[m21pitch.Pitch] = field(default_factory=list)  # [] = rest
    tie: bool = False           # tied to the next event in this voice
    slur_start: bool = False
    slur_stop: bool = False
    grace: list[m21pitch.Pitch] = field(default_factory=list)
    arts: list[str] = field(default_factory=list)   # staccato, accent, tenuto, upbow, downbow
    orns: list[str] = field(default_factory=list)   # roll, trill, fermata
    dyn: str | None = None      # dynamic mark at this note
    text: str | None = None     # small text above
    hidden: bool = False        # invisible rest (ABC 'x')
    src: str | None = None      # which technique produced it (for reports)

    @property
    def is_rest(self) -> bool:
        return not self.pitches

    @property
    def midi(self) -> int | None:
        return self.pitches[-1].midi if self.pitches else None  # top note

    @property
    def end(self) -> F:
        return self.off + self.dur

    def clone(self, **kw) -> "Ev":
        e = copy.deepcopy(self)
        for k, v in kw.items():
            setattr(e, k, v)
        return e


@dataclass
class ChordSpan:
    off: F
    dur: F
    symbol: str

    @property
    def end(self) -> F:
        return self.off + self.dur


@dataclass
class TechSpec:
    """Which technique a voice uses over a run of bars, plus parameters."""
    tech: str
    params: dict[str, Any] = field(default_factory=dict)
    uid: int = 0                # bars sharing a uid are generated together

    def get(self, k, default=None):
        return self.params.get(k, default)


@dataclass
class Bar:
    meter: str
    key: m21key.Key
    length: F                   # actual length of this bar (pickups are short)
    full_length: F              # nominal bar length for the meter
    melody: list[Ev]
    chords: list[ChordSpan]
    is_pickup: bool = False
    # arrangement
    specs: dict[str, TechSpec] = field(default_factory=dict)
    out: dict[str, list[Ev]] = field(default_factory=dict)
    # labelling / context
    tune: str | None = None     # tune id (None for transitions)
    part: str | None = None     # part letter
    part_bar: int | None = None # 1-based bar number inside the part
    pass_index: int = 0
    section_start: bool = False # first bar of a pass / transition
    item_start: bool = False    # first bar of a tune or transition
    item_end: bool = False
    title: str | None = None    # tune title shown at item start
    rehearsal: str | None = None
    tempo: dict | None = None
    dyn: dict[str, str] = field(default_factory=dict)       # voice -> dynamic at bar start
    hairpins: list[tuple[str, str, int, int]] = field(default_factory=list)
    texts: list[tuple[F, str]] = field(default_factory=list)
    phrase_end: str | None = None    # cadence type if a phrase ends here
    phrase_peak: bool = False
    tension: float = 0.0
    fermata_end: bool = False
    final: bool = False
    item_index: int = 0

    def chord_at(self, off: F) -> ChordSpan | None:
        cur = None
        for c in self.chords:
            if c.off <= off:
                cur = c
        return cur
