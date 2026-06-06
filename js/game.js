/* game.js — staff rendering, scrolling notes, scoring, streaks, lives.
   Game is a state machine; the UI owns the rAF loop and visual/audio feedback. */
(function (App) {
  'use strict';

  const T = App.Theory;
  const STAFF = {
    line: '#cbd2e0', lineDim: 'rgba(203,210,224,0.35)',
    note: '#e8ecf4', noteActive: '#ffd24a', accidental: '#e8ecf4',
    clef: '#aeb6c6', danger: 'rgba(255,93,108,0.18)', playLine: 'rgba(255,93,108,0.55)',
  };

  // Tempo presets (BPM). Scroll speed derives from BPM × pixels-per-beat, so
  // horizontal spacing reflects each note's rhythmic duration.
  // Read speed = target NOTE ONSETS PER SECOND (not BPM). The effective tempo is
  // normalised by each tune's average note duration, so dense tunes auto-slow to
  // hit the same notes/second — i.e. a steady stream of ~1 note/s regardless of
  // whether the tune is in eighths or quarters.
  const NPS_PRESETS = { relaxed: 0.25, steady: 0.5, brisk: 1, intense: 2 }; // notes/sec
  // average on-screen spacing between consecutive notes (px), scaled to width.
  const NOTE_SPACING_FRAC = 0.2;     // ~5 notes visible across the staff
  const PHRASE_GAP_UNITS = 1.5;      // extra blank note-slots between phrases
  // "lick" rhythm patterns (in quarter-note beats) used for random / generated
  // notes and any lick that doesn't carry its own rhythm.
  const RHYTHM_PATTERNS = [
    [1, 1, 1, 1], [0.5, 0.5, 1], [1, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5],
    [1.5, 0.5], [1, 1, 0.5, 0.5], [0.5, 0.5, 1, 1], [2, 1, 1], [1, 1, 2],
    [2, 2], [1, 0.5, 0.5, 1], [0.5, 1, 0.5, 1, 1],
  ];
  const PATTERN_AVG_DUR = RHYTHM_PATTERNS.flat().reduce((a, b) => a + b, 0) / RHYTHM_PATTERNS.flat().length;

  // staff positions (letter, octave) for key-signature accidentals, in circle-of-
  // fifths order, per clef.
  const KS_TREBLE = { sharp: [['F', 5], ['C', 5], ['G', 5], ['D', 5], ['A', 4], ['E', 5], ['B', 4]], flat: [['B', 4], ['E', 5], ['A', 4], ['D', 5], ['G', 4], ['C', 5], ['F', 4]] };
  const KS_BASS = { sharp: [['F', 3], ['C', 3], ['G', 3], ['D', 3], ['A', 2], ['E', 3], ['B', 2]], flat: [['B', 2], ['E', 3], ['A', 2], ['D', 3], ['G', 2], ['C', 3], ['F', 2]] };
  function drawKeySig(ctx, fifths, ks, x0, dx, yFor, gap, color) {
    if (!fifths) return;
    const arr = fifths > 0 ? ks.sharp : ks.flat;
    const n = Math.min(Math.abs(fifths), 7);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${gap * 2.4}px "Bravura","Noto Music",serif`;
    for (let i = 0; i < n; i++) ctx.fillText(fifths > 0 ? '♯' : '♭', x0 + i * dx, yFor(T.stepOf(arr[i][0], arr[i][1])));
  }
  // glyph for a note's accidental relative to a key signature (null = none shown)
  function accidentalGlyph(accidental, keyAcc) {
    if (accidental === keyAcc) return null;        // covered by key signature
    if (accidental === 0) return '♮';              // natural cancels a key accidental
    return accidental === 1 ? '♯' : '♭';
  }

  class Game {
    constructor() {
      this.reset();
      this.settings = {
        speed: 'steady', difficulty: 'medium', livesMode: false,
        lives: 3, showHints: false, sound: true,
        mode: 'random', genre: 'blues', randomKey: false,
        timeSig: '4/4',
      };
    }

    reset() {
      this.notes = [];
      this.score = 0; this.streak = 0; this.bestStreak = 0;
      this.hits = 0; this.misses = 0; this.attempts = 0;
      this.lives = 3;
      this.status = 'idle'; // idle | playing | paused | over
      this.spawnAcc = 0;
      this.lastTime = 0;
      this.peakScore = 0;
      this.queue = [];               // upcoming notes to spawn
      this.currentLickName = '';
      this.currentLickSource = '';
      this._beatPos = 0;             // cumulative beats (for bar lines)
      this._gapUnits = 1;            // note-slots until the next spawn (× spacing)
      this._avgDur = PATTERN_AVG_DUR; // avg note duration of current tune
      this._rhythmBuf = [];          // streamed rhythm pattern
      this.key = T.keySig(0);        // current key signature (C major)
      this._metroBeats = 0;          // real-time beat accumulator (metronome)
    }

    _barBeats() {
      const m = /(\d+)\s*\/\s*(\d+)/.exec(this.settings.timeSig || '4/4');
      if (!m) return 4;
      return (+m[1]) * 4 / (+m[2]); // bar length in quarter-note beats
    }
    _nextDur() {
      if (!this._rhythmBuf.length) this._rhythmBuf = RHYTHM_PATTERNS[(Math.random() * RHYTHM_PATTERNS.length) | 0].slice();
      return this._rhythmBuf.shift();
    }

    configure(instrument, settings) {
      this.instrument = instrument;
      Object.assign(this.settings, settings || {});
      const clefName = instrument.def.clef;
      this.clef = clefName === 'grand' ? { grand: true } : T.CLEFS[clefName];
      this.mode = this.settings.mode || 'random';
      // random mode: optionally a random key signature (else C major)
      if (this.mode === 'random') {
        const fifths = this.settings.randomKey ? ([-4, -3, -2, -1, 0, 1, 2, 3, 4][(Math.random() * 9) | 0]) : 0;
        this.key = T.keySig(fifths);
      } else {
        this.key = T.keySig(0);
      }
      this._buildPool();
      if (this.mode === 'licks') this._loadGenre(this.settings.genre);
    }

    // store raw (untransposed) licks; transposition happens per phrase at spawn
    // time so random-key can pick a fresh key each phrase.
    _loadGenre(genre) {
      this._licks = App.Licks ? App.Licks.get(genre) : [];
      this._lastLickIdx = -1;
    }

    _randSemis() {
      const opts = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7];
      return opts[(Math.random() * opts.length) | 0];
    }

    _buildPool() {
      // build the random-note pool in the current key: diatonic notes (covered by
      // the key signature, no accidental) plus, on harder settings, chromatic
      // notes that render with an accidental or natural.
      const inst = this.instrument;
      const fifths = this.key ? this.key.fifths : 0;
      const accMap = this.key ? this.key.accMap : {};
      const dia = [], chrom = [];
      for (let m = inst.minMidi; m <= inst.maxMidi; m++) {
        if (!inst.reachable.has(m)) continue;
        const n = T.spellMidiInKey(m, fifths);
        if (n.accidental === (accMap[n.letter] || 0)) dia.push(n); else chrom.push(n);
      }
      const d = this.settings.difficulty;
      let pool;
      if (d === 'easy') {
        const mid = Math.floor(dia.length / 2); const span = 4;
        pool = dia.slice(Math.max(0, mid - span), mid + span + 1);
      } else if (d === 'hard') {
        pool = dia.concat(chrom);            // accidentals/naturals appear freely
      } else {
        pool = dia.concat(chrom.filter(() => Math.random() < 0.22)); // occasional accidentals
      }
      this.pool = pool.length >= 2 ? pool : dia.slice();
      if (this.pool.length < 2) this.pool = inst.naturals.slice();
    }

    start() {
      this.reset();
      this.lives = this.settings.lives;
      this.status = 'playing';
      this.spawnAcc = 0;
      this.lastTime = 0;
      this._refillQueue();
      this._spawn(); // ensure one note on screen immediately
    }

    pause() { if (this.status === 'playing') this.status = 'paused'; }
    resume() { if (this.status === 'paused') { this.status = 'playing'; this.lastTime = 0; } }

    _randNote() {
      const p = this.pool;
      let n = p[(Math.random() * p.length) | 0];
      // avoid immediate repeat of the previous spawn
      if (this._lastSpawn && p.length > 2) {
        let guard = 0;
        while (n.midi === this._lastSpawn && guard++ < 4) n = p[(Math.random() * p.length) | 0];
      }
      this._lastSpawn = n.midi;
      return n;
    }

    // Ensure there is at least one upcoming note queued.
    _refillQueue() {
      if (this.mode === 'licks') {
        if (this.queue.length === 0) this._loadNextLick();
      } else {
        while (this.queue.length < 2) this.queue.push({ note: this._randNote(), dur: this._nextDur(), fifths: this.key.fifths });
      }
    }

    _loadNextLick() {
      const arr = this._licks;
      if (!arr || !arr.length) { this.queue.push({ note: this._randNote(), dur: this._nextDur() }); return; }
      let idx = (Math.random() * arr.length) | 0;
      if (arr.length > 1) { let g = 0; while (idx === this._lastLickIdx && g++ < 5) idx = (Math.random() * arr.length) | 0; }
      this._lastLickIdx = idx;
      const l = arr[idx];
      // thin song record from the sharded corpus — expand its MIDI/dur arrays now
      let baseNotes = l.notes, baseDurs = l.durs;
      if (!baseNotes && l._p) {
        baseNotes = l._p.split(',').map((m) => T.spellMidi(+m));
        baseDurs = l._d.split(',').map((x) => +x / (l._res || 4));
      }
      const semis = this.settings.randomKey ? this._randSemis() : 0;
      const transposed = App.Licks.transposeToInstrument(baseNotes, this.instrument, semis);
      // pick the key signature that best fits this phrase, then respell every note
      // in that key so the key signature covers the diatonic notes.
      const midis = transposed.map((n) => n.midi);
      const fifths = T.estimateFifths(midis);
      this.key = T.keySig(fifths);
      const notes = midis.map((m) => T.spellMidiInKey(m, fifths));
      // fixed duration array for the whole phrase (real rhythm, or generated)
      const durs = (baseDurs && baseDurs.length === baseNotes.length)
        ? baseDurs : notes.map(() => this._nextDur());
      // tune's average duration drives the tempo normalisation (dense → slower)
      const mean = durs.reduce((a, b) => a + b, 0) / (durs.length || 1);
      this._avgDur = Math.max(0.25, Math.min(4, mean));
      const source = l.source + (semis ? ' · transposed' : '');
      notes.forEach((n, i) => this.queue.push({
        note: n, dur: durs[i] || 1, fifths,
        phraseStart: i === 0,
        lickName: i === 0 ? l.name : null, lickSource: i === 0 ? source : null,
      }));
    }

    _spawn() {
      this._refillQueue();
      const item = this.queue.shift();
      if (!item) return;
      if (item.phraseStart && item.lickName) {
        this.currentLickName = item.lickName;
        this.currentLickSource = item.lickSource;
      }
      const dur = item.dur || 1;
      const barBeats = this._barBeats();
      const pos = this._beatPos % barBeats;
      const onBar = this._beatPos > 1e-6 && (pos < 1e-4 || barBeats - pos < 1e-4);
      this.notes.push({ note: item.note, x: 0, spawnedRight: true, dur, barline: onBar, fifths: item.fifths != null ? item.fifths : (this.key ? this.key.fifths : 0) });
      this._beatPos += dur;
      const next = this.queue[0];
      // gap to next onset in "note-slot" units: this note's relative length plus
      // an inter-phrase rest. × NOTE_SPACING px (set in update) gives the distance.
      this._gapUnits = (dur / this._avgDur) + (next && next.phraseStart ? PHRASE_GAP_UNITS : 0);
    }

    get active() { return this.notes.length ? this.notes[0] : null; }

    accuracy() { return this.attempts ? Math.round((this.hits / this.attempts) * 100) : 100; }
    multiplier() { return Math.min(5, 1 + Math.floor(this.streak / 5)); }

    // Advance simulation. Returns events: {type:'miss'|'gameover', note?}
    update(now, rect) {
      const events = [];
      if (this.status !== 'playing') { this.lastTime = now; this._highlight(); return events; }
      if (!this.lastTime) this.lastTime = now;
      let dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (dt > 0.1) dt = 0.1; // clamp after tab switch

      // notes/second target → constant scroll velocity = spacing × notes-per-sec.
      // (Average onset rate = nps regardless of the tune's note density.)
      const nps = NPS_PRESETS[this.settings.speed] || 1;
      const spacing = Math.max(120, Math.min(260, rect.w * NOTE_SPACING_FRAC));
      this._spacing = spacing;
      const v = spacing * nps; // px per second
      const px = v * dt;
      const rightEdge = rect.x + rect.w + 24;
      const missX = this._missX(rect);

      // newly spawned notes start at the right edge
      this.notes.forEach((n) => { if (n.spawnedRight) { n.x = rightEdge; n.spawnedRight = false; } });
      // move notes left; once past the halfway point they decelerate toward the
      // play line (more reading time near the clear point) but never stall.
      const mid = rect.x + rect.w * 0.5;
      this.notes.forEach((n) => {
        let f = 1;
        if (n.x < mid) {
          const t = (n.x - missX) / Math.max(1, mid - missX); // 1 at midpoint → 0 at play line
          f = 0.4 + 0.6 * Math.max(0, Math.min(1, t));         // 100% → 40% speed
        }
        n.x -= px * f;
      });

      // miss: leftmost crossed the play line
      while (this.notes.length && this.notes[0].x <= missX) {
        const lost = this.notes.shift();
        this.score = Math.max(0, this.score - 1);
        this.streak = 0;
        this.misses++;
        events.push({ type: 'miss', note: lost.note });
        if (this.settings.livesMode) {
          this.lives--;
          if (this.lives <= 0) { this.status = 'over'; events.push({ type: 'gameover' }); }
        }
      }

      // metronome: real-time beat clock at the tune's tempo (avgDur × notes/sec)
      if (this.status === 'playing') {
        const beatsPerSec = (this._avgDur || 1) * nps;
        const prevB = Math.floor(this._metroBeats);
        this._metroBeats += dt * beatsPerSec;
        if (Math.floor(this._metroBeats) > prevB) {
          events.push({ type: 'beat', accent: (Math.floor(this._metroBeats) % this._barBeats()) === 0 });
        }
      }

      // spawn cadence: distance to next note = gap-units × spacing
      if (this.status === 'playing') {
        this.spawnAcc += px;
        this._refillQueue();
        const requiredPx = (this._gapUnits || 1) * spacing;
        if (this.spawnAcc >= requiredPx) { this.spawnAcc -= requiredPx; this._spawn(); }
      }

      this.peakScore = Math.max(this.peakScore, this.score);
      this._highlight();
      return events;
    }

    _highlight() {
      if (!this.instrument) return;
      const m = (this.settings.showHints && this.active) ? this.active.note.midi : null;
      this.instrument.setHighlight(m);
    }

    _missX(rect) { return rect.x + this._clefW(rect) + 6; }
    // reserve room for the clef + up to 4 key-signature accidentals (fixed, so
    // the play line stays put even as the key changes between phrases).
    _clefW(rect) {
      const gap = Math.max(9, Math.min(20, rect.h / 11));
      return Math.min(rect.w * 0.36, gap * 3.2 + 4 * gap * 0.95 + 8);
    }
    _sigFifths() { return this.active && this.active.fifths != null ? this.active.fifths : (this.key ? this.key.fifths : 0); }

    // midi: returns {result:'good'|'bad', note, expected?, multiplier?}
    handleTap(midi) {
      if (this.status !== 'playing') return null;
      const a = this.active;
      if (!a) return null; // nothing to clear -> neutral
      this.attempts++;
      if (midi === a.note.midi) {
        const mult = this.multiplier();
        this.score += mult;
        this.streak++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        this.hits++;
        this.peakScore = Math.max(this.peakScore, this.score);
        const cleared = this.notes.shift();
        return { result: 'good', note: cleared.note, multiplier: mult };
      }
      this.score = Math.max(0, this.score - 1);
      this.streak = 0;
      return { result: 'bad', expected: a.note };
    }

    // Microphone play-along: octave-tolerant pitch-class match, lenient (a wrong
    // pitch is ignored rather than penalised). Returns {result:'good',...} or null.
    handleMic(midi) {
      if (this.status !== 'playing') return null;
      const a = this.active;
      if (a == null) return null;
      const pc = (m) => (((m % 12) + 12) % 12);
      if (pc(midi) === pc(a.note.midi)) {
        const mult = this.multiplier();
        this.score += mult; this.streak++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        this.hits++; this.attempts++;
        this.peakScore = Math.max(this.peakScore, this.score);
        const cleared = this.notes.shift();
        return { result: 'good', note: cleared.note, multiplier: mult };
      }
      return null;
    }

    // ---- staff drawing ----------------------------------------------------
    drawStaff(ctx, rect) {
      if (!this.clef) return; // not configured yet — nothing to draw
      if (this.clef.grand) return this._drawGrandStaff(ctx, rect);
      const gap = Math.max(9, Math.min(20, rect.h / 11));
      const middleY = rect.y + rect.h / 2;
      const middleStep = this.clef.middleStep;
      const lineSteps = [4, 2, 0, -2, -4].map((d) => middleStep + d);
      const yFor = (step) => middleY - (step - middleStep) * (gap / 2);
      const clefW = this._clefW(rect);
      const missX = this._missX(rect);

      // danger zone + play line at the left
      ctx.fillStyle = STAFF.danger;
      ctx.fillRect(rect.x, rect.y, missX - rect.x, rect.h);
      ctx.strokeStyle = STAFF.playLine;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(missX, rect.y + 4); ctx.lineTo(missX, rect.y + rect.h - 4); ctx.stroke();

      // staff lines (full width)
      ctx.lineWidth = 1.4; ctx.strokeStyle = STAFF.line;
      lineSteps.forEach((s) => {
        const y = yFor(s);
        ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); ctx.stroke();
      });

      // clef glyph (decorative; app works even if font lacks it)
      ctx.fillStyle = STAFF.clef;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${gap * 5.2}px "Bravura","Noto Music",serif`;
      ctx.fillText(this.clef.glyph, rect.x + gap * 1.7, middleY + (this.clef === T.CLEFS.treble ? gap * 0.4 : -gap * 0.2));

      // key signature
      const ks = this.clef === T.CLEFS.bass ? KS_BASS : KS_TREBLE;
      drawKeySig(ctx, this._sigFifths(), ks, rect.x + gap * 3.4, gap * 0.95, yFor, gap, STAFF.clef);

      // notes
      const noteRx = gap * 0.62, noteRy = gap * 0.5;
      this.notes.forEach((n, i) => {
        if (n.x < rect.x - 40 || n.x > rect.x + rect.w + 60) return;
        const step = n.note.step;
        const y = yFor(step);
        const isActive = i === 0;
        const color = isActive ? STAFF.noteActive : STAFF.note;

        if (n.barline) {
          ctx.strokeStyle = STAFF.lineDim; ctx.lineWidth = 1;
          const bx = n.x - noteRx * 2.0;
          ctx.beginPath(); ctx.moveTo(bx, yFor(middleStep + 4)); ctx.lineTo(bx, yFor(middleStep - 4)); ctx.stroke();
        }

        // ledger lines
        ctx.strokeStyle = color; ctx.lineWidth = 1.4;
        const drawLedger = (L) => {
          const ly = yFor(L);
          ctx.beginPath(); ctx.moveTo(n.x - noteRx * 1.7, ly); ctx.lineTo(n.x + noteRx * 1.7, ly); ctx.stroke();
        };
        const top = middleStep + 4, bot = middleStep - 4;
        if (step > top) for (let L = top + 2; L <= step; L += 2) drawLedger(L);
        if (step < bot) for (let L = bot - 2; L >= step; L -= 2) drawLedger(L);

        // accidental — only when it differs from the note's key signature
        const keyAcc = T.keySig(n.fifths || 0).accMap[n.note.letter] || 0;
        const glyph = accidentalGlyph(n.note.accidental, keyAcc);
        if (glyph) {
          ctx.fillStyle = color;
          ctx.font = `${gap * 1.9}px serif`;
          ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillText(glyph, n.x - noteRx - 3, y);
        }

        // stem (up if below middle line, else down)
        const stemUp = step < middleStep;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath();
        if (stemUp) { ctx.moveTo(n.x + noteRx - 0.5, y); ctx.lineTo(n.x + noteRx - 0.5, y - gap * 3.2); }
        else { ctx.moveTo(n.x - noteRx + 0.5, y); ctx.lineTo(n.x - noteRx + 0.5, y + gap * 3.2); }
        ctx.stroke();

        // notehead — filled for short notes, hollow for half/whole (dur >= 2)
        ctx.save();
        ctx.translate(n.x, y); ctx.rotate(-0.32);
        ctx.beginPath(); ctx.ellipse(0, 0, noteRx, noteRy, 0, 0, 7);
        if ((n.dur || 1) >= 2) { ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke(); }
        else { ctx.fillStyle = color; ctx.fill(); }
        ctx.restore();

        // active-note name label when hints on
        if (isActive && this.settings.showHints) {
          ctx.fillStyle = STAFF.noteActive;
          ctx.font = `700 ${gap * 1.1}px ui-sans-serif,system-ui`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(n.note.label + n.note.octave, n.x, rect.y + rect.h - 4);
        }
      });
    }

    // Grand staff: treble (top) + bass (bottom) sharing one continuous scale,
    // with middle C (step 28) anchored at the vertical centre.
    _drawGrandStaff(ctx, rect) {
      const gap = Math.max(7, Math.min(14, rect.h / 15));
      const midCY = rect.y + rect.h / 2;
      const yFor = (step) => midCY - (step - 28) * (gap / 2);
      const trebleLines = [30, 32, 34, 36, 38]; // E4 G4 B4 D5 F5
      const bassLines = [18, 20, 22, 24, 26];   // G2 B2 D3 F3 A3
      const clefW = this._clefW(rect);
      const missX = this._missX(rect);

      ctx.fillStyle = STAFF.danger; ctx.fillRect(rect.x, rect.y, missX - rect.x, rect.h);
      ctx.strokeStyle = STAFF.playLine; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(missX, rect.y + 4); ctx.lineTo(missX, rect.y + rect.h - 4); ctx.stroke();

      ctx.lineWidth = 1.3; ctx.strokeStyle = STAFF.line;
      trebleLines.concat(bassLines).forEach((s) => {
        const y = yFor(s);
        ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); ctx.stroke();
      });
      // brace joining the staves
      ctx.strokeStyle = STAFF.clef; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(rect.x + 2, yFor(38)); ctx.lineTo(rect.x + 2, yFor(18)); ctx.stroke();

      ctx.fillStyle = STAFF.clef; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${gap * 4.4}px "Bravura","Noto Music",serif`;
      ctx.fillText(T.CLEFS.treble.glyph, rect.x + gap * 2.0, yFor(34) + gap * 0.4);
      ctx.fillText(T.CLEFS.bass.glyph, rect.x + gap * 2.0, yFor(22) - gap * 0.2);
      // key signature on both staves
      const sf = this._sigFifths();
      drawKeySig(ctx, sf, KS_TREBLE, rect.x + gap * 3.8, gap * 0.95, yFor, gap, STAFF.clef);
      drawKeySig(ctx, sf, KS_BASS, rect.x + gap * 3.8, gap * 0.95, yFor, gap, STAFF.clef);

      const noteRx = gap * 0.62, noteRy = gap * 0.5;
      this.notes.forEach((n, i) => {
        if (n.x < rect.x - 40 || n.x > rect.x + rect.w + 60) return;
        const step = n.note.step;
        const y = yFor(step);
        const isActive = i === 0;
        const color = isActive ? STAFF.noteActive : STAFF.note;
        const treble = n.note.midi >= 60;
        const homeLines = treble ? trebleLines : bassLines;
        const homeMiddle = treble ? 34 : 22;

        if (n.barline) {
          ctx.strokeStyle = STAFF.lineDim; ctx.lineWidth = 1;
          const bx = n.x - noteRx * 2.0;
          ctx.beginPath(); ctx.moveTo(bx, yFor(38)); ctx.lineTo(bx, yFor(18)); ctx.stroke();
        }

        ctx.strokeStyle = color; ctx.lineWidth = 1.4;
        const topL = homeLines[homeLines.length - 1], botL = homeLines[0];
        const drawLedger = (L) => { const ly = yFor(L); ctx.beginPath(); ctx.moveTo(n.x - noteRx * 1.7, ly); ctx.lineTo(n.x + noteRx * 1.7, ly); ctx.stroke(); };
        if (step > topL) for (let L = topL + 2; L <= step; L += 2) drawLedger(L);
        if (step < botL) for (let L = botL - 2; L >= step; L -= 2) drawLedger(L);

        const keyAcc = T.keySig(n.fifths || 0).accMap[n.note.letter] || 0;
        const glyph = accidentalGlyph(n.note.accidental, keyAcc);
        if (glyph) {
          ctx.fillStyle = color; ctx.font = `${gap * 1.9}px serif`;
          ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillText(glyph, n.x - noteRx - 3, y);
        }
        const stemUp = step < homeMiddle;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath();
        if (stemUp) { ctx.moveTo(n.x + noteRx - 0.5, y); ctx.lineTo(n.x + noteRx - 0.5, y - gap * 3); }
        else { ctx.moveTo(n.x - noteRx + 0.5, y); ctx.lineTo(n.x - noteRx + 0.5, y + gap * 3); }
        ctx.stroke();
        ctx.save(); ctx.translate(n.x, y); ctx.rotate(-0.32);
        ctx.beginPath(); ctx.ellipse(0, 0, noteRx, noteRy, 0, 0, 7);
        if ((n.dur || 1) >= 2) { ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke(); }
        else { ctx.fillStyle = color; ctx.fill(); }
        ctx.restore();

        if (isActive && this.settings.showHints) {
          ctx.fillStyle = STAFF.noteActive; ctx.font = `700 ${gap * 1.05}px ui-sans-serif,system-ui`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(n.note.label + n.note.octave, n.x, rect.y + rect.h - 3);
        }
      });
    }
  }

  App.Game = Game;
  App.NPS_PRESETS = NPS_PRESETS;
})(window.App = window.App || {});
