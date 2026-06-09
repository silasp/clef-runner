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
  const micState = { lastFire: null, stableMidi: null, stableCount: 0, silentFrames: 0, armed: true, frame: 0 };
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
      showPopup(res.multiplier > 1 ? `+${res.multiplier}` : '+1', res.multiplier > 1);
    } else {
      instrument.flashCell(cell.id, 'bad');
      flashScreen('bad');
      if (state.settings.sound) App.Audio.playError();
    }
    updateHud();
  }

  // ---- microphone play-along ---------------------------------------------
  function detectMic() {
    if (!App.Pitch || !App.Pitch.isRunning() || game.status !== 'playing') return;
    micState.frame++;
    if (micState.frame % 2 !== 0) return; // ~30 Hz is plenty
    const p = App.Pitch.detect();
    if (!p || p.midi == null) {
      micState.silentFrames++;
      if (micState.silentFrames > 2) { micState.armed = true; micState.stableMidi = null; micState.stableCount = 0; updateTuner(null); }
      return;
    }
    micState.silentFrames = 0;
    updateTuner(p.freq);
    if (p.midi === micState.stableMidi) micState.stableCount++;
    else { micState.stableMidi = p.midi; micState.stableCount = 1; }
    if (micState.stableCount === 2 && (micState.armed || p.midi !== micState.lastFire)) {
      handleMicNote(p.midi);
      micState.lastFire = p.midi; micState.armed = false;
    }
  }
  function handleMicNote(midi) {
    const res = game.handleMic(midi);
    if (res && res.result === 'good') {
      instrument.cellsForMidi(res.note.midi).forEach((c) => instrument.flashCell(c.id, 'good'));
      flashScreen('good');
      showPopup(res.multiplier > 1 ? `+${res.multiplier}` : '+1', res.multiplier > 1);
      updateHud();
    }
  }
  async function enableMic() {
    try { await App.Pitch.start(); return true; }
    catch (e) { return false; }
  }
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  function updateTuner(freq) {
    const el = $('tuner'); if (!el) return;
    if (!freq) { el.classList.remove('lit'); $('tunerNote').textContent = '—'; $('tunerCents').textContent = ''; $('tunerNeedle').style.left = '50%'; return; }
    const { midi, cents } = App.Theory.centsOff(freq);
    el.classList.add('lit');
    el.classList.toggle('intune', Math.abs(cents) <= 12);
    $('tunerNote').textContent = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    $('tunerCents').textContent = (cents > 0 ? '+' : '') + cents + '¢';
    $('tunerNeedle').style.left = Math.max(2, Math.min(98, 50 + cents)) + '%';
  }
  function showTuner(on) { const el = $('tuner'); if (el) el.style.display = on ? 'flex' : 'none'; if (on) updateTuner(null); }

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
    $('pauseOverlay').classList.add('active');
  }
  function resumeGame() { $('pauseOverlay').classList.remove('active'); game.resume(); }

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

  // During practice: if the award window is open AND the cumulative-score
  // milestone is reached, pause, celebrate, and resume when dismissed.
  function checkAwardDuringPlay() {
    const award = App.Stats.tryAward(liveScore(), game.elapsedMs, false);
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
  function renderInstrumentCards() {
    document.querySelectorAll('#instrumentGrid .inst-card').forEach((b) => {
      b.classList.toggle('selected', b.dataset.inst === state.inst);
    });
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
    renderStats();
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
    let count = 1, returning = false;
    if (rec && rec.last) {
      returning = true;
      const days = Math.round((Date.parse(todayStr) - Date.parse(rec.last)) / 86400000);
      if (days <= 0) count = rec.count || 1;            // same day (or clock skew)
      else if (days === 1) count = (rec.count || 0) + 1; // consecutive day → streak++
      else count = 1;                                    // gap → streak reset
    }
    try { localStorage.setItem(KEY, JSON.stringify({ last: todayStr, count })); } catch (e) {}
    return { count, returning };
  }
  function renderWelcome() {
    const { count, returning } = bumpDayStreak();
    lastStreak = count; // surfaced in the stats panel + drives the streak celebration
    App.Stats.recordDayStreak(count); // keep the all-time longest daily streak
    const el = $('welcomeBack'); if (!el) return;
    if (!returning) { el.style.display = 'none'; return; } // first-ever visit — stay quiet
    el.style.display = '';
    el.textContent = count > 1 ? `👋 Welcome back! ${count}-day streak 🔥` : '👋 Welcome back!';
  }

  // ---- small DOM helpers --------------------------------------------------
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---- event bindings -----------------------------------------------------
  function bind() {
    document.querySelectorAll('#instrumentGrid .inst-card').forEach((b) => {
      b.onclick = () => { state.inst = b.dataset.inst; saveSettings(); renderInstrumentCards(); };
    });
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
    $('againBtn').onclick = startGame;
    $('overMenuBtn').onclick = quitToMenu;

    const ic = $('instrument');
    ic.addEventListener('pointerdown', onTap);
    ic.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());

    App.Auth.onChange((p) => { App.Stats.setName(p ? p.name : ''); saveSettings(); if (gameVisible()) return; renderMenu(); });
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
