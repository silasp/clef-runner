"""Load tune and set YAML files into a flat list of Bars with technique specs."""
from __future__ import annotations

import itertools
from fractions import Fraction as F
from pathlib import Path

import yaml

from .abc import parse_abc
from .model import Bar, ChordSpan, Ev, TechSpec
from .theory import chord, chord_tension, meter_info, parse_key

_uid = itertools.count(1)
ROOT = Path(__file__).resolve().parent.parent


def parse_range(r, n: int) -> list[int]:
    """'1-4' / 5 / [1,2] / None → list of 1-based bar numbers (None = all)."""
    if r is None:
        return list(range(1, n + 1))
    if isinstance(r, int):
        return [r]
    if isinstance(r, list):
        out = []
        for x in r:
            out += parse_range(x, n)
        return out
    out = []
    for piece in str(r).split(","):
        piece = piece.strip()
        if "-" in piece:
            a, b = piece.split("-")
            out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(piece))
    return out


def parse_chord_line(line: str, n_bars: int, bar_lengths: list[F], meter: str) -> list[list[ChordSpan]]:
    """'A | D . E7 | ...' → per-bar chord spans. Tokens split the bar evenly;
    '.' repeats the previous chord for that slot."""
    cells = [c.strip() for c in line.replace("\n", " ").split("|")]
    cells = [c for c in cells if c != ""]
    if len(cells) != n_bars:
        raise ValueError(f"chord line has {len(cells)} bars, melody has {n_bars}: {line!r}")
    out = []
    prev = None
    for cell, length in zip(cells, bar_lengths):
        toks = cell.split()
        slot = length / len(toks)
        spans: list[ChordSpan] = []
        for j, t in enumerate(toks):
            if t == ".":
                if spans:
                    spans[-1].dur += slot
                    continue
                t = prev
            spans.append(ChordSpan(slot * j, slot, t))
            prev = t
        out.append(spans)
    return out


class Tune:
    def __init__(self, path: Path):
        self.path = path
        self.data = yaml.safe_load(path.read_text())
        d = self.data
        self.id = d["id"]
        self.title = d["title"]
        self.meter = str(d["meter"])
        self.key = parse_key(str(d["key"]))
        self.unit = F(str(d.get("unit", "1/8")))
        self.parts = d["parts"]

    def part_bars(self, name: str, variant: str | None = None) -> tuple[list[Bar], Bar | None]:
        """Bars for one strain (+ optional pickup bar)."""
        p = self.parts[name]
        key = parse_key(str(p.get("key", self.data["key"])))
        meter = str(p.get("meter", self.meter))
        full, _, _ = meter_info(meter)
        bars_abc = parse_abc(p["abc"], key, self.unit)
        chord_text = p["chords"]
        variants = p.get("variants", {}) or {}
        vdat = variants.get(variant, {}) if variant else {}
        if variant and variant not in variants:
            raise KeyError(f"{self.id}:{name} has no variant {variant!r}")
        # apply variant bar replacements
        abc_over = vdat.get("abc", {}) if isinstance(vdat, dict) else {}
        chord_over = vdat.get("chords", {}) if isinstance(vdat, dict) else {}
        for bn, txt in abc_over.items():
            bars_abc[int(bn) - 1] = parse_abc(txt, key, self.unit)[0]
        lengths = [b["length"] for b in bars_abc]
        for i, (b, L) in enumerate(zip(bars_abc, lengths)):
            if L != full:
                raise ValueError(f"{self.id}:{name} bar {i+1} ({variant}) has length {L}, expected {full}")
        chords = parse_chord_line(chord_text, len(bars_abc), lengths, meter)
        for bn, txt in chord_over.items():
            chords[int(bn) - 1] = parse_chord_line(txt, 1, [lengths[int(bn) - 1]], meter)[0]
        phrases = p.get("phrases", []) or []
        ends = {}
        peaks = set()
        for ph in phrases:
            rng = parse_range(ph["bars"], len(bars_abc))
            ends[rng[-1]] = ph.get("cadence", "open")
            if ph.get("peak"):
                peaks.add(int(ph["peak"]))
        bars = []
        for i, b in enumerate(bars_abc):
            bars.append(Bar(meter=meter, key=key, length=full, full_length=full,
                            melody=b["events"], chords=chords[i], tune=self.id, part=name,
                            part_bar=i + 1, phrase_end=ends.get(i + 1), phrase_peak=(i + 1) in peaks))
        pickup = None
        if p.get("pickup"):
            pb = parse_abc(p["pickup"], key, self.unit)[0]
            pch = p.get("pickup_chord") or chords[0][0].symbol
            pickup = Bar(meter=meter, key=key, length=pb["length"], full_length=full,
                         melody=pb["events"], chords=[ChordSpan(F(0), pb["length"], pch)],
                         is_pickup=True, tune=self.id, part=name, part_bar=0)
        for b in bars:
            b.tension = max((chord_tension(chord(c.symbol), key) for c in b.chords), default=0)
        return bars, pickup


