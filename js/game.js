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
  const BPM_PRESETS = { relaxed: 54, steady: 76, brisk: 104, intense: 138 };
  // "lick" rhythm patterns (in quarter-note beats) used for random / generated
  // notes and any lick that doesn't carry its own rhythm.
  const RHYTHM_PATTERNS = [
    [1, 1, 1, 1], [0.5, 0.5, 1], [1, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5],
    [1.5, 0.5], [1, 1, 0.5, 0.5], [0.5, 0.5, 1, 1], [2, 1, 1], [1, 1, 2],
    [2, 2], [1, 0.5, 0.5, 1], [0.5, 1, 0.5, 1, 1],
  ];

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
      this._gapBeats = 1;            // beats until the next note spawns
      this._rhythmBuf = [];          // streamed rhythm pattern
    }

    _barBeats() {
      const m = /(\d+)\s*\/\s*(\d+)/.exec(this.settings.timeSig || '4/4');
      if (!m) return 4;
      return (+m[1]) * 4 / (+m[2]); // bar length in quarter-note beats
    }
    _phraseRestBeats() { return 2; }
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
      const all = this.instrument.naturals;
      const d = this.settings.difficulty;
      if (d === 'easy') {
        // central ~octave of naturals — fewest ledger lines
        const mid = Math.floor(all.length / 2);
        const span = 4;
        this.pool = all.slice(Math.max(0, mid - span), mid + span + 1);
      } else if (d === 'hard') {
        this.pool = this.instrument.allNotes.slice(); // include sharps
      } else {
        this.pool = all.slice(); // medium: all naturals
      }
      if (this.pool.length < 2) this.pool = all.slice();
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
        while (this.queue.length < 2) this.queue.push({ note: this._randNote(), dur: this._nextDur() });
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
      const notes = App.Licks.transposeToInstrument(baseNotes, this.instrument, semis);
      const durs = (baseDurs && baseDurs.length === baseNotes.length) ? baseDurs : null;
      const source = l.source + (semis ? ' · transposed' : '');
      notes.forEach((n, i) => this.queue.push({
        note: n, dur: durs ? durs[i] : this._nextDur(),
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
      this.notes.push({ note: item.note, x: 0, spawnedRight: true, dur, barline: onBar });
      this._beatPos += dur;
      const next = this.queue[0];
      this._gapBeats = dur + (next && next.phraseStart ? this._phraseRestBeats() : 0);
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

      const bpm = BPM_PRESETS[this.settings.speed] || 76;
      const beatPx = Math.max(46, Math.min(96, rect.w * 0.095));
      this._beatPx = beatPx;
      const v = beatPx * bpm / 60; // px per second
      const px = v * dt;
      const rightEdge = rect.x + rect.w + 24;
      const missX = this._missX(rect);

      // newly spawned notes start at the right edge
      this.notes.forEach((n) => { if (n.spawnedRight) { n.x = rightEdge; n.spawnedRight = false; } });
      // move all left
      this.notes.forEach((n) => { n.x -= px; });

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

      // spawn cadence by rhythmic duration (gap = beats × pixels-per-beat)
      if (this.status === 'playing') {
        this.spawnAcc += px;
        this._refillQueue();
        const requiredPx = (this._gapBeats || 1) * beatPx;
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
    _clefW(rect) { return Math.min(64, rect.w * 0.12); }

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
      ctx.fillText(this.clef.glyph, rect.x + clefW * 0.55, middleY + (this.clef === T.CLEFS.treble ? gap * 0.4 : -gap * 0.2));

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

        // accidental
        if (n.note.accidental) {
          ctx.fillStyle = color;
          ctx.font = `${gap * 1.9}px serif`;
          ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillText(n.note.accidental === 1 ? '♯' : '♭', n.x - noteRx - 3, y);
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
      ctx.fillText(T.CLEFS.treble.glyph, rect.x + clefW * 0.6, yFor(34) + gap * 0.4);
      ctx.fillText(T.CLEFS.bass.glyph, rect.x + clefW * 0.6, yFor(22) - gap * 0.2);

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

        if (n.note.accidental) {
          ctx.fillStyle = color; ctx.font = `${gap * 1.9}px serif`;
          ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillText(n.note.accidental === 1 ? '♯' : '♭', n.x - noteRx - 3, y);
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
  App.BPM_PRESETS = BPM_PRESETS;
})(window.App = window.App || {});
