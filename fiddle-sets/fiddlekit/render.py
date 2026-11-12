"""Measures → music21 score → MusicXML / MIDI, plus Verovio previews."""
from __future__ import annotations

import copy
from fractions import Fraction as F
from pathlib import Path

from music21 import (articulations, bar as m21bar, clef, duration, dynamics, expressions,
                     harmony, instrument as m21inst, key as m21key, layout, metadata,
                     meter, note, chord as m21chord, spanner, stream, tempo, tie)

from .instruments import INSTRUMENTS

ART = {"staccato": articulations.Staccato, "accent": articulations.Accent,
       "tenuto": articulations.Tenuto, "upbow": articulations.UpBow,
       "downbow": articulations.DownBow}
ORN = {"roll": expressions.Turn, "trill": expressions.Trill}


def _timesig(ts: str) -> meter.TimeSignature:
    t = meter.TimeSignature(ts)
    if ts in ("4/4", "2/2"):
        # fiddle-music convention: beam reels in groups of four quavers
        t.beamSequence = meter.MeterSequence("4/4")
        t.beamSequence.partition(["1/2", "1/2"])
        for i in range(2):
            t.beamSequence[i] = t.beamSequence[i].subdivide(["1/8"] * 4)
    return t


def _ql_parts(ql: F) -> list[F]:
    """Split awkward durations (5/2, 7/4 …) into notatable tied pieces."""
    ok = {F(4), F(3), F(2), F(3, 2), F(1), F(3, 4), F(1, 2), F(3, 8), F(1, 4), F(1, 8),
          F(6), F(7, 2), F(7, 4), F(7, 8)}
    if ql in ok or ql.denominator % 3 == 0 or ql.denominator % 5 == 0:
        return [ql]
    parts = []
    rem = ql
    for v in sorted(ok, reverse=True):
        while rem >= v and v not in (F(7, 2), F(7, 4), F(7, 8), F(6)):
            parts.append(v)
            rem -= v
    if rem:
        parts.append(rem)
    return parts