def load_tune(tune_id: str, root: Path = ROOT) -> Tune:
    return Tune(root / "tunes" / f"{tune_id}.yaml")


def _spec_list(v, nbars: int, default: str) -> list[TechSpec | None]:
    """Expand a voice spec (dict, list of dicts with 'bars', or str) to per-bar specs."""
    per = [None] * nbars
    if v is None:
        v = {"tech": default}
    if isinstance(v, str):
        v = {"tech": v}
    if isinstance(v, dict):
        v = [v]
    for item in v:
        item = dict(item)
        bars = parse_range(item.pop("bars", None), nbars)
        tech = item.pop("tech")
        spec = TechSpec(tech, item, next(_uid))
        for bn in bars:
            per[bn - 1] = spec
    fallback = TechSpec(default, {}, next(_uid))
    return [s or fallback for s in per]


class ArrangedSet:
    def __init__(self, path: Path, root: Path = ROOT):
        self.path = path
        self.root = root
        self.data = yaml.safe_load(path.read_text())
        d = self.data
        self.id = d["id"]
        self.title = d["title"]
        self.voices = d.get("voices", {"v1": {"instrument": "violin", "name": "Violin I"},
                                       "v2": {"instrument": "violin", "name": "Violin II"}})
        self.voice_names = list(self.voices)
        self.bars: list[Bar] = []
        self.tunes: dict[str, Tune] = {}
        self._build()

    def _default_tech(self, v):
        return "melody" if v == self.voice_names[0] else "rest"

    def _build(self):
        rehearsal = iter("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        prev_tempo_from_transition = False
        for item_index, item in enumerate(self.data["sequence"]):
            if "tune" in item:
                tune = self.tunes.setdefault(item["tune"], load_tune(item["tune"], self.root))
                first = True
                for pi, ps in enumerate(item["passes"]):
                    part, _, variant = ps["part"].partition(":")
                    bars, pickup = tune.part_bars(part, variant or None)
                    use_pickup = pickup is not None and ps.get("pickup", True)
                    specs = {v: _spec_list(ps.get(v), len(bars), self._default_tech(v))
                             for v in self.voice_names}
                    if use_pickup:
                        for v in self.voice_names:
                            pspec = ps.get(f"{v}_pickup")
                            if pspec is None:
                                first_spec = specs[v][0]
                                if first_spec.tech in ("counter", "drone", "vamp"):
                                    first_spec = TechSpec("rest", {}, next(_uid))
                                pickup.specs[v] = first_spec
                            else:
                                pickup.specs[v] = _spec_list(pspec, 1, "rest")[0]
                        pickup.pass_index = pi
                        self.bars.append(pickup)
                    for b, i in zip(bars, range(len(bars))):
                        b.specs = {v: specs[v][i] for v in self.voice_names}
                        b.pass_index = pi
                    bars[0].section_start = True
                    bars[0].rehearsal = ps.get("rehearsal", next(rehearsal))
                    dyn = ps.get("dyn")
                    if dyn:
                        if isinstance(dyn, str):
                            dyn = {v: dyn for v in self.voice_names}
                        bars[0].dyn.update(dyn)
                    for bn, d in (ps.get("dyn_at") or {}).items():
                        if isinstance(d, str):
                            d = {v: d for v in self.voice_names}
                        bars[int(bn) - 1].dyn.update(d)
                    for hp in ps.get("hairpins", []) or []:
                        a, b2 = parse_range(hp["bars"], len(bars))[0], parse_range(hp["bars"], len(bars))[-1]
                        for v in hp.get("voices", self.voice_names):
                            bars[a - 1].hairpins.append((v, hp["type"], a, b2))
                    for bn, txt in (ps.get("text") or {}).items():
                        bars[int(bn) - 1].texts.append((F(0), txt))
                    if first:
                        bars[0].item_start = True
                        bars[0].title = item.get("title") or tune.data.get("display_title") or tune.title
                        bars[0].tempo = item.get("tempo") or (
                            None if prev_tempo_from_transition else tune.data.get("tempo"))
                        if use_pickup:
                            pickup.tempo = bars[0].tempo
                            pickup.title = bars[0].title
                            bars[0].tempo = None
                            bars[0].title = None
                            pickup.item_start = True
                            bars[0].item_start = False
                        first = False
                    if ps.get("fermata_end"):
                        bars[-1].fermata_end = True
                    for b in bars:
                        b.item_index = item_index
                    if use_pickup:
                        pickup.item_index = item_index
                    self.bars.extend(bars)
                self.bars[-1].item_end = True
                prev_tempo_from_transition = False
            elif "transition" in item:
                t = item["transition"]
                key = parse_key(str(t["key"]))
                meter = str(t["meter"])
                full, _, _ = meter_info(meter)
                mel_text = t.get("melody") or t.get(self.voice_names[0])
                if isinstance(mel_text, dict):
                    mel_text = mel_text["abc"]
                parsed = parse_abc(mel_text, key)
                lengths = [p["length"] for p in parsed]
                chords = parse_chord_line(t["chords"], len(parsed), lengths, meter)
                bars = []
                for i, pb in enumerate(parsed):
                    bars.append(Bar(meter=meter, key=key, length=pb["length"], full_length=full,
                                    melody=pb["events"], chords=chords[i], part="T", part_bar=i + 1))
                for v in self.voice_names:
                    vs = t.get(v)
                    if v == self.voice_names[0] and (vs is None or isinstance(vs, str)):
                        vs = {"tech": "melody"}
                    if isinstance(vs, str):
                        vs = {"tech": "abc", "abc": vs}
                    if isinstance(vs, dict) and "abc" in vs and "tech" not in vs:
                        vs = {"tech": "abc", **vs}
                    sl = _spec_list(vs, len(bars), "rest")
                    for b, s in zip(bars, sl):
                        b.specs[v] = s
                bars[0].section_start = True
                bars[0].item_start = True
                bars[0].tempo = t.get("tempo")
                bars[0].title = t.get("title")
                if t.get("dyn"):
                    d = t["dyn"]
                    bars[0].dyn.update({v: d for v in self.voice_names} if isinstance(d, str) else d)
                for bn, txt in (t.get("text") or {}).items():
                    bars[int(bn) - 1].texts.append((F(0), txt))
                for hp in t.get("hairpins", []) or []:
                    rng = parse_range(hp["bars"], len(bars))
                    for v in hp.get("voices", self.voice_names):
                        bars[rng[0] - 1].hairpins.append((v, hp["type"], rng[0], rng[-1]))
                if t.get("fermata_end"):
                    bars[-1].fermata_end = True
                bars[-1].item_end = True
                for b in bars:
                    b.tension = max((chord_tension(chord(c.symbol), key) for c in b.chords), default=0)
                    b.item_index = item_index
                prev_tempo_from_transition = bool(t.get("tempo"))
                self.bars.extend(bars)
        self.bars[-1].final = True
