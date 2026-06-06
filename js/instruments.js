/* instruments.js — piano keyboard & string fretboard: layout, draw, hit-test.
   All geometry is in CSS pixels; the canvas context is pre-scaled for DPR. */
(function (App) {
  'use strict';

  const T = App.Theory;
  const PAL = {
    keyWhite: '#f6f7fb', keyWhiteEdge: '#c9ccd6', keyBlack: '#23262e',
    text: '#9aa3b2', textStrong: '#e8ecf4',
    good: '#2fd07a', bad: '#ff5d6c', hint: '#4aa8ff',
    wood1: '#3a2c22', wood2: '#241b15', fret: '#6b7280', string: '#d8d2c4',
    marker: 'rgba(255,255,255,0.10)', markerEdge: 'rgba(255,255,255,0.18)',
    inlay: 'rgba(255,255,255,0.22)',
  };

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- Instrument definitions --------------------------------------------
  // Strings are listed low pitch -> high pitch (written/concert MIDI).
  const DEFS = {
    piano: { kind: 'piano', name: 'Piano', icon: '🎹', clef: 'treble',
      whiteLoMidi: 60, whiteHiMidi: 84 /* C4..C6 */ },
    pianoBass: { kind: 'piano', name: 'Piano', icon: '🎹', clef: 'bass',
      whiteLoMidi: 36, whiteHiMidi: 60 /* C2..C4 */ },
    pianoGrand: { kind: 'pianoGrand', name: 'Piano', icon: '🎹', clef: 'grand',
      whiteLoMidi: 36, whiteHiMidi: 84 /* C2..C6, split across two keyboards */,
      splitMidi: 60 /* C4: bottom row below, top row at/above */ },
    guitar: { kind: 'fretboard', name: 'Guitar', icon: '🎸', clef: 'treble',
      fretted: true, frets: 12,
      strings: [52, 57, 62, 67, 71, 76], stringNames: ['E', 'A', 'D', 'G', 'B', 'e'] },
    violin: { kind: 'fretboard', name: 'Violin', icon: '🎻', clef: 'treble',
      fretted: false, frets: 12,
      strings: [55, 62, 69, 76], stringNames: ['G', 'D', 'A', 'E'] },
  };

  const sharpLetters = new Set(['C', 'D', 'F', 'G', 'A']);

  class Instrument {
    constructor(key) {
      this.def = DEFS[key];
      this.key = key;
      this.cells = [];          // {id, midi, x,y,w,h, label, isBlack, string, fret}
      this.flashes = new Map(); // id -> {color, until}
      this.highlight = null;    // midi to highlight for hint mode
      this.rect = { x: 0, y: 0, w: 0, h: 0 };
      this._buildNotePool();
    }

    // All spellable notes physically available on this instrument, by MIDI.
    _buildNotePool() {
      const d = this.def;
      const isPiano = d.kind === 'piano' || d.kind === 'pianoGrand';
      let lo, hi;
      if (isPiano) { lo = d.whiteLoMidi; hi = d.whiteHiMidi; }
      else {
        lo = Math.min(...d.strings);
        hi = Math.max(...d.strings) + d.frets;
      }
      const reachable = new Set();
      if (isPiano) {
        for (let m = lo; m <= hi; m++) reachable.add(m);
      } else {
        d.strings.forEach((open) => {
          for (let f = 0; f <= d.frets; f++) reachable.add(open + f);
        });
      }
      this.minMidi = lo;
      this.maxMidi = hi;
      this.reachable = reachable; // every chromatic midi in [lo,hi] is playable here
      const naturals = T.naturalsInRange(lo, hi).filter((n) => reachable.has(n.midi));
      const sharps = T.sharpsInRange(lo, hi).filter((n) => reachable.has(n.midi));
      this.naturals = naturals;
      this.allNotes = naturals.concat(sharps).sort((a, b) => a.midi - b.midi);
      // center MIDI used for "easy" range narrowing
      this.center = naturals[Math.floor(naturals.length / 2)].midi;
    }

    layout(rect) {
      this.rect = rect;
      this.cells = [];
      if (this.def.kind === 'piano' || this.def.kind === 'pianoGrand') this._layoutPiano();
      else this._layoutFretboard();
    }

    _layoutPiano() {
      const { x, y, w, h } = this.rect;
      // one keyboard normally; two stacked keyboards for the grand piano so the
      // full C2..C6 range fits comfortably (upper register on top).
      const split = this.def.splitMidi;
      const ranges = this.def.kind === 'pianoGrand'
        ? [{ lo: split, hi: this.def.whiteHiMidi }, { lo: this.def.whiteLoMidi, hi: split - 1 }]
        : [{ lo: this.def.whiteLoMidi, hi: this.def.whiteHiMidi }];
      const gapY = ranges.length > 1 ? 6 : 0;
      const rowH = (h - gapY * (ranges.length - 1)) / ranges.length;

      ranges.forEach((rg, ri) => {
        const ry = y + ri * (rowH + gapY);
        const whites = this.naturals.filter((nt) => nt.midi >= rg.lo && nt.midi <= rg.hi);
        if (!whites.length) return;
        const kw = w / whites.length;
        const blackW = kw * 0.62;
        const blackH = rowH * 0.62;
        whites.forEach((note, i) => {
          this.cells.push({
            id: 'w' + note.midi, midi: note.midi, isBlack: false,
            x: x + i * kw, y: ry, w: kw, h: rowH, label: note.label + note.octave,
          });
        });
        whites.forEach((note, i) => {
          if (!sharpLetters.has(note.letter)) return;
          const sharpMidi = note.midi + 1;
          if (sharpMidi > rg.hi) return;
          const cx = x + (i + 1) * kw;
          this.cells.push({
            id: 'b' + sharpMidi, midi: sharpMidi, isBlack: true,
            x: cx - blackW / 2, y: ry, w: blackW, h: blackH,
            label: note.label + '♯' + note.octave,
          });
        });
      });
    }

    _layoutFretboard() {
      const d = this.def;
      const { x, y, w, h } = this.rect;
      const labelGutter = Math.min(34, w * 0.06);
      const numStrip = Math.min(22, h * 0.16);
      const boardX = x + labelGutter;
      const boardW = w - labelGutter;
      const boardY = y;
      const boardH = h - numStrip;
      const cols = d.frets + 1;            // fret 0 (open) .. frets
      const colW = boardW / cols;
      const rows = d.strings.length;
      const rowH = boardH / rows;
      this._geo = { boardX, boardW, boardY, boardH, colW, rowH, cols, rows, labelGutter, numStrip };
      // Display rows: highest string on top (TAB convention) -> reverse index.
      for (let r = 0; r < rows; r++) {
        const stringIdx = rows - 1 - r;    // top row = highest pitch
        const open = d.strings[stringIdx];
        for (let f = 0; f < cols; f++) {
          this.cells.push({
            id: 's' + stringIdx + 'f' + f, midi: open + f,
            string: stringIdx, fret: f,
            x: boardX + f * colW, y: boardY + r * rowH, w: colW, h: rowH,
            cx: boardX + f * colW + colW / 2, cy: boardY + r * rowH + rowH / 2,
          });
        }
      }
    }

    setHighlight(midi) { this.highlight = midi; }

    flashCell(id, color) {
      this.flashes.set(id, { color, until: performance.now() + 280 });
    }
    flashMidi(midi, color) {
      this.cells.filter((c) => c.midi === midi).forEach((c) => this.flashCell(c.id, color));
    }

    cellsForMidi(midi) { return this.cells.filter((c) => c.midi === midi); }

    hitTest(px, py) {
      // black keys sit on top of whites — test them first
      const blacks = this.cells.filter((c) => c.isBlack);
      for (const c of blacks) if (inRect(px, py, c)) return c;
      for (const c of this.cells) {
        if (c.isBlack) continue;
        if (inRect(px, py, c)) return c;
      }
      return null;
    }

    draw(ctx) {
      if (this.def.kind === 'piano' || this.def.kind === 'pianoGrand') this._drawPiano(ctx);
      else this._drawFretboard(ctx);
    }

    _flashColor(id, now) {
      const f = this.flashes.get(id);
      if (f && f.until > now) return f.color;
      if (f) this.flashes.delete(id);
      return null;
    }

    _drawPiano(ctx) {
      const now = performance.now();
      const hint = this.highlight;
      // whites
      this.cells.filter((c) => !c.isBlack).forEach((c) => {
        const flash = this._flashColor(c.id, now);
        rr(ctx, c.x + 1, c.y, c.w - 2, c.h, 7);
        if (flash) ctx.fillStyle = flash === 'good' ? PAL.good : PAL.bad;
        else if (hint === c.midi) ctx.fillStyle = PAL.hint;
        else ctx.fillStyle = PAL.keyWhite;
        ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = PAL.keyWhiteEdge; ctx.stroke();
        if (this._showLabels || hint === c.midi) {
          ctx.fillStyle = (hint === c.midi || flash) ? '#fff' : PAL.text;
          ctx.font = `600 ${Math.min(13, c.w * 0.42)}px ui-sans-serif,system-ui`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(c.label, c.x + c.w / 2, c.y + c.h - 8);
        }
      });
      // blacks
      this.cells.filter((c) => c.isBlack).forEach((c) => {
        const flash = this._flashColor(c.id, now);
        rr(ctx, c.x, c.y, c.w, c.h, 5);
        if (flash) ctx.fillStyle = flash === 'good' ? PAL.good : PAL.bad;
        else if (hint === c.midi) ctx.fillStyle = PAL.hint;
        else ctx.fillStyle = PAL.keyBlack;
        ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.stroke();
      });
    }

    _drawFretboard(ctx) {
      const now = performance.now();
      const g = this._geo;
      const d = this.def;
      const { x, y, w, h } = this.rect;
      // board background
      const grad = ctx.createLinearGradient(0, g.boardY, 0, g.boardY + g.boardH);
      grad.addColorStop(0, PAL.wood1); grad.addColorStop(1, PAL.wood2);
      ctx.fillStyle = grad;
      rr(ctx, g.boardX, g.boardY, g.boardW, g.boardH, 6);
      ctx.fill();

      // fretless watermark (behind strings/markers) for bowed instruments
      if (!d.fretted) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.font = `800 ${Math.min(22, g.boardH * 0.2)}px ui-sans-serif,system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('FRETLESS · GUIDE POSITIONS', g.boardX + g.boardW / 2, g.boardY + g.boardH / 2);
        ctx.restore();
      }

      // fret position inlays (single at 3,5,7,9 ; double at 12)
      const inlayFrets = [3, 5, 7, 9, 12].filter((f) => f <= d.frets);
      ctx.fillStyle = PAL.inlay;
      inlayFrets.forEach((f) => {
        const cx = g.boardX + f * g.colW + g.colW / 2;
        const midY = g.boardY + g.boardH / 2;
        if (f === 12) {
          [g.boardH * 0.3, g.boardH * 0.7].forEach((off) => {
            ctx.beginPath(); ctx.arc(cx, g.boardY + off, 4, 0, 7); ctx.fill();
          });
        } else {
          ctx.beginPath(); ctx.arc(cx, midY, 4, 0, 7); ctx.fill();
        }
      });

      // fret lines (vertical). Nut after column 0 is thick.
      for (let f = 1; f <= d.frets; f++) {
        const fx = g.boardX + f * g.colW;
        ctx.strokeStyle = PAL.fret;
        ctx.lineWidth = f === 1 ? 4 : 2;
        if (!d.fretted) { ctx.setLineDash([4, 5]); ctx.lineWidth = 1.5; }
        ctx.beginPath(); ctx.moveTo(fx, g.boardY); ctx.lineTo(fx, g.boardY + g.boardH); ctx.stroke();
        ctx.setLineDash([]);
      }

      // strings (horizontal). Lower strings drawn thicker.
      for (let r = 0; r < g.rows; r++) {
        const stringIdx = g.rows - 1 - r;
        const sy = g.boardY + r * g.rowH + g.rowH / 2;
        ctx.strokeStyle = PAL.string;
        ctx.lineWidth = 1 + (g.rows - 1 - stringIdx) * 0.5;
        ctx.beginPath(); ctx.moveTo(g.boardX, sy); ctx.lineTo(g.boardX + g.boardW, sy); ctx.stroke();
        // string name label
        ctx.fillStyle = PAL.text;
        ctx.font = `600 ${Math.min(13, g.rowH * 0.4)}px ui-sans-serif,system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(d.stringNames[stringIdx], x + g.labelGutter / 2, sy);
      }

      // cell markers (tap targets) + flashes + hint highlight
      this.cells.forEach((c) => {
        const flash = this._flashColor(c.id, now);
        const isHint = this.highlight === c.midi;
        const rad = Math.min(c.w, c.h) * 0.34;
        if (flash || isHint) {
          ctx.beginPath(); ctx.arc(c.cx, c.cy, rad, 0, 7);
          ctx.fillStyle = flash ? (flash === 'good' ? PAL.good : PAL.bad) : PAL.hint;
          ctx.fill();
          if (this._showLabels || isHint || flash) {
            const nm = App.Theory.makeNote; // label by letter only
            ctx.fillStyle = '#fff';
            ctx.font = `700 ${rad}px ui-sans-serif,system-ui`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(midiLetter(c.midi), c.cx, c.cy + 1);
          }
        } else {
          ctx.beginPath(); ctx.arc(c.cx, c.cy, rad * 0.78, 0, 7);
          ctx.fillStyle = PAL.marker; ctx.fill();
          ctx.lineWidth = 1; ctx.strokeStyle = PAL.markerEdge; ctx.stroke();
        }
      });

      // fret numbers
      ctx.fillStyle = PAL.text;
      ctx.font = `600 ${Math.min(12, g.numStrip * 0.7)}px ui-sans-serif,system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let f = 0; f <= d.frets; f++) {
        const cx = g.boardX + f * g.colW + g.colW / 2;
        ctx.fillText(String(f), cx, y + h - g.numStrip / 2);
      }
    }

    setShowLabels(v) { this._showLabels = v; }
  }

  function inRect(px, py, c) {
    return px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h;
  }
  // letter name (with sharp) for a midi, treble-friendly spelling
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  function midiLetter(midi) { return NAMES[((midi % 12) + 12) % 12]; }

  App.Instruments = { DEFS, Instrument, midiLetter };
})(window.App = window.App || {});
