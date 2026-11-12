"""Smoke tests: every tune parses with correct bar lengths, every set builds,
and the generated parts stay playable."""
from fractions import Fraction as F
from pathlib import Path

import pytest

from fiddlekit.abc import parse_abc
from fiddlekit.arranger import arrange, merge_pickups
from fiddlekit.instruments import VIOLIN
from fiddlekit.loader import ROOT, ArrangedSet, load_tune
from fiddlekit.theory import parse_key

TUNES = sorted(p.stem for p in (ROOT / "tunes").glob("*.yaml"))
SETS = sorted((ROOT / "sets").glob("*.yaml"))


def test_abc_basics():
    bars = parse_abc("{B}c4 (3B/c/B/ A | G>F GB/B/ | [Ae]2 z", parse_key("A"))
    assert [b["length"] for b in bars] == [F(3), F(2), F(3, 2)]
    assert bars[0]["events"][0].grace and bars[0]["events"][1].dur == F(1, 6)
    assert [p.name for p in bars[2]["events"][0].pitches] == ["A", "E"]


@pytest.mark.parametrize("tune_id", TUNES)
def test_tune_parts_parse(tune_id):
    tune = load_tune(tune_id)
    for part, pdata in tune.parts.items():
        variants = [None] + list((pdata.get("variants") or {}).keys())
        for v in variants:
            bars, pickup = tune.part_bars(part, v)   # raises on bad bar lengths
            assert bars and all(b.chords for b in bars)


@pytest.mark.parametrize("set_path", SETS, ids=[p.stem for p in SETS])
def test_set_builds_and_is_playable(set_path):
    aset = ArrangedSet(set_path)
    bars = arrange(aset)
    measures = merge_pickups(bars, aset.voice_names)
    for M in measures:
        for v in aset.voice_names:
            total = sum((e.dur for e in M["out"][v]), F(0))
            assert total == M["length"], (v, M["bars"][0].tune, M["bars"][0].part_bar)
            for e in M["out"][v]:
                for p in e.pitches:
                    assert VIOLIN.low <= p.midi <= VIOLIN.max_high
                ms = sorted(p.midi for p in e.pitches)
                for a, b in zip(ms, ms[1:]):
                    assert b - a >= 3
