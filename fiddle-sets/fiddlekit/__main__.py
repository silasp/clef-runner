"""Command line: python -m fiddlekit build sets/01-hectors-crossing.yaml"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .analysis import report, tune_analysis
from .arranger import arrange, merge_pickups
from .loader import ROOT, ArrangedSet, load_tune
from .render import build_score, write_outputs


def freeze_text(aset, bars) -> str:
    """Every generated passage as ABC, per section and voice — paste a line into
    the set file as `{tech: abc, abc: "..."}` to freeze it and hand-edit."""
    from .abc import events_to_abc
    out = [f"% {aset.title}: generated parts as ABC (L:1/8). Pickup bars omitted.", ""]
    groups = []
    for b in bars:
        if b.is_pickup:
            continue
        if b.section_start or not groups:
            groups.append([])
        groups[-1].append(b)
    for g in groups:
        b0 = g[0]
        label = f"[{b0.rehearsal or '-'}] {b0.tune or 'transition'} part {b0.part}"
        out.append(f"% {label}  K:{b0.key.tonic.name}{'' if b0.key.mode == 'major' else ' ' + b0.key.mode}  M:{b0.meter}")
        for v in aset.voice_names:
            techs = []
            for b in g:
                t = b.specs[v].tech
                if t not in techs:
                    techs.append(t)
            abc = events_to_abc([b.out[v] for b in g], b0.key)
            out.append(f"{v} ({'/'.join(techs)}): {abc}")
        out.append("")
    return "\n".join(out)


def build(path: Path, preview: bool = True, out_dir: Path | None = None) -> dict:
    aset = ArrangedSet(path)
    bars = arrange(aset)
    measures = merge_pickups(bars, aset.voice_names)
    sc = build_score(aset, measures)
    out_dir = out_dir or (ROOT / "output" / aset.id)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = write_outputs(sc, out_dir / aset.id, preview=preview)
    rep = report(aset, bars, measures)
    (out_dir / "report.md").write_text(rep)
    paths["report"] = out_dir / "report.md"
    (out_dir / "parts.abc.txt").write_text(freeze_text(aset, bars))
    paths["abc"] = out_dir / "parts.abc.txt"
    for tid, tune in aset.tunes.items():
        (out_dir / f"analysis-{tid}.json").write_text(tune_analysis(tune))
    return paths


def main(argv=None):
    ap = argparse.ArgumentParser(prog="fiddlekit")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="arrange a set and write MusicXML/MIDI/PDF/report")
    b.add_argument("sets", nargs="+", type=Path)
    b.add_argument("--no-preview", action="store_true")
    a = sub.add_parser("analyse", help="print chord/tension analysis for a tune")
    a.add_argument("tune")
    args = ap.parse_args(argv)
    if args.cmd == "build":
        for s in args.sets:
            paths = build(s, preview=not args.no_preview)
            for k, v in paths.items():
                print(f"{k:9s} {v}")
    elif args.cmd == "analyse":
        print(tune_analysis(load_tune(args.tune)))


if __name__ == "__main__":
    sys.exit(main())
