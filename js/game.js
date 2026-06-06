/* game.js — staff rendering, scrolling notes, scoring, streaks, lives.
   Game is a state machine; the UI owns the rAF loop and visual/audio feedback. */
(function (App) {
  'use strict';

  const T = App.Theory;
  const STAFF = {
    line: '#cbd2e0', lineDim: 'rgba(203,210,224,0.35)',
    note: '#e8ecf4', noteActive: '#ffd24a', accidental: '#e8ecf4',
    clef: '#aeb6c6', danger: 'rgba(255,93,108,0.18)', playLine: 'rgba(255,93,108,0.55)',
    barLine: 'rgba(180,190,210,0.55)', beatLine: 'rgba(174,182,198,0.18)',
  };

  // Tempo presets (BPM). Scroll speed derives from BPM × pixels-per-beat, so
  // horizontal spacing reflects each note's rhythmic duration.
  // Read speed = target NOTE ONSETS PER SECOND (not BPM). The effective tempo is
  // normalised by each tune's average note duration, so dense tunes auto-slow to
  // hit the same notes/second — i.e. a steady stream of ~1 note/s regardless of
  // whether the tune is in eighths or quarters.
  const NPS_PRESETS = { relaxed: 0.25, steady: 0.5, brisk: 1, intense: 2 }; // notes/sec
  // STATIONARY beat ruler: vertical grid lines are fixed; notes scroll across
  // them. One beat = BEAT_PX_FRAC × width of horizontal travel. Effective tempo
  // (and thus scroll speed + click rate) = notes/sec × the tune's avg note
  // duration, so dense tunes auto-slow but still hit the notes/sec target.
  const BEAT_PX = 0.15;              // beat-line spacing as a fraction of width
  // Adaptive tempo controller. The player clears notes by tapping the right
  // pitch (no timing gate), so the rate at which they eliminate notes — beats of
  // music cleared per second — IS their natural reading speed. The tempo eases
  // toward that measured rate; when the player out-runs the supply and clears the
  // screen, we probe upward to discover their true pace; a quadratic emergency
  // brake catches a note about to cross when the rate signal lags.
  const CLEAR_TAU = 2.0;             // s: window for the measured beats-cleared/sec
  const TEMPO_TAU = 0.8;             // s: how gently the tempo eases toward its target
  const PROBE_MUL = 1.5;             // when the screen is cleared, aim above the measured
  const PROBE_ADD = 0.25;            // rate (×MUL + ADD b/s) to probe for spare capacity
  const CLEAR_FRAC = 0.85;          // "screen cleared" = nearest note past this fraction of
                                    // the read zone (or none left) → probe upward
  const LEAD_TAU = 0.8;              // s: smoothing of the lead signal
  const BRAKE_LEAD = 1.0;            // beats: emergency brake only once a note is this close
  const DOWN_RATE = 2.5;             // emergency brake strength (reached AT the play line)
  const DOWN_EXP = 2;                // quadratic: gentle entry, firm only when about to cross
  const MISS_SLOW = 0.9;             // extra tempo cut on a missed note (gentle dip)
  const TEMPO_MIN = 0.12, TEMPO_MAX = 4.0; // beats/sec bounds
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
  // stationary vertical beat/bar ruler (lines fixed; notes scroll across them)
  function drawGrid(ctx, missX, pxPerBeat, barBeats, xMax, yTop, yBot) {
    for (let k = 1; missX + k * pxPerBeat <= xMax + 1; k++) {
      const x = missX + k * pxPerBeat;
      const bar = (k % barBeats) === 0;
      ctx.strokeStyle = bar ? STAFF.barLine : STAFF.beatLine;
      ctx.lineWidth = bar ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, yBot); ctx.stroke();
    }
  }

  // Classify a duration (in quarter-note beats) into its notation: how many
  // flags, whether the head is hollow, whether it has a stem, and a dot.
  function rhythmGlyph(dur) {
    dur = dur || 1;
    let base = 0.25;
    for (const b of [4, 2, 1, 0.5, 0.25]) { if (dur >= b - 1e-3) { base = b; break; } }
    const dotted = Math.abs(dur - base * 1.5) < 0.06;
    return {
      flags: base <= 0.25 ? 2 : base <= 0.5 ? 1 : 0,
      hollow: base >= 2,
      stem: base < 4,            // whole note has no stem
      dotted,
    };
  }

  // --- note glyph pieces (spacing comes from x; these convey rhythmic value) ---
  function drawNoteHead(ctx, x, y, color, hollow, noteRx, noteRy) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.32);
    ctx.beginPath(); ctx.ellipse(0, 0, noteRx, noteRy, 0, 0, 7);
    if (hollow) { ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke(); }
    else { ctx.fillStyle = color; ctx.fill(); }
    ctx.restore();
  }
  function drawDot(ctx, x, y, gap, color, noteRx) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x + noteRx + gap * 0.55, y - gap * 0.3, gap * 0.16, gap * 0.16, 0, 0, 7);
    ctx.fill();
  }
  function stemX(x, up, noteRx) { return up ? x + noteRx - 0.5 : x - noteRx + 0.5; }
  function drawStem(ctx, x, y, color, up, tipY, noteRx) {
    const sx = stemX(x, up, noteRx);
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx, tipY); ctx.stroke();
    return sx;
  }
  function drawFlags(ctx, sx, tipY, gap, color, flags, up) {
    ctx.fillStyle = color;
    const dir = up ? 1 : -1; // flag hooks to the right, curving back toward the head
    for (let k = 0; k < flags; k++) {
      const fy = tipY + dir * k * gap * 0.62;
      ctx.beginPath();
      ctx.moveTo(sx, fy);
      ctx.quadraticCurveTo(sx + gap * 1.15, fy + dir * gap * 0.55, sx + gap * 0.95, fy + dir * gap * 1.55);
      ctx.quadraticCurveTo(sx + gap * 0.7, fy + dir * gap * 0.8, sx, fy + dir * gap * 0.72);
      ctx.closePath(); ctx.fill();
    }
  }

  // Draw stems, flags and beams for a time-ordered list of on-screen notes.
  // items: [{n, x, y, step, color}]. middleFor(item) gives the staff middle step
  // used to decide stem direction. Consecutive flagged notes within the same
  // quarter-beat are beamed; lone flagged notes get flags; longer notes get a
  // plain stem; whole notes get none. (Noteheads/dots are drawn by the caller.)
  function drawStemsAndBeams(ctx, items, gap, middleFor, noteRx, stemLen) {
    const beamable = (it) => { const g = rhythmGlyph(it.n.dur); return g.flags >= 1 && g.stem; };
    let i = 0;
    while (i < items.length) {
      const it = items[i], g = rhythmGlyph(it.n.dur);
      if (!beamable(it)) {                       // quarter / half / dotted / whole
        if (g.stem) { const up = it.step < middleFor(it); drawStem(ctx, it.x, it.y, it.color, up, up ? it.y - stemLen : it.y + stemLen, noteRx); }
        i++; continue;
      }
      let j = i + 1;
      while (j < items.length && beamable(items[j]) && Math.floor(items[j].n.beat) === Math.floor(it.n.beat)) j++;
      const run = items.slice(i, j);
      if (run.length === 1) {                    // lone flagged note → flag
        const up = it.step < middleFor(it);
        const tipY = up ? it.y - stemLen : it.y + stemLen;
        const sx = drawStem(ctx, it.x, it.y, it.color, up, tipY, noteRx);
        drawFlags(ctx, sx, tipY, gap, it.color, g.flags, up);
      } else {                                   // beam the run
        let sSum = 0, mSum = 0;
        run.forEach((r) => { sSum += r.step; mSum += middleFor(r); });
        const up = sSum / run.length < mSum / run.length;
        const beamY = up ? Math.min(...run.map((r) => r.y)) - stemLen : Math.max(...run.map((r) => r.y)) + stemLen;
        const color = run[0].color;
        const sx = run.map((r) => drawStem(ctx, r.x, r.y, color, up, beamY, noteRx));
        ctx.strokeStyle = color; ctx.lineWidth = gap * 0.34; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(sx[0], beamY); ctx.lineTo(sx[sx.length - 1], beamY); ctx.stroke();
        // secondary beam between adjacent sixteenths (flags >= 2)
        const sec = beamY + (up ? gap * 0.5 : -gap * 0.5);
        for (let k = 0; k < run.length - 1; k++) {
          if (rhythmGlyph(run[k].n.dur).flags >= 2 && rhythmGlyph(run[k + 1].n.dur).flags >= 2) {
            ctx.beginPath(); ctx.moveTo(sx[k], sec); ctx.lineTo(sx[k + 1], sec); ctx.stroke();
          }
        }
      }
      i = j;
    }
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
      this.lastTime = 0;
      this.peakScore = 0;
      this.queue = [];               // upcoming notes to spawn
      this.currentLickName = '';
      this.currentLickSource = '';
      this.clock = null;             // musical beats elapsed at the play line
      this.songBeat = 0;             // running onset beat for spawning
      this.tempo = null;             // adaptive tempo (beats/sec), set on first update
      this.clearRate = null;         // measured beats-of-music cleared per second
      this._clearedBeats = 0;        // beats cleared since last frame (filled by tap handlers)
      this._everCleared = false;     // has the player cleared any note yet? (warm-up gate)
      this._leadEMA = null;          // smoothed nearest-note lead (emergency-brake signal)
      this._avgDur = PATTERN_AVG_DUR; // avg note duration of current tune
      this._rhythmBuf = [];          // streamed rhythm pattern
      this.key = T.keySig(0);        // current key signature (C major)
      this._clickUnit = null;        // last fired metronome beat index
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
      this.lastTime = 0;
      // notes are spawned by the clock-driven lookahead in update()
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

    // Pull the next queued note and place it on the beat grid. Returns false if
    // nothing was available.
    _spawnNext() {
      this._refillQueue();
      const item = this.queue.shift();
      if (!item) return false;
      if (item.phraseStart) {
        // start each phrase on a bar downbeat (so its first note hits a bar line)
        const bb = this._barBeats();
        this.songBeat = Math.ceil((this.songBeat + 1e-4) / bb) * bb;
        if (item.lickName) { this.currentLickName = item.lickName; this.currentLickSource = item.lickSource; }
      }
      const dur = item.dur || 1;
      this.notes.push({
        note: item.note, beat: this.songBeat, dur, x: 1e9,
        fifths: item.fifths != null ? item.fifths : (this.key ? this.key.fifths : 0),
      });
      this.songBeat += dur;
      return true;
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

      // Musical clock at the play line, advancing at an ADAPTIVE tempo that tracks
      // the player's measured note-elimination rate, so it converges on (and stays
      // at) their natural reading speed. The beat grid stays stationary.
      const pxPerBeat = Math.max(72, Math.min(150, rect.w * BEAT_PX));
      const missX = this._missX(rect);
      const aheadBeats = (rect.x + rect.w - missX) / pxPerBeat + 1;
      if (this.tempo === null) this.tempo = NPS_PRESETS[this.settings.speed] || 0.6; // starting pace
      if (this.clearRate === null) this.clearRate = this.tempo; // start the rate estimate at the preset
      if (this.clock === null) this.clock = -Math.min(aheadBeats, 2.5); // short lead-in

      // Measured elimination rate: beats of music the player cleared per second
      // (accumulated by handleTap/handleMic), exponentially windowed over CLEAR_TAU.
      // Guard dt>0 — the first frame has dt=0, and 0/0 would poison the rate (and
      // hence tempo/clock) with NaN, freezing every note off-screen.
      if (dt > 0) {
        const instRate = this._clearedBeats / dt;
        this.clearRate += (instRate - this.clearRate) * (1 - Math.exp(-dt / CLEAR_TAU));
      }
      this._clearedBeats = 0;

      // lead = how far the nearest unread note is from the play line (beats), smoothed.
      const lead = this.notes.length ? Math.max(0, this.notes[0].beat - this.clock) : (aheadBeats + 2);
      this._leadEMA = this._leadEMA === null ? lead : this._leadEMA + (lead - this._leadEMA) * (1 - Math.exp(-dt / LEAD_TAU));

      // Target the player's pace. Normally that's their measured clearing rate (so the
      // tempo slows/holds exactly to what they're reading). But when they out-run the
      // supply and clear the screen, the measured rate is capped by the tempo itself —
      // so probe a little ABOVE it to discover how much faster they can go.
      const clearLead = (aheadBeats - 1) * CLEAR_FRAC + 1; // "screen cleared" lead
      const screenCleared = this._leadEMA > clearLead;
      // Warm-up: hold the preset pace until the player has cleared their first
      // note (so the screen doesn't crawl while they get going). The emergency
      // brake still keeps notes from barraging the line if they never engage.
      const target = !this._everCleared ? (NPS_PRESETS[this.settings.speed] || 0.6)
        : screenCleared ? Math.min(TEMPO_MAX, this.clearRate * PROBE_MUL + PROBE_ADD)
        : this.clearRate;
      this.tempo += (target - this.tempo) * (1 - Math.exp(-dt / TEMPO_TAU));
      // Emergency brake: a note is about to cross and the rate signal hasn't caught up.
      if (this._leadEMA < BRAKE_LEAD) this.tempo *= Math.exp(-DOWN_RATE * Math.pow(1 - this._leadEMA / BRAKE_LEAD, DOWN_EXP) * dt);
      this.tempo = Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, this.tempo));

      this.clock += dt * this.tempo;
      this._pxPerBeat = pxPerBeat;
      this._clock = this.clock;

      // position notes from their beat onset (stationary grid: x = playLine + (beat-now)·pxPerBeat)
      this.notes.forEach((n) => { n.x = missX + (n.beat - this.clock) * pxPerBeat; });

      // spawn upcoming notes within the look-ahead window
      this._refillQueue();
      let guard = 0;
      while (this.songBeat < this.clock + aheadBeats && guard++ < 64) { if (!this._spawnNext()) break; }

      // miss: leftmost note scrolled past the play line (small grace beyond it)
      while (this.notes.length && this.notes[0].beat < this.clock - 0.18) {
        const lost = this.notes.shift();
        this.score = Math.max(0, this.score - 1);
        this.streak = 0;
        this.misses++;
        this.tempo = Math.max(TEMPO_MIN, this.tempo * MISS_SLOW); // a miss → ease off the tempo
        events.push({ type: 'miss', note: lost.note });
        if (this.settings.livesMode) {
          this.lives--;
          if (this.lives <= 0) { this.status = 'over'; events.push({ type: 'gameover' }); }
        }
      }

      // metronome: one click per quarter-note beat (lands on each integer beat,
      // aligned with the grid + notes); the bar downbeat is accented.
      const unit = Math.floor(this.clock);
      if (this._clickUnit === null) this._clickUnit = unit;
      const bb = this._barBeats();
      while (this._clickUnit < unit) {
        this._clickUnit++;
        if (this._clickUnit >= 0) {
          const onBar = (this._clickUnit % bb) === 0;
          events.push({ type: 'beat', level: onBar ? 'bar' : 'beat' });
        }
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
        this._clearedBeats += cleared.dur || 1; this._everCleared = true; // feed the rate estimate
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
        this._clearedBeats += cleared.dur || 1; this._everCleared = true; // feed the rate estimate
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

      // stationary beat/bar ruler (drawn under the staff lines + notes)
      drawGrid(ctx, missX, this._pxPerBeat || rect.w * BEAT_PX, this._barBeats(), rect.x + rect.w, yFor(middleStep + 5.5), yFor(middleStep - 5.5));

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
      const items = [];
      this.notes.forEach((n, i) => {
        if (n.x < rect.x - 40 || n.x > rect.x + rect.w + 60) return;
        const step = n.note.step;
        const y = yFor(step);
        const isActive = i === 0;
        const color = isActive ? STAFF.noteActive : STAFF.note;
        items.push({ n, x: n.x, y, step, color });

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

        // notehead + augmentation dot (stems/flags/beams drawn together below)
        const rg = rhythmGlyph(n.dur);
        drawNoteHead(ctx, n.x, y, color, rg.hollow, noteRx, noteRy);
        if (rg.dotted) drawDot(ctx, n.x, y, gap, color, noteRx);

        // active-note name label when hints on
        if (isActive && this.settings.showHints) {
          ctx.fillStyle = STAFF.noteActive;
          ctx.font = `700 ${gap * 1.1}px ui-sans-serif,system-ui`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(n.note.label + n.note.octave, n.x, rect.y + rect.h - 4);
        }
      });
      // stems, flags and beams for the whole visible run
      drawStemsAndBeams(ctx, items, gap, () => middleStep, noteRx, gap * 3.2);
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

      // stationary beat/bar ruler spanning both staves
      drawGrid(ctx, missX, this._pxPerBeat || rect.w * BEAT_PX, this._barBeats(), rect.x + rect.w, yFor(40), yFor(16));

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
      const items = [];
      this.notes.forEach((n, i) => {
        if (n.x < rect.x - 40 || n.x > rect.x + rect.w + 60) return;
        const step = n.note.step;
        const y = yFor(step);
        const isActive = i === 0;
        const color = isActive ? STAFF.noteActive : STAFF.note;
        const treble = n.note.midi >= 60;
        const homeLines = treble ? trebleLines : bassLines;
        items.push({ n, x: n.x, y, step, color, mid: treble ? 34 : 22 });

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
        const rg = rhythmGlyph(n.dur);
        drawNoteHead(ctx, n.x, y, color, rg.hollow, noteRx, noteRy);
        if (rg.dotted) drawDot(ctx, n.x, y, gap, color, noteRx);

        if (isActive && this.settings.showHints) {
          ctx.fillStyle = STAFF.noteActive; ctx.font = `700 ${gap * 1.05}px ui-sans-serif,system-ui`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(n.note.label + n.note.octave, n.x, rect.y + rect.h - 3);
        }
      });
      // stems, flags and beams (stem direction uses each note's home clef middle)
      drawStemsAndBeams(ctx, items, gap, (it) => it.mid, noteRx, gap * 3);
    }
  }

  App.Game = Game;
  App.NPS_PRESETS = NPS_PRESETS;
})(window.App = window.App || {});