def build_score(aset, measures, *, chord_symbols=True) -> stream.Score:
    voices = aset.voice_names
    sc = stream.Score()
    md = metadata.Metadata()
    # MuseScore builds its title block from movement-title (title), the
    # composer creator (right) and the lyricist creator (left).
    md.title = aset.title
    md.movementName = aset.title
    if aset.data.get("subtitle"):
        md.lyricist = aset.data["subtitle"]
    md.composer = aset.data.get("credit", "Traditional · arranged for two violins")
    sc.metadata = md
    note_refs = {v: [] for v in voices}  # per measure: list of note objects
    for vi, v in enumerate(voices):
        vinfo = aset.voices[v]
        inst = INSTRUMENTS[vinfo.get("instrument", "violin")]
        part = stream.Part(id=v)
        mi = getattr(m21inst, inst.music21_class)()
        mi.partName = vinfo.get("name", v)
        mi.partAbbreviation = vinfo.get("abbrev", inst.abbrev)
        part.insert(0, mi)
        part.partName = mi.partName
        prev_meter, prev_key = None, None
        prev_tie = False
        open_slur = None
        last_chord = None
        pending_hairpins = []
        for mi_idx, M in enumerate(measures):
            b0 = M["bars"][0]
            m = stream.Measure(number=mi_idx + (0 if measures[0]["anacrusis"] else 1))
            if mi_idx == 0:
                m.insert(0, {"treble": clef.TrebleClef, "alto": clef.AltoClef,
                             "bass": clef.BassClef}[inst.clef]())
            if M["key"] != prev_key:
                m.insert(0, m21key.KeySignature(M["key"].sharps))
                prev_key = M["key"]
            if M["meter"] != prev_meter:
                m.insert(0, _timesig(M["meter"]))
                prev_meter = M["meter"]
            if M["anacrusis"]:
                m.paddingLeft = float(M["full"] - M["length"])
            # system breaks before each tune / transition (not the first)
            if vi == 0 and mi_idx > 0 and (b0.item_start or any(pb.item_start for _, pb in M["pickup_bars"])):
                if not any(pb.item_start for _, pb in M["pickup_bars"]):
                    m.insert(0, layout.SystemLayout(isNew=True))
            refs = []
            for e in M["out"][v]:
                pieces = _ql_parts(e.dur)
                t = e.off
                for pi, ql in enumerate(pieces):
                    last_piece = pi == len(pieces) - 1
                    if e.is_rest:
                        n = note.Rest(quarterLength=ql)
                        if e.hidden:
                            n.style.hideObjectOnPrint = True
                    else:
                        if len(e.pitches) == 1:
                            n = note.Note(copy.deepcopy(e.pitches[0]), quarterLength=ql)
                        else:
                            n = m21chord.Chord([copy.deepcopy(p) for p in e.pitches], quarterLength=ql)
                        starts_tie = (e.tie and last_piece) or not last_piece
                        if prev_tie and starts_tie:
                            n.tie = tie.Tie("continue")
                        elif prev_tie:
                            n.tie = tie.Tie("stop")
                        elif starts_tie:
                            n.tie = tie.Tie("start")
                        prev_tie = starts_tie
                        if pi == 0:
                            for a in e.arts:
                                if a in ART:
                                    n.articulations.append(ART[a]())
                            for o in e.orns:
                                if o in ORN:
                                    n.expressions.append(ORN[o]())
                    if e.is_rest:
                        prev_tie = False
                    if last_piece and "fermata" in e.orns:
                        n.expressions.append(expressions.Fermata())
                    if pi == 0 and e.grace and not e.is_rest:
                        for g in e.grace:
                            gn = note.Note(copy.deepcopy(g)).getGrace()
                            gn.duration.slash = True
                            m.insert(t, gn)
                    m.insert(t, n)
                    if pi == 0:
                        if e.slur_start and not e.is_rest:
                            open_slur = n
                        if e.dyn:
                            m.insert(t, dynamics.Dynamic(e.dyn))
                        if e.text:
                            m.insert(t, expressions.TextExpression(e.text))
                    if last_piece and e.slur_stop and open_slur is not None and not e.is_rest:
                        if open_slur is not n:
                            part.insert(0, spanner.Slur(open_slur, n))
                        open_slur = None
                    refs.append(n)
                    t += ql
            note_refs[v].append(refs)
            # dynamics / text / marks from bars (incl. spliced pickups)
            for cut, bb in [(F(0), b) for b in M["bars"]] + M["pickup_bars"]:
                if v in bb.dyn:
                    m.insert(cut, dynamics.Dynamic(bb.dyn[v]))
                for (vv, typ, a, z) in bb.hairpins:
                    if vv == v:
                        pending_hairpins.append((mi_idx, mi_idx + (z - a), typ))
                if vi == 0:
                    if bb.title:
                        te = expressions.TextExpression(bb.title)
                        te.style.fontWeight = "bold"
                        te.style.fontSize = 12
                        te.placement = "above"
                        m.insert(cut, te)
                    if bb.tempo:
                        tp = bb.tempo
                        ref = duration.Duration(tp.get("beat_ql", 1.0))
                        mm = tempo.MetronomeMark(number=tp.get("bpm"), referent=ref)
                        mm.placement = "above"
                        m.insert(cut, mm)
                        if tp.get("text"):
                            tt = expressions.TextExpression(tp["text"])
                            tt.style.fontWeight = "bold"
                            tt.placement = "above"
                            m.insert(cut, tt)
                    if bb.rehearsal:
                        rm = expressions.RehearsalMark(bb.rehearsal)
                        rm.placement = "above"
                        m.insert(cut, rm)
                    for off, txt in bb.texts:
                        te = expressions.TextExpression(txt)
                        te.style.fontStyle = "italic"
                        te.placement = "above"
                        m.insert(cut + off, te)
            # chord symbols (first voice only), printed when they change
            if vi == 0 and chord_symbols:
                for off, sym in M["chords"]:
                    if sym != last_chord or (off == 0 and b0.item_start):
                        cs = harmony.ChordSymbol(sym)
                        cs.writeAsChord = False
                        m.insert(off, cs)
                        last_chord = sym
            # barlines
            nxt = measures[mi_idx + 1] if mi_idx + 1 < len(measures) else None
            if nxt is None:
                m.rightBarline = m21bar.Barline("final")
            elif nxt["bars"][0].section_start or nxt["bars"][0].item_start or \
                    (nxt["anacrusis"] is False and any(pb.part_bar == 0 for _, pb in M["pickup_bars"])):
                m.rightBarline = m21bar.Barline("double")
            part.append(m)
        # hairpins
        for a, z, typ in pending_hairpins:
            if a < len(note_refs[v]) and z < len(note_refs[v]):
                first = [n for n in note_refs[v][a] if not n.isRest] or note_refs[v][a]
                last = [n for n in note_refs[v][z] if not n.isRest] or note_refs[v][z]
                if first and last:
                    sp = dynamics.Crescendo(first[0], last[-1]) if typ == "cresc" else \
                        dynamics.Diminuendo(first[0], last[-1])
                    part.insert(0, sp)
        sc.insert(0, part)
    return sc


