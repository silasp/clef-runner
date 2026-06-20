/* main.js — wiring: menu, settings, canvases, game loop, input, scoring UI. */
(function (App) {
  'use strict';

  // ===========================================================================
  // CONFIG — to enable Google Sign-In: paste your OAuth Web client ID here and
  // serve the page over http(s) (Google SSO does not work from file://).
  // Get one at https://console.cloud.google.com/apis/credentials
  // Leave blank to play with local guest profiles (works fully offline).
  const GOOGLE_CLIENT_ID = '';
  // ===========================================================================

  const $ = (id) => document.getElementById(id);
  const DEFS = App.Instruments.DEFS;

  const state = {
    inst: 'piano',
    settings: { mode: 'licks', genre: 'all', difficulty: 'medium', speed: 'steady', clef: 'treble', showHints: true, sound: true, livesMode: false, randomKey: false, octaveShift: true, timeSig: '4/4', mic: false, metronome: false, scaleTypes: ['major'], libraryIds: [] },
  };
  const micState = { lastFireTime: 0, silentFrames: 0, armed: true, env: 0, lastMidi: null };
  // Matching-side params (the detector's own params live in App.Pitch.cfg). Both
  // are fine-tuned live from the paused debug panel and persisted.
  const micCfg = { onsetRatio: 1.4, refractoryMs: 120 };
  const MIC_TUNE_DEFAULTS = { mode: 'poly', rmsGate: 0.005, salienceCut: 0.18, harmonics: 8, onsetRatio: 1.4, refractoryMs: 120 };
  let game = new App.Game();
  let instrument = null;
  let staffCtx, instCtx, staffRect, instRect;
  let countdownTimer = null;
  // milestone bookkeeping
  let gameRecorded = false;  // guard so a finished game is only counted once
  let lastStreak = 1;        // day-streak computed at boot (for the stats panel)

  // ---- persistence of settings -------------------------------------------
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('sr.settings'));
      if (s) Object.assign(state.settings, s);
      state.settings.mic = false; // never auto-grab the mic on load
      // imported files live only for the session — drop stale file: picks on load
      state.settings.libraryIds = (state.settings.libraryIds || []).filter((id) => !String(id).startsWith('file:'));
      const i = localStorage.getItem('sr.inst');
      if (i && DEFS[i === 'pianoBass' ? 'piano' : i]) state.inst = i === 'pianoBass' ? 'piano' : i;
    } catch (e) {}
  }
  function saveSettings() {
    localStorage.setItem('sr.settings', JSON.stringify(state.settings));
    localStorage.setItem('sr.inst', state.inst);
  }

  function instKey() {
    if (state.inst === 'piano') {
      if (state.settings.clef === 'bass') return 'pianoBass';
      if (state.settings.clef === 'grand') return 'pianoGrand';
      return 'piano';
    }
    return state.inst;
  }

  // ---- canvas sizing ------------------------------------------------------
  function fitCanvas(canvas) {
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, rect: { x: 0, y: 0, w, h } };
  }

  function resize() {
    const s = fitCanvas($('staff')); staffCtx = s.ctx; staffRect = s.rect;
    const i = fitCanvas($('instrument')); instCtx = i.ctx; instRect = i.rect;
    if (instrument) {
      // leave a little inset so keys/markers aren't flush to the edges
      const pad = 6;
      instrument.layout({ x: pad, y: pad, w: instRect.w - pad * 2, h: instRect.h - pad * 2 });
    }
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));

  // ---- render loop --------------------------------------------------------
  function loop(now) {
    try {
      // only draw the staff once a game has been configured (clef set)
      if (staffCtx && game.clef) {
        staffCtx.clearRect(0, 0, staffRect.w, staffRect.h);
        const events = game.update(now, staffRect);
        game.drawStaff(staffCtx, staffRect);
        events.forEach(handleEvent);
        if (game.status === 'playing' && !(App.Celebrate && App.Celebrate.isActive())) checkAwardDuringPlay();
      }
      if (instCtx && instrument) {
        instCtx.clearRect(0, 0, instRect.w, instRect.h);
        instrument.draw(instCtx);
      }
      if (state.settings.mic) detectMic();
      if (gameVisible()) updateHud();
    } catch (e) {
      // never let one bad frame kill the whole render loop
      console.error('render frame error:', e);
    }
    requestAnimationFrame(loop);
  }

  function handleEvent(ev) {
    if (ev.type === 'miss') { flashScreen('bad'); if (state.settings.sound) App.Audio.playError(); updateLives(); }
    else if (ev.type === 'gameover') endGame();
    else if (ev.type === 'beat') { if (state.settings.metronome && state.settings.sound) App.Audio.tick(ev.level); }
  }

  // ---- input --------------------------------------------------------------
  function onTap(e) {
    if (!instrument) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const cell = instrument.hitTest(x, y);
    if (!cell) return;
    App.Audio.unlock();
    const res = game.handleTap(cell.midi);
    if (!res) { // not playing / nothing active — still give tactile sound
      if (state.settings.sound) App.Audio.playMidi(cell.midi, 0.25);
      return;
    }
    if (res.result === 'good') {
      instrument.flashCell(cell.id, 'good');
      flashScreen('good');
      if (state.settings.sound) App.Audio.playMidi(cell.midi);
      if (res.treasure) bankTreasure();
      else showPopup(res.multiplier > 1 ? `+${res.multiplier}` : '+1', res.multiplier > 1);
    } else {
      instrument.flashCell(cell.id, 'bad');
      flashScreen('bad');
      if (state.settings.sound) App.Audio.playError();
    }
    updateHud();
  }

  // ---- microphone play-along ---------------------------------------------
  function detectMic() {
    if (!App.Pitch || !App.Pitch.isRunning()) return;
    // Keep the tuner live while playing OR paused; only score while playing.
    const playing = game.status === 'playing';
    const paused = game.status === 'paused';
    if (!playing && !paused) return;
    const p = App.Pitch.detect();
    if (paused) updateMicDebug(p); // live readout while the debug panel is open
    if (!p || p.midi == null) {
      micState.silentFrames++;
      micState.env = (micState.env || 0) * 0.7; // let the envelope fall during silence
      if (micState.silentFrames > 2) { micState.armed = true; micState.lastMidi = null; updateTuner(null); }
      return;
    }
    micState.silentFrames = 0;
    updateTuner(p.freq); // the dominant pitch drives the tuner display
    // Note-change detection. An envelope follower (instant attack, slow release)
    // tracks the note's level; a fresh pluck makes the level jump back ABOVE the
    // released envelope (an attack), while a single note ringing/decaying never
    // does. We also treat a change of detected pitch as a new note. Either one
    // re-arms — so one pluck clears exactly one note instead of every note that
    // drifts by while it rings.
    const prevEnv = micState.env || 0;
    micState.env = p.rms > prevEnv ? p.rms : prevEnv * 0.88 + p.rms * 0.12;
    const attack = p.rms > prevEnv * micCfg.onsetRatio + 0.004 && p.rms > App.Pitch.cfg.rmsGate * 1.4;
    // a change of pitch class is a new note too (helps legato / bowed notes with
    // no sharp attack); compared by class so an octave flicker doesn't re-arm.
    const pc = (m) => (((m % 12) + 12) % 12);
    const pitchChanged = micState.lastMidi != null && pc(p.midi) !== pc(micState.lastMidi);
    if (attack || pitchChanged) micState.armed = true;
    if (!playing) return; // paused: tuner/debug only, no note scoring
    const now = performance.now();
    // Match while armed; the refractory is now only a minimum gap between hits
    // (debounce), never a re-arm — re-arming happens solely on a new attack.
    // Polyphonic match: pass if the target pitch class is among those sounding.
    if (micState.armed && now - micState.lastFireTime > micCfg.refractoryMs) {
      const res = game.handleMic(p.pcs);
      if (res && res.result === 'good') {
        instrument.cellsForMidi(res.note.midi).forEach((c) => instrument.flashCell(c.id, 'good'));
        flashScreen('good');
        if (res.treasure) bankTreasure();
        else showPopup(res.multiplier > 1 ? `+${res.multiplier}` : '+1', res.multiplier > 1);
        updateHud();
        micState.armed = false;
        micState.lastFireTime = now;
        micState.lastMidi = p.midi; // remember the cleared pitch for change-detection
      }
    }
  }
  async function enableMic() {
    try { await App.Pitch.start(); return true; }
    catch (e) { return false; }
  }
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  function updateTuner(freq) {
    const el = $('tuner'); if (!el) return;
    if (!freq) { el.classList.remove('lit'); $('tunerNote').textContent = '—'; $('tunerCents').textContent = ''; $('tunerNeedle').style.top = '50%'; return; }
    const { midi, cents } = App.Theory.centsOff(freq);
    el.classList.add('lit');
    el.classList.toggle('intune', Math.abs(cents) <= 12);
    $('tunerNote').textContent = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    $('tunerCents').textContent = (cents > 0 ? '+' : '') + cents + '¢';
    // Vertical tuner: sharp (+cents) pushes the needle up, flat (−cents) down.
    $('tunerNeedle').style.top = Math.max(2, Math.min(98, 50 - cents)) + '%';
  }
  function showTuner(on) { const el = $('tuner'); if (el) el.style.display = on ? 'flex' : 'none'; if (on) updateTuner(null); }

  // ---- mic detection debug / tuning (shown on the pause screen) ------------
  // Sliders fine-tune the detector (App.Pitch.cfg) and the matcher (micCfg).
  const TUNE_PARAMS = [
    { id: 'tpCut', label: 'Sensitivity (lower = catches more)', min: 0.04, max: 0.8, step: 0.01, get: () => App.Pitch.cfg.salienceCut, set: (v) => App.Pitch.cfg.salienceCut = v, fmt: (v) => v.toFixed(2) },
    { id: 'tpRms', label: 'Noise gate (lower = quieter notes)', min: 0.001, max: 0.03, step: 0.001, get: () => App.Pitch.cfg.rmsGate, set: (v) => App.Pitch.cfg.rmsGate = v, fmt: (v) => v.toFixed(3) },
    { id: 'tpHarm', label: 'Harmonics summed', min: 1, max: 12, step: 1, get: () => App.Pitch.cfg.harmonics, set: (v) => App.Pitch.cfg.harmonics = v, fmt: (v) => String(v | 0) },
    { id: 'tpRefr', label: 'Refractory ms (gap between hits)', min: 0, max: 500, step: 10, get: () => micCfg.refractoryMs, set: (v) => micCfg.refractoryMs = v, fmt: (v) => String(v | 0) },
    { id: 'tpOnset', label: 'Onset ratio (lower = easier re-pluck)', min: 1.1, max: 3, step: 0.05, get: () => micCfg.onsetRatio, set: (v) => micCfg.onsetRatio = v, fmt: (v) => v.toFixed(2) },
  ];
  function saveTune() {
    localStorage.setItem('sr.mictune.v2', JSON.stringify({
      mode: App.Pitch.cfg.mode, rmsGate: App.Pitch.cfg.rmsGate, salienceCut: App.Pitch.cfg.salienceCut,
      harmonics: App.Pitch.cfg.harmonics, onsetRatio: micCfg.onsetRatio, refractoryMs: micCfg.refractoryMs,
    }));
  }
  function loadTune() {
    if (!App.Pitch) return;
    try {
      let t = JSON.parse(localStorage.getItem('sr.mictune.v2'));
      if (!t) {
        // migrate from v1: keep the detector prefs but drop the old onset/
        // refractory values — those params changed meaning (envelope-based
        // onset, refractory no longer re-arms), so reset them to new defaults.
        const old = JSON.parse(localStorage.getItem('sr.mictune'));
        if (old) t = { mode: old.mode, rmsGate: old.rmsGate, salienceCut: old.salienceCut, harmonics: old.harmonics };
      }
      if (!t) return;
      if (t.mode === 'mono' || t.mode === 'poly') App.Pitch.cfg.mode = t.mode;
      if (t.rmsGate != null) App.Pitch.cfg.rmsGate = t.rmsGate;
      if (t.salienceCut != null) App.Pitch.cfg.salienceCut = t.salienceCut;
      if (t.harmonics != null) App.Pitch.cfg.harmonics = t.harmonics;
      if (t.onsetRatio != null) micCfg.onsetRatio = Math.max(1.1, t.onsetRatio);
      if (t.refractoryMs != null) micCfg.refractoryMs = t.refractoryMs;
    } catch (e) {}
  }
  function buildMicTuneSliders() {
    const wrap = $('micTuneSliders');
    if (!wrap || wrap.childElementCount) return; // build once
    TUNE_PARAMS.forEach((pm) => {
      const row = el('label', 'tp-row');
      const head = el('div', 'tp-head');
      head.appendChild(Object.assign(el('span', 'tp-label'), { textContent: pm.label }));
      const valEl = Object.assign(el('span', 'tp-val'), { id: pm.id + 'V' });
      head.appendChild(valEl);
      const input = Object.assign(document.createElement('input'),
        { type: 'range', min: pm.min, max: pm.max, step: pm.step, id: pm.id, value: pm.get() });
      valEl.textContent = pm.fmt(+input.value);
      input.addEventListener('input', () => { const v = +input.value; pm.set(v); valEl.textContent = pm.fmt(v); saveTune(); });
      row.appendChild(head); row.appendChild(input);
      wrap.appendChild(row);
    });
  }
  function syncMicTuneSliders() {
    TUNE_PARAMS.forEach((pm) => { const i = $(pm.id), v = $(pm.id + 'V'); if (i) { i.value = pm.get(); if (v) v.textContent = pm.fmt(pm.get()); } });
  }
  function resetTune() {
    App.Pitch.cfg.mode = MIC_TUNE_DEFAULTS.mode;
    App.Pitch.cfg.rmsGate = MIC_TUNE_DEFAULTS.rmsGate;
    App.Pitch.cfg.salienceCut = MIC_TUNE_DEFAULTS.salienceCut;
    App.Pitch.cfg.harmonics = MIC_TUNE_DEFAULTS.harmonics;
    micCfg.onsetRatio = MIC_TUNE_DEFAULTS.onsetRatio;
    micCfg.refractoryMs = MIC_TUNE_DEFAULTS.refractoryMs;
    syncMicTuneSliders(); syncMicMode(); saveTune();
  }
  function wireMicMode() {
    const seg = $('mdModeSeg'); if (!seg || seg._wired) return; seg._wired = true;
    seg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { App.Pitch.cfg.mode = b.dataset.v; saveTune(); syncMicMode(); };
    });
  }
  function syncMicMode() {
    const seg = $('mdModeSeg'); if (!seg) return;
    const mono = App.Pitch.cfg.mode === 'mono';
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === App.Pitch.cfg.mode));
    // the salience-cut and harmonics sliders are polyphonic-only — dim in mono
    ['tpCut', 'tpHarm'].forEach((id) => { const i = $(id); const row = i && i.closest('.tp-row'); if (row) row.classList.toggle('disabled', mono); });
  }
  function showMicDebug(on) {
    const box = $('micDebug'); if (!box) return;
    box.style.display = on ? 'block' : 'none';
    if (on) { buildMicTuneSliders(); wireMicMode(); syncMicMode(); }
  }
  function updateMicDebug(p) {
    const box = $('micDebug'); if (!box || box.style.display === 'none') return;
    const rms = p ? p.rms : 0;
    const rmsEl = $('mdRms'); if (rmsEl) rmsEl.style.width = Math.max(0, Math.min(100, (rms / 0.05) * 100)) + '%';
    const heard = $('mdHeard');
    if (heard) {
      if (p && p.midi != null) {
        const { midi, cents } = App.Theory.centsOff(p.freq);
        heard.textContent = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1) + ' ' + (cents > 0 ? '+' : '') + cents + '¢';
      } else heard.textContent = '—';
    }
    const a = game.active;
    const tpc = a ? (((a.note.midi % 12) + 12) % 12) : -1;
    const tgt = $('mdTarget'); if (tgt) tgt.textContent = a ? (NOTE_NAMES[tpc] + (Math.floor(a.note.midi / 12) - 1)) : '—';
    const matched = !!(a && p && p.pcs && p.pcs.indexOf(tpc) !== -1);
    const mEl = $('mdMatch'); if (mEl) { mEl.textContent = a ? (matched ? '✓ would pass' : 'no match') : ''; mEl.className = 'md-match ' + (matched ? 'ok' : 'no'); }
    const notes = $('mdNotes');
    if (notes) {
      notes.innerHTML = '';
      ((p && p.candidates) || []).forEach((c) => {
        const chip = el('span', 'md-chip' + (c.on ? ' on' : '') + (c.pc === tpc ? ' tgt' : ''));
        chip.appendChild(Object.assign(el('b'), { textContent: NOTE_NAMES[c.pc] + (Math.floor(c.midi / 12) - 1) }));
        const bar = el('i'); bar.style.width = Math.round(c.rel * 100) + '%';
        chip.appendChild(bar);
        notes.appendChild(chip);
      });
      if (!notes.childElementCount) notes.appendChild(Object.assign(el('span', 'md-empty'), { textContent: 'play a note…' }));
    }
  }

  // ---- feedback -----------------------------------------------------------
  function flashScreen(kind) {
    const el = kind === 'good' ? $('flashGood') : $('flashBad');
    el.classList.remove('show');
    void el.offsetWidth; // restart animation
    el.classList.add('show');
  }
  function showPopup(text, big) {
    const p = $('popup');
    p.textContent = text;
    p.style.color = 'var(--good)';
    p.style.fontSize = big ? '30px' : '22px';
    p.style.left = (game._missX(staffRect) + 14) + 'px';
    p.style.top = (staffRect.h / 2 - 20) + 'px';
    p.classList.remove('show'); void p.offsetWidth; p.classList.add('show');
  }

  // ---- HUD ----------------------------------------------------------------
  function gameVisible() { return $('game').classList.contains('active'); }
  function updateHud() {
    $('hudScore').textContent = game.score;
    $('hudStreak').textContent = game.streak;
    const mult = game.multiplier();
    const mEl = $('hudMult');
    if (mult > 1) { mEl.textContent = '×' + mult; mEl.style.visibility = 'visible'; }
    else mEl.style.visibility = 'hidden';
    $('hudAcc').textContent = game.accuracy() + '%';
    const toNext = App.Stats.pointsToNext(liveScore());
    $('hudAward').textContent = toNext > 0 ? toNext.toLocaleString() + ' pts' : 'Ready! 🏆';
    const gemsEl = $('hudGems'); if (gemsEl) gemsEl.textContent = '💎 ' + App.Stats.gems() + (App.Stats.boxes() ? ' · 📦 ' + App.Stats.boxes() : '');
    if (game.bpm != null) $('hudBpm').textContent = game.bpm;
    const lick = $('hudLick');
    if (state.settings.mode !== 'random' && game.currentLickName) {
      lick.innerHTML = '♪ <b>' + escapeHtml(game.currentLickName) + '</b>' +
        (game.currentLickSource ? ' <span class="src">· ' + escapeHtml(game.currentLickSource) + '</span>' : '');
    } else { lick.textContent = ''; }
    updateLives();
  }
  function updateLives() {
    const el = $('hudLives');
    if (!state.settings.livesMode) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.textContent = '❤️'.repeat(Math.max(0, game.lives)) + '🤍'.repeat(Math.max(0, state.settings.lives - game.lives));
  }

  // ---- screens ------------------------------------------------------------
  function show(screen) {
    $('menu').classList.toggle('active', screen === 'menu');
    $('game').classList.toggle('active', screen === 'game');
  }

  function buildInstrument() {
    instrument = new App.Instruments.Instrument(instKey());
    instrument.setShowLabels(state.settings.showHints);
    game.configure(instrument, state.settings);
    resize();
  }

  async function startGame() {
    saveSettings();
    gameRecorded = false; // fresh recording state for this round
    show('game');          // make #game visible first so wrappers have real height
    // lazily load the selected genre's song shards before configuring the game
    if (state.settings.mode === 'licks' && App.Songs && App.Songs.has(state.settings.genre) && !App.Songs.loaded(state.settings.genre)) {
      $('countdown').textContent = 'Loading tunes…';
      $('countdownOverlay').classList.add('active');
      await App.Songs.ensure(state.settings.genre);
      $('countdownOverlay').classList.remove('active');
    }
    buildInstrument();     // configure + size canvases against the visible layout
    closeOverlays();
    updateLives();
    // countdown 3..2..1..Go
    const seq = ['3', '2', '1', 'Go!'];
    let idx = 0;
    $('countdownOverlay').classList.add('active');
    App.Audio.unlock();
    const tick = () => {
      $('countdown').textContent = seq[idx];
      idx++;
      if (idx <= seq.length) {
        countdownTimer = setTimeout(tick, idx === seq.length + 0 ? 450 : 650);
      }
      if (idx > seq.length) {
        $('countdownOverlay').classList.remove('active');
        game.start();
        updateHud();
      }
    };
    tick();
  }

  function closeOverlays() {
    ['countdownOverlay', 'pauseOverlay', 'overOverlay'].forEach((id) => $(id).classList.remove('active'));
  }

  function pauseGame() {
    if (game.status !== 'playing') return;
    game.pause();
    showMicDebug(state.settings.mic); // mic tuning/debug lives on the pause screen
    $('pauseOverlay').classList.add('active');
  }
  function resumeGame() { showMicDebug(false); $('pauseOverlay').classList.remove('active'); game.resume(); }

  // Fold a finished round into the local stats totals (once per game). Awards are
  // handled live during play / on first load, not here, so the menu stays calm.
  function recordGame() {
    if (gameRecorded || game.attempts <= 0) return;
    gameRecorded = true;
    const finalScore = Math.max(game.score, game.peakScore);
    App.Stats.recordGame(finalScore, game.elapsedMs, game.bestStreak);
  }

  function endGame() {
    recordGame();
    const s = App.Stats.get();
    $('ovScore').textContent = Math.max(game.score, game.peakScore);
    $('ovStreak').textContent = game.bestStreak;
    $('ovAcc').textContent = game.accuracy() + '%';
    $('newBest').innerHTML = `<span class="badge-new">Today: ${s.today.score.toLocaleString()} pts · ${fmtDur(s.today.timeMs)}</span>`;
    const ob = $('ovOpenBoxes');
    if (ob) { const n = App.Stats.boxes(); ob.style.display = n ? '' : 'none'; ob.textContent = `🎁 Open ${n} treasure ${n === 1 ? 'box' : 'boxes'}`; }
    $('overOverlay').classList.add('active');
  }

  function quitToMenu() {
    if (countdownTimer) clearTimeout(countdownTimer);
    recordGame();
    game.status = 'over';
    closeOverlays();
    show('menu');
    renderMenu();
  }

  // ---- milestones & celebration screens -----------------------------------
  // Celebrations only appear in one of two "opportunity windows" — first page
  // load, or once enough practice has accumulated (the award window) — AND only
  // when a milestone is actually reached. Awards are cumulative-score tiers that
  // require progressively more effort; the window cadence scales with practice.
  function fmtDur(ms) {
    const sec = Math.floor((ms || 0) / 1000);
    if (sec >= 3600) { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return m ? `${h}h ${m}m` : `${h}h`; }
    if (sec >= 60) return `${Math.floor(sec / 60)}m`;
    return `${sec}s`;
  }
  function celebrate(opts) {
    if (!App.Celebrate) return;
    App.Audio.unlock();           // let the fanfare through (resumes the audio ctx)
    App.Celebrate.show(opts);
  }
  function awardOpts(award) {
    return { kind: 'score', kicker: 'AWARD UNLOCKED', title: award.value.toLocaleString() + ' POINTS!' };
  }
  // Live cumulative all-time score (recorded total + the in-progress game).
  function liveScore() { return App.Stats.get().allTime.score + (game ? game.score : 0); }

  // During practice: reaching an award milestone celebrates immediately, right
  // in the game — pause, show the screen, resume when dismissed. Pacing comes
  // from the widening score tiers themselves (each award needs progressively
  // more points), so no extra time-window gate here.
  function checkAwardDuringPlay() {
    const award = App.Stats.tryAward(liveScore(), game.elapsedMs, true);
    if (!award) return;
    if (game.status === 'playing') game.pause();
    celebrate(Object.assign(awardOpts(award), {
      durationMs: 5200,
      onClose: () => { if (gameVisible() && game.status === 'paused') game.resume(); },
    }));
  }

  // On first page load only: show one celebration — a day-streak milestone if
  // one was just reached, otherwise a pending score award (window forced open).
  function bootCelebration() {
    if (App.Celebrate && App.Celebrate.isActive()) return;
    const sm = App.Stats.streakMilestone(lastStreak);
    if (sm) { celebrate({ kind: 'streak', kicker: 'ON A ROLL', title: lastStreak + '-DAY STREAK! 🔥' }); return; }
    const award = App.Stats.tryAward(liveScore(), 0, true);
    if (award) celebrate(awardOpts(award));
  }

  // ---- menu rendering -----------------------------------------------------
  // Instruments are grouped into family "stacks": one tap opens a family, a
  // second tap picks an instrument inside it.
  const INSTRUMENT_FAMILIES = [
    { name: 'Keyboard', members: ['piano'] },
    { name: 'Plucked strings', members: ['guitar', 'bassGuitar', 'ukulele', 'banjo', 'mandolin'] },
    { name: 'Bowed strings', members: ['violin', 'viola', 'cello', 'doubleBass'] },
    { name: 'Voice', members: ['soprano', 'alto', 'tenor', 'bass'] },
  ];
  const familyOf = (inst) => INSTRUMENT_FAMILIES.findIndex((f) => f.members.indexOf(inst) !== -1);
  let openFamily = null; // index of the currently expanded stack

  function selectInstrument(key) {
    state.inst = key;
    openFamily = familyOf(key);
    saveSettings();
    renderInstrumentCards();
  }
  function renderInstrumentCards() {
    const grid = $('instrumentGrid');
    if (grid) {
      if (openFamily == null) openFamily = familyOf(state.inst); // open the selected family
      grid.innerHTML = '';
      INSTRUMENT_FAMILIES.forEach((fam, fi) => {
        const single = fam.members.length === 1;
        const selKey = fam.members.indexOf(state.inst) !== -1 ? state.inst : null;
        const open = openFamily === fi;
        const stack = el('div', 'inst-stack' + (open ? ' open' : '') + (selKey ? ' selected' : ''));

        const head = el('button', 'inst-stack-head');
        head.appendChild(Object.assign(el('span', 'emoji'), { textContent: DEFS[selKey || fam.members[0]].icon }));
        const txt = el('span', 'st-text');
        txt.appendChild(Object.assign(el('span', 'label'), { textContent: fam.name }));
        txt.appendChild(Object.assign(el('span', 'sub'), {
          textContent: selKey ? DEFS[selKey].name : (single ? '' : fam.members.length + ' instruments'),
        }));
        head.appendChild(txt);
        if (!single) head.appendChild(Object.assign(el('span', 'chev'), { textContent: open ? '▾' : '▸' }));
        head.onclick = () => {
          if (single) { selectInstrument(fam.members[0]); return; }
          openFamily = open ? null : fi;
          renderInstrumentCards();
        };
        stack.appendChild(head);

        if (!single) {
          const body = el('div', 'inst-stack-body');
          fam.members.forEach((key) => {
            const d = DEFS[key];
            const card = el('button', 'inst-card' + (key === state.inst ? ' selected' : ''));
            card.appendChild(Object.assign(el('span', 'emoji'), { textContent: d.icon }));
            card.appendChild(Object.assign(el('span', 'label'), { textContent: d.name }));
            card.onclick = () => selectInstrument(key);
            body.appendChild(card);
          });
          stack.appendChild(body);
        }
        grid.appendChild(stack);
      });
    }
    $('clefSetting').style.display = state.inst === 'piano' ? '' : 'none';
  }

  function renderSegmented(segId, value) {
    document.querySelectorAll('#' + segId + ' button').forEach((b) => b.classList.toggle('on', b.dataset.v === value));
  }
  function renderToggle(id, on) { $(id).classList.toggle('on', !!on); }

  function renderAccount() {
    const box = $('accountBox');
    const p = App.Auth.getProfile();
    box.innerHTML = '';
    if (p) {
      const av = el('div', 'avatar');
      if (p.picture) { const img = document.createElement('img'); img.src = p.picture; img.referrerPolicy = 'no-referrer'; av.appendChild(img); }
      else av.textContent = (p.name || '?').slice(0, 1).toUpperCase();
      const who = el('div', 'who');
      who.innerHTML = `<div class="name">${escapeHtml(p.name)}</div><div class="meta">${p.google ? 'Google account' : 'Local profile'}</div>`;
      const out = el('button', 'link-btn'); out.textContent = 'Sign out';
      out.onclick = () => { App.Auth.signOut(); };
      box.append(av, who, out);
    } else {
      const row = el('div', 'signin-row');
      const input = document.createElement('input');
      input.placeholder = 'Enter a name to track scores';
      input.maxLength = 24;
      const go = el('button', 'link-btn'); go.textContent = 'Play as guest';
      go.onclick = () => App.Auth.signInGuest(input.value);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
      row.append(input, go);
      box.appendChild(row);
      if (App.Auth.googleAvailable) {
        const host = el('div'); host.id = 'googleBtnHost'; box.appendChild(host);
        App.Auth.renderGoogleButton(host);
      }
    }
  }

  // "This is me" picker — only surfaces when more than one local profile exists
  // on the device (e.g. created across tabs/sessions). Selecting one makes it the
  // active player; same-named profiles are already deduped by the stats store.
  function renderProfiles() {
    const host = $('profilePicker'); if (!host) return;
    const list = App.Stats.listProfiles();
    if (list.length <= 1) { host.style.display = 'none'; host.innerHTML = ''; return; }
    host.style.display = '';
    host.innerHTML = '<div class="pp-hint">Found more than one local profile on this device — pick the one that’s you (we keep all your progress on whichever you choose):</div>';
    const grid = el('div', 'profile-grid');
    list.forEach((p) => {
      const nm = p.name || 'Unnamed player';
      const card = el('button', 'profile-card' + (p.active ? ' active' : ''));
      card.innerHTML = `<span class="pf-name">${escapeHtml(nm)}</span>`
        + `<span class="pf-meta">${p.score.toLocaleString()} pts · ${fmtDur(p.timeMs)}</span>`
        + (p.active ? '<span class="pf-badge">✓ me</span>' : '');
      card.onclick = () => {
        if (p.active) return;
        if (p.name) App.Auth.signInGuest(p.name);     // drives selection + account box
        else { App.Stats.selectProfile(p.id); App.Auth.signOut(); }
        renderMenu();
      };
      const del = el('span', 'pf-del'); del.textContent = '×'; del.title = 'Remove this profile';
      del.onclick = (e) => {
        e.stopPropagation();
        if (window.confirm(`Remove the local profile “${nm}”? This can’t be undone.`)) { App.Stats.deleteProfile(p.id); renderMenu(); }
      };
      card.appendChild(del);
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  function renderStats() {
    const host = $('statsPanel'); if (!host) return;
    const s = App.Stats.get();
    const p = App.Auth.getProfile();
    const name = (s.name || (p && p.name) || '').trim();
    const cards = [
      ['Player', name || '—', false],
      ['Day streak', lastStreak + ' 🔥', lastStreak > 1],
      ['Longest daily streak', (s.bestDayStreak || 0) + ' 🔥', false],
      ['Last score', s.lastScore.toLocaleString(), false],
      ['Best score today', (s.today.bestScore || 0).toLocaleString(), (s.today.bestScore || 0) > 0],
      ['Score today', s.today.score.toLocaleString(), false],
      ['Best streak today', (s.today.bestStreak || 0) + ' 🔥', false],
      ['Best streak all-time', (s.allTime.bestStreak || 0) + ' 🔥', (s.allTime.bestStreak || 0) > 0],
      ['Time today', fmtDur(s.today.timeMs), false],
      ['Score all-time', s.allTime.score.toLocaleString(), false],
      ['Time all-time', fmtDur(s.allTime.timeMs), false],
    ];
    host.innerHTML = cards.map(([k, v, hl]) =>
      `<div class="stat-card${hl ? ' hl' : ''}"><div class="k">${k}</div><div class="v">${escapeHtml(String(v))}</div></div>`).join('');
  }

  // ---- treasure: gems, boxes, shop ---------------------------------------
  function bankTreasure() {
    App.Stats.bankBox();
    if (state.settings.sound) { App.Audio.playMidi(88, 0.18); App.Audio.playMidi(93, 0.28); }
    showPopup('📦 Treasure!', true);
    updateHud();
  }
  // Open every banked box in turn, each as a treasure-vault celebration.
  function openBoxes() {
    const box = App.Stats.openBox();
    if (!box) { updateHud(); if (!gameVisible()) renderMenu(); return; }
    const sub = { common: 'A little something!', nice: 'Nice haul!', rare: 'A rare find!', jackpot: '💰 JACKPOT! 💰' };
    celebrate({
      theme: 'treasure',
      kicker: box.tier === 'jackpot' ? 'JACKPOT' : 'TREASURE',
      title: '+' + box.gems + ' 💎',
      sub: sub[box.tier] || 'Treasure!',
      durationMs: box.tier === 'jackpot' ? 5200 : 3600,
      onClose: () => { if (App.Stats.boxes() > 0) setTimeout(openBoxes, 200); else { updateHud(); if (!gameVisible()) renderMenu(); } },
    });
  }
  function renderTreasure() {
    const host = $('treasurePanel'); if (!host) return;
    const s = App.Stats.get();
    const cost = App.Stats.SHOP.freeze;
    const canFreeze = s.gems >= cost;
    host.innerHTML =
      `<div class="treasure-bal"><span class="t-gem">💎 ${s.gems.toLocaleString()}</span><span class="t-box">📦 ${s.boxes} ${s.boxes === 1 ? 'box' : 'boxes'}</span><span class="t-frz">🛡️ ${s.freezes}</span></div>`;
    const open = el('button', 'btn-treasure'); open.textContent = s.boxes > 0 ? `Open ${s.boxes} treasure ${s.boxes === 1 ? 'box' : 'boxes'} 🎁` : 'No boxes yet — clear 💎 treasure notes to earn them';
    open.disabled = s.boxes === 0; open.onclick = () => { if (App.Stats.boxes() > 0) openBoxes(); };
    host.appendChild(open);
    const shop = el('div', 'shop-row');
    const buy = el('button', 'link-btn'); buy.textContent = `🛡️ Buy Streak Freeze · ${cost} 💎`;
    buy.disabled = !canFreeze;
    buy.onclick = () => { if (App.Stats.buyFreeze()) { if (state.settings.sound) App.Audio.playMidi(80, 0.2); renderTreasure(); renderStats(); } };
    const hint = el('span', 'desc'); hint.textContent = 'A Streak Freeze protects your day streak if you miss a day.';
    shop.append(buy, hint); host.appendChild(shop);
  }
  function renderPassport() {
    const host = $('passportPanel'); if (!host) return;
    const places = (App.Celebrate && App.Celebrate._debug && App.Celebrate._debug.PLACES) || [];
    const sum = App.Stats.passportSummary(places);
    const pct = sum.total ? Math.round((sum.collected / sum.total) * 100) : 0;
    // distinct collected places (flag + city), with visit-count badges
    const seen = {}; const collected = [];
    places.forEach((p) => { const k = p.city + '|' + p.country; if (sum.has(k) && !seen[k]) { seen[k] = 1; collected.push(p); } });
    const s = App.Stats.get();
    let html = `<div class="pp-head"><b>${sum.collected}</b> / ${sum.total} cities collected · ${pct}%`
      + `<div class="pp-bar"><span style="width:${pct}%"></span></div></div>`;
    if (!collected.length) {
      html += '<div class="lib-empty" style="padding:10px 2px;">No postcards yet — reach a milestone to tour the world and start collecting. 🌍</div>';
    } else {
      html += '<div class="pp-grid">' + collected.sort((a, b) => a.country.localeCompare(b.country) || a.city.localeCompare(b.city))
        .map((p) => { const c = s.passport[p.city + '|' + p.country] || 1; return `<span class="pp-card" title="${escapeHtml(p.country)}">${p.flag} ${escapeHtml(p.city)}${c > 1 ? ` <b class="pp-n">×${c}</b>` : ''}</span>`; }).join('')
        + '</div>';
      const remain = sum.total - sum.collected;
      if (remain > 0) html += `<div class="desc" style="margin-top:8px;">${remain} more ${remain === 1 ? 'city' : 'cities'} to discover…</div>`;
    }
    host.innerHTML = html;
  }

  function renderGenreChips() {
    const host = $('genreChips');
    if (!host.childElementCount) {
      (App.Licks ? App.Licks.GENRES : []).forEach((g) => {
        const b = document.createElement('button');
        b.dataset.v = g.key; b.textContent = g.label;
        b.onclick = () => {
          state.settings.genre = g.key; saveSettings(); markGenre(); updateFolkStatus();
          if (App.Songs && App.Songs.has(g.key) && !App.Songs.loaded(g.key)) App.Songs.ensure(g.key).then(updateFolkStatus);
        };
        host.appendChild(b);
      });
    }
    markGenre();
  }
  function markGenre() {
    document.querySelectorAll('#genreChips button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.settings.genre));
  }
  function updateModeVisibility() {
    const m = state.settings.mode;
    $('genreSetting').style.display = m === 'licks' ? '' : 'none';
    $('scalesSetting').style.display = m === 'scales' ? '' : 'none';
    $('librarySetting').style.display = m === 'library' ? '' : 'none';
    $('octaveSetting').style.display = m === 'random' ? 'none' : ''; // not used in random mode
  }

  // ---- Scales style: multiselect scale-type chips, grouped by family ------
  function renderScaleChips() {
    const host = $('scaleChips');
    if (!host.childElementCount && App.Scales) {
      const groups = {};
      App.Scales.TYPES.forEach((t) => { (groups[t.family] = groups[t.family] || []).push(t); });
      Object.keys(groups).forEach((fam) => {
        const wrap = el('div', 'chip-group');
        wrap.appendChild(Object.assign(el('div', 'chip-group-label'), { textContent: fam }));
        const seg = el('div', 'segmented wrap');
        groups[fam].forEach((t) => {
          const b = document.createElement('button');
          b.dataset.k = t.key; b.textContent = t.name;
          b.onclick = () => { toggleScaleType(t.key); };
          seg.appendChild(b);
        });
        wrap.appendChild(seg);
        host.appendChild(wrap);
      });
    }
    markScaleChips();
  }
  function toggleScaleType(key) {
    const set = new Set(state.settings.scaleTypes || []);
    if (set.has(key)) set.delete(key); else set.add(key);
    if (!set.size) set.add(key); // keep at least one selected
    state.settings.scaleTypes = [...set];
    saveSettings(); markScaleChips();
  }
  function markScaleChips() {
    const sel = new Set(state.settings.scaleTypes || []);
    document.querySelectorAll('#scaleChips button').forEach((b) => b.classList.toggle('on', sel.has(b.dataset.k)));
  }

  // ---- Library: search + multiselect of scales, pieces & imported files ---
  function renderLibrary() {
    renderLibrarySelected();
    renderLibraryList($('librarySearch') ? $('librarySearch').value : '');
  }
  function renderLibrarySelected() {
    const host = $('librarySelected'); if (!host) return;
    host.innerHTML = '';
    const ids = state.settings.libraryIds || [];
    if (!ids.length) { host.innerHTML = '<span class="lib-empty">Nothing picked yet — tick items below.</span>'; return; }
    ids.forEach((id) => {
      const it = App.Library && App.Library.byId(id);
      const chip = el('span', 'lib-chip');
      chip.textContent = it ? it.name : id;
      const x = el('button', 'lib-x'); x.textContent = '×'; x.setAttribute('aria-label', 'Remove');
      x.onclick = () => { toggleLibraryId(id); };
      chip.appendChild(x);
      host.appendChild(chip);
    });
  }
  function renderLibraryList(query) {
    const host = $('libraryList'); if (!host || !App.Library) return;
    const sel = new Set(state.settings.libraryIds || []);
    const rows = App.Library.search(query, 200);
    host.innerHTML = '';
    if (!rows.length) { host.innerHTML = '<div class="lib-empty" style="padding:12px;">No matches.</div>'; return; }
    rows.forEach((it) => {
      const row = el('button', 'lib-row');
      row.classList.toggle('on', sel.has(it.id));
      row.innerHTML = '<span class="lib-check">' + (sel.has(it.id) ? '✓' : '') + '</span>' +
        '<span class="lib-name">' + escapeHtml(it.name) + '</span>' +
        '<span class="lib-group">' + escapeHtml(it.group) + '</span>';
      row.onclick = () => { toggleLibraryId(it.id); };
      host.appendChild(row);
    });
  }
  function toggleLibraryId(id) {
    const ids = (state.settings.libraryIds || []).slice();
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1); else ids.push(id);
    state.settings.libraryIds = ids;
    saveSettings(); renderLibrary();
  }

  async function openFile(file) {
    if (!file || !App.Import) return;
    try {
      const piece = await App.Import.parseFile(file);
      const item = App.Import.register(piece);
      // auto-select it and make sure we're in Library mode
      const ids = (state.settings.libraryIds || []).slice();
      if (!ids.includes(item.id)) ids.push(item.id);
      state.settings.libraryIds = ids;
      state.settings.mode = 'library';
      saveSettings();
      renderSegmented('segMode', 'library'); updateModeVisibility(); renderLibrary();
    } catch (e) {
      window.alert('Could not open “' + file.name + '”.\n\n' + (e && e.message ? e.message : e));
    }
  }

  function renderMenu() {
    renderInstrumentCards();
    renderSegmented('segMode', state.settings.mode);
    renderGenreChips();
    renderScaleChips();
    renderLibrary();
    updateModeVisibility();
    renderSegmented('segDifficulty', state.settings.difficulty);
    renderSegmented('segSpeed', state.settings.speed);
    renderSegmented('segTimeSig', state.settings.timeSig);
    renderSegmented('segClef', state.settings.clef);
    renderToggle('tglHints', state.settings.showHints);
    renderToggle('tglSound', state.settings.sound);
    renderToggle('tglLives', state.settings.livesMode);
    renderToggle('tglRandomKey', state.settings.randomKey);
    renderToggle('tglOctave', state.settings.octaveShift);
    renderToggle('tglMetro', state.settings.metronome);
    renderToggle('tglMic', state.settings.mic);
    renderAccount();
    renderProfiles();
    renderStats();
    renderTreasure();
    renderPassport();
  }

  // ---- daily visit streak ("welcome back!") -------------------------------
  // Detect a returning player via localStorage and track a day-by-day streak:
  // same day keeps the count, a consecutive day increments it, a longer gap
  // resets it to 1. Runs once per load.
  function bumpDayStreak() {
    const KEY = 'sr.visit';
    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (local-ish)
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    let count = 1, returning = false, froze = 0;
    if (rec && rec.last) {
      returning = true;
      const days = Math.round((Date.parse(todayStr) - Date.parse(rec.last)) / 86400000);
      if (days <= 0) count = rec.count || 1;            // same day (or clock skew)
      else if (days === 1) count = (rec.count || 0) + 1; // consecutive day → streak++
      else {                                             // gap — try to spend Streak Freezes to bridge it
        const missed = days - 1;
        while (froze < missed && App.Stats.useFreeze()) froze++;
        count = (froze >= missed) ? (rec.count || 0) + 1 : 1;
      }
    }
    try { localStorage.setItem(KEY, JSON.stringify({ last: todayStr, count })); } catch (e) {}
    return { count, returning, froze };
  }
  function renderWelcome() {
    const { count, returning, froze } = bumpDayStreak();
    lastStreak = count; // surfaced in the stats panel + drives the streak celebration
    App.Stats.recordDayStreak(count); // keep the all-time longest daily streak
    const el = $('welcomeBack'); if (!el) return;
    if (!returning) { el.style.display = 'none'; return; } // first-ever visit — stay quiet
    el.style.display = '';
    if (froze > 0) el.textContent = `🛡️ Streak Freeze saved your ${count}-day streak! 🔥`;
    else el.textContent = count > 1 ? `👋 Welcome back! ${count}-day streak 🔥` : '👋 Welcome back!';
  }

  // ---- small DOM helpers --------------------------------------------------
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---- event bindings -----------------------------------------------------
  function bind() {
    // instrument family stacks are rendered (with their own click handlers) in
    // renderInstrumentCards()
    bindSeg('segMode', (v) => { state.settings.mode = v; updateModeVisibility(); });
    const libSearch = $('librarySearch');
    if (libSearch) libSearch.addEventListener('input', () => renderLibraryList(libSearch.value));
    const openBtn = $('openFileBtn'), fileInput = $('fileInput');
    if (openBtn && fileInput) {
      openBtn.onclick = () => fileInput.click();
      fileInput.addEventListener('change', () => { if (fileInput.files && fileInput.files[0]) openFile(fileInput.files[0]); fileInput.value = ''; });
    }
    bindSeg('segDifficulty', (v) => { state.settings.difficulty = v; });
    bindSeg('segSpeed', (v) => { state.settings.speed = v; });
    bindSeg('segTimeSig', (v) => { state.settings.timeSig = v; });
    bindSeg('segClef', (v) => { state.settings.clef = v; });
    bindToggle('tglHints', () => { state.settings.showHints = !state.settings.showHints; renderToggle('tglHints', state.settings.showHints); });
    bindToggle('tglSound', () => { state.settings.sound = !state.settings.sound; App.Audio.setEnabled(state.settings.sound); renderToggle('tglSound', state.settings.sound); });
    bindToggle('tglLives', () => { state.settings.livesMode = !state.settings.livesMode; renderToggle('tglLives', state.settings.livesMode); });
    bindToggle('tglRandomKey', () => { state.settings.randomKey = !state.settings.randomKey; renderToggle('tglRandomKey', state.settings.randomKey); });
    bindToggle('tglOctave', () => { state.settings.octaveShift = !state.settings.octaveShift; renderToggle('tglOctave', state.settings.octaveShift); });
    bindToggle('tglMetro', () => { state.settings.metronome = !state.settings.metronome; renderToggle('tglMetro', state.settings.metronome); });
    $('tglMic').onclick = async () => {
      if (!state.settings.mic) {
        const ok = await enableMic();
        if (!ok) { window.alert('Microphone unavailable.\nServe the app over https or http://localhost (the mic can’t be used from a file:// page), then allow access.'); return; }
        state.settings.mic = true;
      } else {
        App.Pitch.stop();
        state.settings.mic = false;
      }
      showTuner(state.settings.mic);
      renderToggle('tglMic', state.settings.mic);
      saveSettings();
    };

    $('startBtn').onclick = startGame;
    $('tempoDown').onclick = () => { game.adjustBpm(-5); updateHud(); };
    $('tempoUp').onclick = () => { game.adjustBpm(5); updateHud(); };
    $('pauseBtn').onclick = pauseGame;
    $('menuBtn').onclick = quitToMenu;
    $('resumeBtn').onclick = resumeGame;
    $('quitBtn').onclick = quitToMenu;
    const micReset = $('micTuneReset'); if (micReset) micReset.onclick = resetTune;
    $('againBtn').onclick = startGame;
    $('overMenuBtn').onclick = quitToMenu;
    const ob = $('ovOpenBoxes'); if (ob) ob.onclick = openBoxes;

    const ic = $('instrument');
    ic.addEventListener('pointerdown', onTap);
    ic.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());

    App.Auth.onChange((p) => { if (p && p.name) App.Stats.selectOrCreateByName(p.name); saveSettings(); if (gameVisible()) return; renderMenu(); });
  }
  function bindSeg(id, fn) {
    document.querySelectorAll('#' + id + ' button').forEach((b) => {
      b.onclick = () => { fn(b.dataset.v); saveSettings(); renderSegmented(id, b.dataset.v); };
    });
  }
  function bindToggle(id, fn) { $(id).onclick = () => { fn(); saveSettings(); }; }

  // ---- Google SSO (optional) + service worker -----------------------------
  function initAuthAndSW() {
    const served = location.protocol === 'http:' || location.protocol === 'https:';
    if (GOOGLE_CLIENT_ID && served) {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => { App.Auth.init(GOOGLE_CLIENT_ID); renderMenu(); };
      s.onerror = () => App.Auth.init('');
      document.head.appendChild(s);
    } else {
      App.Auth.init('');
    }
    if ('serviceWorker' in navigator && served) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // ---- boot ---------------------------------------------------------------
  // debug accessor (harmless): inspect live game/instrument from the console
  App.debug = { game: () => game, instrument: () => instrument };

  // Preview the celebration screens (great for browsing the world tour): call
  // App.previewCelebrations() in the console, or open the page with #celebrate.
  App.previewCelebrations = function (theme) {
    if (!App.Celebrate) return;
    App.Audio.unlock();
    App.Celebrate.show({
      kicker: 'PREVIEW', title: 'WORLD TOUR', sub: 'Cycling celebration screens…',
      theme, durationMs: 6000,
      onClose: () => setTimeout(() => App.previewCelebrations(theme), 250),
    });
  };
  if (/celebrate/i.test(location.hash)) setTimeout(() => App.previewCelebrations('city'), 700);

  function datasetLabel(src) {
    src = src || '';
    if (/thesession/i.test(src)) return 'thesession.org';
    if (/Nottingham/i.test(src)) return 'Nottingham DB';
    if (/Weimar/i.test(src)) return 'Weimar Jazz DB';
    if (/OpenEWLD/i.test(src)) return 'OpenEWLD';
    if (/POP909/i.test(src)) return 'POP909';
    if (/ADL/i.test(src)) return 'ADL piano';
    if (/generated/i.test(src)) return 'generated licks';
    return 'curated licks';
  }
  // Show the ACTUAL source datasets for the selected genre (not all thesession!).
  function updateFolkStatus() {
    const el = $('folkStatus');
    if (!el) return;
    const g = state.settings.genre;
    if (App.Songs && App.Songs.has(g) && !App.Songs.loaded(g)) { el.textContent = 'Loading tunes…'; return; }
    let pool = [];
    try { pool = App.Licks ? App.Licks.get(g) : []; } catch (e) {}
    if (g === 'folk' && App.FolkTunes) pool = pool.concat(App.FolkTunes.tunes());
    if (!pool.length) { el.textContent = ''; return; }
    const seen = new Set(), order = [];
    pool.forEach((l) => { const d = datasetLabel(l.source); if (!seen.has(d)) { seen.add(d); order.push(d); } });
    el.textContent = 'Sources: ' + order.join(', ') + ' · ' + pool.length.toLocaleString() + ' items';
  }

  function boot() {
    loadSettings();
    loadTune(); // restore saved mic-detection tuning
    App.Audio.setEnabled(state.settings.sound);
    bind();
    initAuthAndSW();
    renderWelcome();
    renderMenu();
    resize();
    // first-page-load celebration (streak milestone, or a pending score award)
    setTimeout(bootCelebration, 800);
    if (App.FolkTunes) {
      App.FolkTunes.onLoad(() => { updateFolkStatus(); if (!gameVisible()) renderLibrary(); });
      App.FolkTunes.load(1000);
      updateFolkStatus();
    }
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.App = window.App || {});