def write_outputs(sc: stream.Score, out_base: Path, preview: bool = True) -> dict:
    out_base.parent.mkdir(parents=True, exist_ok=True)
    paths = {}
    xml = out_base.with_suffix(".musicxml")
    sc.write("musicxml", fp=str(xml))
    paths["musicxml"] = xml
    mid = out_base.with_suffix(".mid")
    try:
        sc.write("midi", fp=str(mid))
        paths["midi"] = mid
    except Exception as ex:  # pragma: no cover
        print("MIDI export failed:", ex)
    if preview:
        ms = musescore_export(xml, out_base)
        paths.update(ms)
        if "pdf" not in ms:
            paths.update(render_preview(xml, out_base))
    return paths


def musescore_export(xml: Path, out_base: Path) -> dict:
    """If MuseScore is installed, export the engraved PDF and a native .mscz."""
    import os
    import shutil
    import subprocess
    import tempfile
    exe = next((shutil.which(x) for x in ("mscore4", "mscore", "mscore3", "musescore3",
                                         "musescore") if shutil.which(x)), None)
    if not exe:
        return {}
    env = dict(os.environ, QT_QPA_PLATFORM="offscreen")
    env.setdefault("XDG_RUNTIME_DIR", tempfile.mkdtemp())
    os.chmod(env["XDG_RUNTIME_DIR"], 0o700)
    out = {}
    for suffix in (".pdf", ".mscz"):
        target = out_base.with_suffix(suffix)
        try:
            subprocess.run([exe, "-o", str(target), str(xml)], env=env, check=True,
                           capture_output=True, timeout=300)
            out[suffix[1:]] = target
        except Exception as ex:  # pragma: no cover
            print(f"MuseScore export {suffix} failed: {ex}")
    return out


def render_preview(xml: Path, out_base: Path) -> dict:
    import verovio
    import cairosvg
    tk = verovio.toolkit()
    tk.setOptions({"pageWidth": 2100, "pageHeight": 2970, "scale": 45,
                   "pageMarginLeft": 80, "pageMarginRight": 80, "pageMarginTop": 60,
                   "footer": "none", "breaks": "smart", "spacingSystem": 10,
                   "header": "auto", "mmOutput": False})
    tk.loadFile(str(xml))
    n = tk.getPageCount()
    pdfs = []
    pngdir = out_base.parent / (out_base.name + "_pages")
    pngdir.mkdir(exist_ok=True)
    for old in pngdir.glob("*.png"):
        old.unlink()
    for p in range(1, n + 1):
        svg = tk.renderToSVG(p)
        pdf = pngdir / f"page{p}.pdf"
        cairosvg.svg2pdf(bytestring=svg.encode(), write_to=str(pdf))
        cairosvg.svg2png(bytestring=svg.encode(), write_to=str(pngdir / f"page{p}.png"),
                         output_width=1400, background_color="white")
        pdfs.append(pdf)
    from pypdf import PdfWriter
    w = PdfWriter()
    for p in pdfs:
        w.append(str(p))
    pdf_out = out_base.with_suffix(".pdf")
    with open(pdf_out, "wb") as fh:
        w.write(fh)
    for p in pdfs:
        p.unlink()
    return {"pdf": pdf_out, "pages": pngdir}
