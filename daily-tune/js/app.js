// Daily Tune — UI shell. Screens: home (path), tune, lesson, results, settings.
// One part per tune (the melody), learned chunk by chunk with spaced repetition.

import { noteName, scaleDegree, keyName } from './music.js';
import { cardId, itemNotes, partStatus, nextNewItem, ensureCard, markKnown, unmarkKnown, isKnownSkip } from './curriculum.js';
import { buildLesson, nextNoteQuestion, listenChooseQuestion, makeRng, allowed, EXERCISE_TYPES } from './lesson.js';
import { review, dayNumber, dueCards, cueMask, LEARNED_LEVEL, MEMORISED_LEVEL } from './srs.js';
import { XP, addXp, goalProgress, level as levelOf, checkBadges, setSkip, capabilities, rollStreak, BADGES, initialState } from './game.js';
import { load, save, exportJson, importJson } from './store.js';
import { renderStaff, renderContour } from './notation.js';
import { mountKeyboard, rangeFor, hasKeyboard } from './keyboard.js';
import { framesToNotes, alignPitches, combineScores } from './scoring.js';
import * as audio from './audio.js';
import { listen, hasMic } from './mic.js';
import { prepareTunes } from './tunes.js';

const PART = 'Melody';
const PATH_LIMIT = 60;          // rows drawn at once (an old phone stays quick); search reaches all
const $ = (s, el = document) => el.querySelector(s);
const app = document.getElementById('app');
let state = load();
let ALL = [];                   // every tune
let LEARN = [];                 // tunes in the chosen genre
let BY_ID = {};
let lesson = null;

const today = () => dayNumber();
const persist = () => save(state);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const caps = () => capabilities(state, Date.now(), { hasMic: hasMic(), hasAudio: audio.hasAudio() });
const tempo = () => state.settings.tempo || 1.5;     // quarter notes per second (1.5 = 90 bpm)
const GENRES = { all: 'All tunes', folk: 'Folk', jazz: 'Swing & jazz' };

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    const raw = await (await fetch('data/tunes.json')).json();
    ALL = prepareTunes(raw.tunes, PART);
  } catch (e) {
    app.innerHTML = `<div class="screen"><p class="err">Couldn't load the tune library. ${esc(e.message)}</p></div>`;
    return;
  }
  BY_ID = Object.fromEntries(ALL.map(t => [t.id, t]));
  filterGenre();
  rollStreak(state, today());
  persist();
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function filterGenre() {
  const g = state.settings.genre || 'all';
  const started = new Set(Object.keys(state.cards).map(k => k.split(':')[0]));
  // keep tunes already started even when the filter changes
  LEARN = ALL.filter(t => g === 'all' || t.genre === g || started.has(t.id));
}

function route() {
  audio.stopAll();
  const h = location.hash.slice(1);
  if (h.startsWith('tune/')) return showTune(h.slice(5));
  if (h === 'settings') return showSettings();
  if (h === 'badges') return showBadges();
  if (h === 'lesson' && lesson) return renderExercise();
  if (h.startsWith('drill/')) return startDrill(h.slice(6));
  return showHome();
}

// ---------------------------------------------------------------- shared bits
function topBar() {
  const p = goalProgress(state, today());
  const deg = Math.round(p * 360);
  return `<header class="top">
    <a href="#" class="brand">🎻 Daily&nbsp;Tune</a>
    <span class="stat" title="Day streak">🔥 ${state.streak}</span>
    <span class="stat" title="Gems">💎 ${state.gems}</span>
    <span class="ring" style="--deg:${deg}deg" title="Daily goal"><span>${Math.round(p * 100)}%</span></span>
    <a href="#settings" class="icon-btn" aria-label="Settings">⚙️</a>
  </header>`;
}

function tuneChip(tune) {
  const st = partStatus(tune, PART, state.cards);
  if (st.done) return '<span class="chip done" title="Memorised">★</span>';
  if (st.learned) return '<span class="chip learned" title="Learned — reviews will lock it in">✓</span>';
  if (st.introduced) return `<span class="chip learning" title="${st.introduced}/${st.phrases} chunks started">${Math.round(st.introduced / st.phrases * 100)}%</span>`;
  return '<span class="chip todo">♪</span>';
}

/** Chunk-by-chunk progress bar for one tune. */
function chunkBar(tune) {
  const n = tune.phrases[PART].length;
  const cells = tune.phrases[PART].map((_, i) => {
    const c = state.cards[cardId(tune.id, PART, i)];
    const cls = !c || !c.reps ? '' : c.level >= MEMORISED_LEVEL ? 'done' : c.level >= LEARNED_LEVEL ? 'learned' : 'started';
    return `<i class="${cls}"></i>`;
  }).join('');
  const whole = state.cards[cardId(tune.id, PART, 'all')];
  return `<div class="chunks" title="${n} chunks, then the whole tune">${cells}<b class="${whole && whole.level >= LEARNED_LEVEL ? 'learned' : ''}">∞</b></div>`;
}

const describeItem = (tune, phrase) => phrase === 'all' ? 'the whole tune' : `chunk ${phrase + 1}/${tune.phrases[PART].length}`;
const meta = t => `${esc(t.style)} · ${keyName(t.key.tonic, t.key.mode)}`;

function modeToggles() {
  const c = caps();
  const listenOff = Date.now() < state.skips.listenUntil;
  const singOff = Date.now() < state.skips.singUntil;
  return `<div class="modes">
    <button class="mode ${listenOff ? 'off' : ''}" data-act="toggle-listen">${listenOff ? '🔇 Silent mode' : '🎧 Sound on'}</button>
    <button class="mode ${singOff || !c.canSing ? 'off' : ''}" data-act="toggle-sing">${singOff || !hasMic() ? '🤐 No singing' : '🎤 Singing on'}</button>
  </div>`;
}

function bindModeToggles(root) {
  root.querySelectorAll('[data-act=toggle-listen]').forEach(b => b.onclick = () => {
    if (Date.now() < state.skips.listenUntil) state.skips.listenUntil = 0; else setSkip(state, 'listen', Date.now(), 60);
    persist(); showHome();
  });
  root.querySelectorAll('[data-act=toggle-sing]').forEach(b => b.onclick = () => {
    if (Date.now() < state.skips.singUntil) state.skips.singUntil = 0; else setSkip(state, 'sing', Date.now(), 60);
    persist(); showHome();
  });
}

// ---------------------------------------------------------------- home
function showHome() {
  const t = today();
  const next = nextNewItem(LEARN, state.cards, PART, 'tag-by-tag', 'melody');
  const due = dueCards(state.cards, t).length;
  const learnedToday = state.learnedLog.filter(m => m.day === t);
  const lvl = levelOf(state.xpTotal);
  const path = LEARN.slice().sort((a, b) => a.difficulty - b.difficulty);
  const learned = ALL.filter(tn => partStatus(tn, PART, state.cards).learned).length;
  const memorised = ALL.filter(tn => partStatus(tn, PART, state.cards).done).length;
  const g = state.settings.genre || 'all';
  const row = (tn, i) => `<li data-tune="${tn.id}">
      <span class="num">${i + 1}</span>
      <span class="tt"><b>${esc(tn.title)}</b><span class="muted small">${'●'.repeat(Math.max(1, Math.round(tn.difficulty / 2)))} ${meta(tn)}</span></span>
      <span class="chips">${tuneChip(tn)}</span>
    </li>`;

  app.innerHTML = `${topBar()}
  <main class="screen home">
    <section class="hero">
      <div class="hero-row"><span class="lvl">Lv ${lvl}</span><span class="muted">${state.xpTotal} XP · ${learned} tunes learned · ${memorised} memorised</span></div>
      <div class="today-card">
        <div class="muted small">Today's tune</div>
        <div class="today-title">${next ? `${esc(next.tag.title)} · ${describeItem(next.tag, next.phrase)}` : 'Everything learned — reviews only!'}</div>
        ${next ? `<div class="muted small">${meta(next.tag)}</div>${chunkBar(next.tag)}` : ''}
        ${learnedToday.length ? `<div class="payoff">✅ Learned today: ${learnedToday.map(m => esc((BY_ID[m.tagId] || {}).title) + ' · ' + (m.phrase === 'all' ? 'whole tune!' : `#${m.phrase + 1}`)).join(', ')}</div>` : ''}
        <button class="big go" data-act="start">${learnedToday.length ? 'Keep going' : 'Start'} · ~3 min</button>
        ${next ? `<button class="link know" data-act="know">✓ I already know this tune — skip it</button>` : ''}
        <div class="muted small">${due ? `${due} review${due > 1 ? 's' : ''} due` : 'No reviews due'}</div>
      </div>
      ${modeToggles()}
    </section>
    <section>
      <div class="row-head"><h2>Your path</h2>
        <select class="genre" aria-label="Genre">${Object.entries(GENRES).map(([k, v]) => `<option value="${k}" ${k === g ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <input class="filter" placeholder="Search ${path.length} tunes" aria-label="Search tunes">
      <ol class="path">${path.slice(0, PATH_LIMIT).map(row).join('')}</ol>
      ${path.length > PATH_LIMIT ? `<p class="muted small center more">…and ${path.length - PATH_LIMIT} more, easiest first — search to find any tune.</p>` : ''}
    </section>
    <footer class="foot muted small">
      <a href="#badges">🏅 Badges (${state.badges.length}/${BADGES.length})</a> ·
      Tunes from <a href="https://thesession.org" target="_blank" rel="noopener">The Session</a>, the Nottingham Music Database,
      <a href="https://github.com/00sapo/OpenEWLD" target="_blank" rel="noopener">OpenEWLD</a> and the Charlie Parker Omnibook, via Clef Runner.
    </footer>
  </main>`;
  $('[data-act=start]').onclick = () => { audio.unlock(); startLesson(); };
  const know = $('[data-act=know]');
  if (know) know.onclick = () => { skipKnown(next.tag); showHome(); };
  bindModeToggles(app);
  const list = $('.path');
  const bindRows = () => list.querySelectorAll('li').forEach(li => li.onclick = () => { location.hash = 'tune/' + li.dataset.tune; });
  bindRows();
  $('.genre').onchange = e => { state.settings.genre = e.target.value; persist(); filterGenre(); showHome(); };
  $('.filter').oninput = e => {
    const v = e.target.value.trim().toLowerCase();
    const hits = v ? path.filter(tn => tn.title.toLowerCase().includes(v) || (tn.style || '').toLowerCase().includes(v)) : path;
    list.innerHTML = hits.slice(0, PATH_LIMIT).map(tn => row(tn, path.indexOf(tn))).join('');
    const more = $('.more');
    if (more) more.hidden = !!v;
    bindRows();
  };
}

// ---------------------------------------------------------------- tune page
function showTune(id) {
  const tune = BY_ID[id];
  if (!tune) { location.hash = ''; return; }
  const st = partStatus(tune, PART, state.cards);
  const notes = tune.parts[PART];
  app.innerHTML = `${topBar()}
  <main class="screen tagpage">
    <a href="#" class="back">‹ Path</a>
    <h1>${esc(tune.title)}</h1>
    <div class="muted small">${meta(tune)} · ${notes.length} notes in ${st.phrases} chunks · difficulty ${tune.difficulty}/10</div>
    ${chunkBar(tune)}
    <div class="btns">
      <button class="sm" data-act="play">▶ Play the tune</button>
      <button class="sm primary" data-act="learn">${st.learned ? 'Practise' : st.introduced ? 'Keep learning' : 'Learn it'}</button>
      ${isKnownSkip(state.cards, tune.id, PART) ? '<button class="sm" data-act="unknow">↩ Undo “I know it”</button>'
        : !st.learned ? '<button class="sm" data-act="know">✓ I already know it</button>' : ''}
    </div>
    ${isKnownSkip(state.cards, tune.id, PART) ? `<p class="muted small">Skipped as known — it comes back as a whole-tune review ${dueText(tune)}. Get it right and it moves towards memorised; miss it and you'll learn it chunk by chunk.</p>` : ''}
    <div class="staff-wrap">${staffHtml(tune, notes, { rhythm: true, final: true })}</div>
    <div class="links small muted">Source: ${esc(tune.source)}${tune.style ? ` · ${esc(tune.style)}` : ''}.
      ${st.memorised}/${st.phrases} chunks memorised${st.done ? ' · whole tune memorised ★' : ''}.</div>
  </main>`;
  const wrap = $('.staff-wrap');
  $('[data-act=play]').onclick = () => {
    audio.stopAll();
    audio.playNotes(notes, { rate: tempo(), onNote: i => { wrap.innerHTML = staffHtml(tune, notes, { rhythm: true, final: true, highlight: i }); } });
  };
  $('[data-act=learn]').onclick = () => { audio.unlock(); startLesson({ tagId: tune.id, part: PART }); };
  const know = $('[data-act=know]');
  if (know) know.onclick = () => { skipKnown(tune); showTune(id); };
  const unknow = $('[data-act=unknow]');
  if (unknow) unknow.onclick = () => { unmarkKnown(state.cards, tune.id, PART); persist(); toast('Back on your learning path'); showTune(id); };
}

/** "I already know this tune": straight to spaced review, off the learning path. */
function skipKnown(tune) {
  markKnown(state.cards, tune.id, PART, today());
  persist();
  toast('Skipped ✓ — a quick review in 2 days');
}

function dueText(tune) {
  const c = state.cards[cardId(tune.id, PART, 'all')];
  const d = c ? c.due - today() : 0;
  return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
}

// ---------------------------------------------------------------- settings
function showSettings() {
  const s = state.settings;
  const opt = (name, pairs) => `<select name="${name}">${pairs.map(([v, l]) => `<option value="${v}" ${String(s[name]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  app.innerHTML = `${topBar()}
  <main class="screen settings">
    <a href="#" class="back">‹ Back</a>
    <h1>Settings</h1>
    <label>Tunes ${opt('genre', Object.entries(GENRES))}</label>
    <label>Clef ${opt('clef', [['treble', 'Treble (violin, flute, whistle, sax…)'], ['treble8', 'Treble, sung an octave lower'], ['bass', 'Bass (cello, trombone…)']])}</label>
    <label>Daily goal ${opt('dailyGoal', [[20, '20 XP (1–2 min)'], [40, '40 XP (~3 min)'], [80, '80 XP (~6 min)'], [120, '120 XP (~10 min)']])}</label>
    <label>Playback speed ${opt('tempo', [[1, 'Slow (60 bpm)'], [1.5, 'Steady (90 bpm)'], [2, 'Up to speed (120 bpm)']])}</label>
    <label>Show rhythm ${opt('rhythm', [['learning', 'While learning a chunk (assessment is pitch-only)'], ['always', 'Always'], ['never', 'Never']])}</label>
    <label class="check"><input type="checkbox" name="octaveFree" ${s.octaveFree ? 'checked' : ''}> Accept singing or playing in any octave</label>
    <label class="check"><input type="checkbox" name="showNames" ${s.showNames ? 'checked' : ''}> Show note names while learning</label>
    <h2>Backup</h2>
    <div class="btns"><button data-act="export">Copy progress</button><button data-act="import">Restore…</button><button data-act="reset" class="danger">Reset</button></div>
    <p class="muted small">Progress is stored on this device only.</p>
  </main>`;
  app.querySelectorAll('select, input[type=checkbox]').forEach(el => el.onchange = () => {
    const v = el.type === 'checkbox' ? el.checked : ['dailyGoal', 'tempo'].includes(el.name) ? Number(el.value) : el.value;
    state.settings[el.name] = v; persist();
    if (el.name === 'genre') filterGenre();
  });
  $('[data-act=export]').onclick = async () => {
    const txt = exportJson(state);
    try { await navigator.clipboard.writeText(txt); toast('Copied to clipboard'); } catch (e) { prompt('Copy this backup:', txt); }
  };
  $('[data-act=import]').onclick = () => {
    const txt = prompt('Paste a Daily Tune backup');
    if (!txt) return;
    try { state = importJson(txt); persist(); filterGenre(); toast('Restored'); showSettings(); } catch (e) { toast(e.message); }
  };
  $('[data-act=reset]').onclick = () => {
    if (confirm('Erase all progress?')) { state = initialState(); persist(); filterGenre(); location.hash = ''; }
  };
}

function showBadges() {
  app.innerHTML = `${topBar()}<main class="screen"><a href="#" class="back">‹ Back</a><h1>Badges</h1>
  <div class="badges">${BADGES.map(b => `<div class="badge ${state.badges.includes(b.id) ? 'got' : ''}"><span>${b.icon}</span>${esc(b.name)}</div>`).join('')}</div>
  <p class="muted small">Best streak: ${state.bestStreak} days · Streak freezes: ${state.freezes} · Chunks learned: ${state.learnedLog.length} · memorised: ${state.memorisedLog.length}</p></main>`;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ---------------------------------------------------------------- lesson flow
function startLesson(focus) {
  const c = caps();
  const built = buildLesson({
    tags: LEARN, cards: state.cards, today: today(), myPart: PART, mode: 'tag-by-tag',
    order: 'melody', canListen: c.canListen, canSing: c.canSing, seed: Date.now() & 0xffff, focus,
  });
  if (!built.exercises.length) { toast('Nothing to practise right now 🎉'); return; }
  lesson = { ...built, i: 0, xp: 0, grades: [], learned: [], memorised: [], rng: makeRng(Date.now() & 0xffff) };
  location.hash = 'lesson';
  renderExercise();
}

/** #drill/<type>/<tuneId>/<chunk> — a one-exercise lesson (handy for practice & tests). */
function startDrill(spec) {
  const [type, tuneId, ph] = spec.split('/');
  const tune = BY_ID[tuneId];
  if (!tune || !EXERCISE_TYPES[type]) { location.hash = ''; return; }
  const phrase = ph === 'all' ? 'all' : Math.max(0, Math.min(tune.phrases[PART].length - 1, Number(ph) || 0));
  lesson = {
    exercises: [{ type, tagId: tune.id, part: PART, phrase, cardId: cardId(tune.id, PART, phrase) }], newItem: null,
    i: 0, xp: 0, grades: [], learned: [], memorised: [], rng: makeRng(Date.now() & 0xffff),
  };
  history.replaceState(null, '', '#lesson');
  renderExercise();
}

function exerciseContext(ex) {
  const tag = BY_ID[ex.tagId];
  if (ex.phrase !== 'all' && ex.phrase >= tag.phrases[PART].length) ex.phrase = tag.phrases[PART].length - 1;
  const notes = itemNotes(tag, PART, ex.phrase);
  const card = ensureCard(state.cards, ex.cardId);
  return { tag, notes, card };
}

function cueFor(ex, card) {
  if (ex.type === 'intro' || ex.type === 'guided') return 0;
  if (ex.review) return Math.min(5, card.level + 1);
  // a new item's memory taps always hide something: first about half the notes, then all but the first
  if (ex.type === 'tap') return Math.min(5, Math.max(2, card.level) + (ex.cueBoost || 0));
  return Math.min(5, Math.max(1, card.level) + (ex.cueBoost || 0));
}

/** Exercise heading — for tapping it says how much is shown, so it never claims "from memory" with every note on screen. */
function labelFor(ex, cue) {
  if (ex.type === 'tap') return cue <= 1 ? 'Tap it' : cue === 2 ? 'Fill in the gaps' : 'Tap it from memory';
  return EXERCISE_TYPES[ex.type].label;
}

function renderExercise() {
  if (!lesson) { location.hash = ''; return; }
  audio.stopAll();
  const ex = lesson.exercises[lesson.i];
  if (!ex) return finishLesson();
  if (!BY_ID[ex.tagId] || !RENDER[ex.type]) { lesson.i++; return renderExercise(); }
  const { tag, notes, card } = exerciseContext(ex);
  const cue = cueFor(ex, card);
  const pct = Math.round(lesson.i / lesson.exercises.length * 100);
  const needsListen = EXERCISE_TYPES[ex.type].listen;
  app.innerHTML = `<main class="screen lesson">
    <div class="lbar"><button class="icon-btn" data-act="quit" aria-label="Quit">✕</button><div class="prog"><i style="width:${pct}%"></i></div></div>
    <div class="ex-head"><span class="kind">${labelFor(ex, cue).replace('phrase', 'chunk')}</span>
      <span class="muted small">${esc(tag.title)} · ${describeItem(tag, ex.phrase)}${ex.review ? ' · review' : ''}</span></div>
    <div class="ex-body"></div>
    <div class="ex-foot">
      <div class="skips">
        ${ex.type === 'sing' ? '<button class="link" data-act="skip-sing">🤐 Can\'t sing now</button>' : ''}
        ${needsListen ? '<button class="link" data-act="skip-listen">🔇 Can\'t listen now</button>' : ''}
        ${ex.type === 'intro' && ex.phrase === 0 && !ex.review ? '<button class="link" data-act="know">✓ I know this tune</button>' : ''}
        <button class="link" data-act="skip">Skip</button>
      </div>
      <div class="feedback" hidden></div>
    </div>
  </main>`;
  $('[data-act=quit]').onclick = () => { if (confirm('Quit this lesson? Progress so far is kept.')) { lesson = null; location.hash = ''; } };
  $('[data-act=skip]').onclick = () => next();
  const sl = $('[data-act=skip-listen]');
  if (sl) sl.onclick = () => { setSkip(state, 'listen', Date.now()); persist(); swapForSilent(); };
  const kn = $('[data-act=know]');
  if (kn) kn.onclick = () => {
    skipKnown(tag);
    // drop the rest of this tune's new-chunk exercises; keep reviews
    lesson.exercises = lesson.exercises.filter((e, k) => k < lesson.i || e.review || e.tagId !== tag.id);
    // nothing done yet and nothing left: go straight on to the next tune
    if (lesson.i >= lesson.exercises.length && !lesson.grades.length) startLesson();
    else renderExercise();
  };
    const ss = $('[data-act=skip-sing]');
  if (ss) ss.onclick = () => { setSkip(state, 'sing', Date.now()); persist(); swapForSilent(); };
  const body = $('.ex-body');
  RENDER[ex.type]({ ex, tag, notes, card, cue, body, finish: r => finishExercise(ex, r) });
}

/** Replace the current and remaining exercises that need sound/mic with silent ones. */
function swapForSilent() {
  const c = caps();
  lesson.exercises = lesson.exercises.map((e, i) => {
    if (i < lesson.i || allowed(e.type, c)) return e;
    return { ...e, type: e.type === 'listenChoose' ? 'nextNote' : 'tap' };
  });
  renderExercise();
}

function finishExercise(ex, r) {
  const { grade = 0, srs = false, msg = '', reveal = '' } = r;
  const card = state.cards[ex.cardId];
  const before = card.level;
  if (srs) {
    const cue = r.cue != null ? r.cue : cueFor(ex, card);
    state.cards[ex.cardId] = review(card, grade, today(), cue);
    const after = state.cards[ex.cardId].level;
    const entry = { day: today(), tagId: ex.tagId, part: PART, phrase: ex.phrase };
    if (before < LEARNED_LEVEL && after >= LEARNED_LEVEL) { state.learnedLog.push(entry); lesson.learned.push(entry); }
    if (before < MEMORISED_LEVEL && after >= MEMORISED_LEVEL) { state.memorisedLog.push(entry); lesson.memorised.push(entry); }
  }
  const xp = Math.round(XP.correct * grade) + (grade >= 1 ? XP.perfectBonus : 0);
  lesson.xp += xp;
  lesson.grades.push(grade);
  persist();
  const good = grade >= 0.85, ok = grade >= 0.6;
  audio.sfx(ok ? 'good' : 'bad');
  const fb = $('.feedback');
  $('.skips').hidden = true;
  fb.hidden = false;
  fb.className = 'feedback ' + (good ? 'good' : ok ? 'ok' : 'bad');
  fb.innerHTML = `<div><b>${good ? pick(['Nailed it!', 'In tune!', 'Lovely!', 'Right on!']) : ok ? 'Close!' : 'Not quite'}</b> <span class="muted">+${xp} XP</span>
    ${msg ? `<div class="small">${msg}</div>` : ''}${reveal}</div>
    <button class="big go" data-act="next">Continue</button>`;
  $('[data-act=next]').onclick = next;
}

function next() {
  audio.stopAll();
  lesson.i++;
  renderExercise();
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function finishLesson() {
  const t = today();
  lesson.xp += XP.lessonDone + lesson.learned.length * XP.memorised;
  const before = state.streak;
  const { goalReached } = addXp(state, lesson.xp, t);
  state.lessons++;
  const badges = checkBadges(state);
  persist();
  audio.sfx('win');
  const acc = lesson.grades.length ? Math.round(lesson.grades.reduce((a, b) => a + b, 0) / lesson.grades.length * 100) : 0;
  const describe = m => { const tn = BY_ID[m.tagId] || { phrases: { [PART]: [] } }; return `${esc(tn.title)} — ${describeItem(tn, m.phrase)}${m.phrase === 'all' ? '!' : ''}`; };
  app.innerHTML = `<main class="screen results">
    <div class="confetti" aria-hidden="true">${Array.from({ length: 24 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
    <h1>Lesson complete!</h1>
    <div class="res-grid">
      <div><b>+${lesson.xp}</b><span>XP</span></div>
      <div><b>${acc}%</b><span>accuracy</span></div>
      <div><b>🔥 ${state.streak}</b><span>${goalReached && state.streak > before ? 'streak +1!' : 'day streak'}</span></div>
    </div>
    ${lesson.learned.length ? `<div class="payoff big-payoff">🧠 You can now recall:<ul>${lesson.learned.map(m => `<li>${describe(m)}</li>`).join('')}</ul><div class="small muted">Come back tomorrow to lock it in.</div></div>` : ''}
    ${lesson.memorised.length ? `<div class="payoff big-payoff">🔒 Memorised long-term:<ul>${lesson.memorised.map(m => `<li>${describe(m)}</li>`).join('')}</ul></div>` : ''}
    ${badges.length ? `<div class="badges">${badges.map(b => `<div class="badge got"><span>${b.icon}</span>${esc(b.name)}</div>`).join('')}</div>` : ''}
    <div class="goal">Daily goal ${Math.round(goalProgress(state, t) * 100)}%</div>
    <button class="big go" data-act="home">Done</button>
    <button class="link" data-act="again">One more lesson</button>
  </main>`;
  lesson = null;
  $('[data-act=home]').onclick = () => { location.hash = ''; showHome(); };
  $('[data-act=again]').onclick = () => startLesson();
}

// ---------------------------------------------------------------- exercise renderers
function staffHtml(tune, notes, opts = {}) {
  const names = opts.names && state.settings.showNames;
  const labels = names ? notes.map(n => noteName(n[0], tune.tonic, false)) : null;
  const rhythm = state.settings.rhythm === 'always' || (state.settings.rhythm !== 'never' && !!opts.rhythm);
  return renderStaff(notes, {
    part: state.settings.clef || 'treble', tonic: tune.tonic, names, labels, mask: opts.mask, hits: opts.hits,
    highlight: opts.highlight != null ? opts.highlight : -1, width: opts.width || 340,
    rhythm, lyrics: false, final: !!opts.final,
  });
}

function playButtons() {
  if (!caps().canListen) return '';
  return `<div class="btns center">
    <button class="sm" data-act="play">▶ Play</button>
    <button class="sm" data-act="slow">🐢 Slowly</button>
  </div>`;
}

function bindPlay(root, notes, onNote) {
  const p = root.querySelector('[data-act=play]');
  if (p) p.onclick = () => { audio.stopAll(); audio.playNotes(notes, { rate: tempo(), onNote }); };
  const s = root.querySelector('[data-act=slow]');
  if (s) s.onclick = () => { audio.stopAll(); audio.playNotes(notes, { rate: Math.min(1, tempo() * 0.6), onNote }); };
}

const RENDER = {
  intro({ tag, notes, body, finish, ex }) {
    const degrees = notes.map(n => scaleDegree(n[0], tag.tonic)).join(' ');
    body.innerHTML = `
      <p class="prompt">${ex.phrase === 'all' ? 'Now the <b>whole tune</b>, all the chunks in a row.' : 'Meet the next chunk of the tune.'}</p>
      <div class="staff-wrap">${staffHtml(tag, notes, { names: true, rhythm: true })}</div>
      ${ex.phrase !== 'all' ? `<p class="muted small center">Scale degrees: ${degrees}</p>` : ''}
      ${playButtons()}
      <button class="big go" data-act="got">Got it</button>`;
    const wrap = $('.staff-wrap', body);
    bindPlay(body, notes, i => { wrap.innerHTML = staffHtml(tag, notes, { names: true, rhythm: true, highlight: i }); });
    if (caps().canListen) setTimeout(() => audio.playNotes(notes, { rate: tempo() }), 250);
    $('[data-act=got]', body).onclick = () => finish({ grade: 1, srs: false });
  },

  guided(ctx) { tapExercise(ctx, { guided: true }); },
  tap(ctx) { tapExercise(ctx, { guided: false }); },

  nextNote({ tag, notes, body, finish, cue }) {
    const q = nextNoteQuestion(notes, lesson.rng);
    if (!q) return finish({ grade: 1 });
    const shown = notes.slice(0, q.index);
    body.innerHTML = `
      <p class="prompt">What's the next note?</p>
      <div class="staff-wrap">${staffHtml(tag, shown.concat([[q.answer, 0, 0]]), { names: cue <= 2, mask: shown.map(() => true).concat([false]) })}</div>
      <div class="options">${q.options.map(m => `<button class="opt" data-m="${m}">${noteName(m, tag.tonic, true)}</button>`).join('')}</div>`;
    body.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      const m = Number(b.dataset.m);
      const ok = m === q.answer;
      if (caps().canListen) audio.playNote(m);
      b.classList.add(ok ? 'right' : 'wrong');
      if (!ok) body.querySelector(`[data-m="${q.answer}"]`).classList.add('right');
      body.querySelectorAll('.opt').forEach(x => x.disabled = true);
      finish({ grade: ok ? 1 : 0, msg: ok ? '' : `It was ${noteName(q.answer, tag.tonic, true)}.` });
    });
  },

  listenChoose({ notes, body, finish }) {
    const q = listenChooseQuestion(notes, lesson.rng);
    body.innerHTML = `
      <p class="prompt">Listen — which shape is the tune?</p>
      <div class="btns center"><button class="big-play" data-act="hear">🔊</button></div>
      <div class="options col">${q.options.map((v, i) => `<button class="opt contour-opt" data-i="${i}">${renderContour(v, { range: q.range })}</button>`).join('')}</div>`;
    const play = () => { audio.stopAll(); audio.playNotes(notes, { even: true }); };
    $('[data-act=hear]', body).onclick = play;
    setTimeout(play, 250);
    body.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      const ok = Number(b.dataset.i) === q.answerIndex;
      b.classList.add(ok ? 'right' : 'wrong');
      body.querySelector(`[data-i="${q.answerIndex}"]`).classList.add('right');
      body.querySelectorAll('.opt').forEach(x => x.disabled = true);
      finish({ grade: ok ? 1 : 0 });
    });
  },

  sing: singExercise,
};

function tapExercise({ ex, tag, notes, body, finish, cue }, { guided }) {
  const n = notes.length;
  const mask = guided ? new Array(n).fill(true) : cueMask(n, cue, n * 7 + (ex.phrase === 'all' ? 99 : ex.phrase));
  const revealed = mask.slice();
  const hits = new Array(n).fill(null);
  let i = 0, wrong = 0;
  const midis = notes.map(x => x[0]);
  const [lo, hi] = rangeFor(midis);
  const showNames = guided || cue <= 1;
  const prompt = guided ? 'Tap along — follow the glowing key.'
    : cue >= 4 ? 'From memory: tap every note.' : cue <= 1 ? 'Tap the notes — hum them in your head as you go.' : 'Tap the notes. Fill in the hidden ones from memory.';
  body.innerHTML = `
    <p class="prompt">${prompt}</p>
    <div class="staff-wrap"></div>
    <div class="btns center">${caps().canListen ? '<button class="sm" data-act="pipe">🎵 Start note</button>' : ''}<button class="sm" data-act="hint">💡 Reveal next</button></div>
    <div class="kb-host"></div>${typingHelp()}`;
  const draw = () => {
    $('.staff-wrap', body).innerHTML = staffHtml(tag, notes, {
      names: showNames, mask: revealed, highlight: i, hits: hits.some(h => h != null) ? hits.map(h => h == null ? undefined : h) : undefined,
      rhythm: guided,
    });
  };
  draw();
  const pipe = $('[data-act=pipe]', body);
  if (pipe) pipe.onclick = () => audio.pitchPipe(midis[0]);
  const kb = mountKeyboard($('.kb-host', body), {
    lo, hi, tonic: tag.tonic, labels: state.settings.showNames && cue <= 2,
    typing: true, target: () => (i < n ? midis[i] : null),
    keys: { h: () => $('[data-act=hint]', body)?.click(), ' ': () => $('[data-act=pipe]', body)?.click() },
    onKey: m => {
      if (i >= n) return;
      if (caps().canListen) audio.playNote(m, 0.4);
      if (m === midis[i]) {
        kb.flash(m, 'right');
        if (hits[i] == null) hits[i] = true;
        revealed[i] = true;
        i++; wrong = 0;
        skipTied();
      } else {
        kb.flash(m, 'wrong');
        if (navigator.vibrate) navigator.vibrate(40);
        hits[i] = false;
        if (++wrong >= 2) { revealed[i] = true; kb.hint(midis[i]); }
      }
      if (guided && i < n) kb.hint(midis[i]); else if (!guided && wrong < 2) kb.clearHint();
      draw();
      if (i >= n) done();
    },
  });
  $('[data-act=hint]', body).onclick = () => { if (i < n) { hits[i] = false; revealed[i] = true; kb.hint(midis[i]); draw(); } };
  // a tied continuation isn't played again, so it isn't tapped either
  function skipTied() {
    while (i < n && i > 0 && typeof notes[i - 1][5] === 'string' && notes[i - 1][5].includes('~') && midis[i - 1] === midis[i]) {
      hits[i] = hits[i - 1]; revealed[i] = true; i++;
    }
  }
  if (guided) kb.hint(midis[0]);
  function done() {
    const grade = hits.filter(h => h === true).length / n;
    finish({ grade, srs: true, cue: guided ? 0 : cue, msg: grade < 1 ? `${hits.filter(h => h === true).length}/${n} first-try` : '' });
  }
}

function singExercise({ tag, notes, body, finish, cue }) {
  const n = notes.length;
  const midis = notes.map(x => x[0]);
  const mask = cueMask(n, cue, n * 11);
  body.innerHTML = `
    <p class="prompt">Sing, whistle or play it. Pitch counts, rhythm doesn't.</p>
    <div class="staff-wrap">${staffHtml(tag, notes, { names: cue <= 1, mask })}</div>
    <div class="sing-chips">${midis.map((m, k) => `<span class="schip" data-k="${k}">${mask[k] ? noteName(m, tag.tonic, false) : '•'}</span>`).join('')}</div>
    <div class="meter"><span class="now">–</span><span class="cents"><i></i></span></div>
    <div class="btns center"><button class="sm" data-act="pipe">🎵 First note</button></div>
    <button class="big go rec" data-act="rec">🎤 Go</button>
    <p class="muted small center status">Any octave counts${state.settings.octaveFree ? '' : ' (turn on “any octave” in settings)'}.</p>`;
  $('[data-act=pipe]', body).onclick = () => audio.pitchPipe(midis[0]);
  let session = null, k = 0, stable = 0, lastM = null, timer = null;
  const rec = $('[data-act=rec]', body);
  const chips = body.querySelectorAll('.schip');
  const now = $('.now', body), needle = $('.cents i', body);
  const octaveFree = state.settings.octaveFree;
  const sameNote = (a, b) => a === b || (octaveFree && (a - b) % 12 === 0);

  rec.onclick = async () => {
    if (session) return stop();
    audio.stopAll();
    rec.disabled = true;
    rec.textContent = '🎵 Here\'s your note…';
    audio.pitchPipe(midis[0], 1.0);
    await wait(1100);
    try {
      session = await listen({
        minMidi: Math.min(...midis) - (octaveFree ? 26 : 2), maxMidi: Math.max(...midis) + (octaveFree ? 14 : 2), speech: false,
        onFrame: f => {
          if (f.midi == null) { now.textContent = '–'; stable = 0; return; }
          const r = Math.round(f.midi);
          now.textContent = noteName(r, tag.tonic, true);
          needle.style.transform = `translateX(${Math.max(-50, Math.min(50, (f.midi - r) * 100))}%)`;
          if (r === lastM) stable++; else { stable = 1; lastM = r; }
          if (k < n && stable >= 4 && sameNote(r, midis[k])) {
            chips[k].classList.add('hit'); chips[k].textContent = noteName(midis[k], tag.tonic, false);
            k++; stable = -99; // require a fresh note before the next match
            if (k >= n) setTimeout(stop, 500);
          }
        },
      });
    } catch (e) {
      session = null;
      rec.disabled = false; rec.textContent = '🎤 Go';
      $('.status', body).textContent = 'Microphone unavailable — tap "Can\'t sing now" to switch to tapping.';
      return;
    }
    rec.disabled = false;
    rec.textContent = '■ Done';
    rec.classList.add('live');
    const total = notes[n - 1][1] + notes[n - 1][2] - notes[0][1];
    timer = setTimeout(stop, Math.min(60000, total * 1500 + 5000));
  };

  async function stop() {
    if (!session) return;
    clearTimeout(timer);
    const s = session; session = null;
    rec.disabled = true; rec.textContent = 'Scoring…';
    const res = await s.stop();
    const sung = framesToNotes(res.frames).map(x => x.midi);
    const al = alignPitches(sung, midis, { octaveFree });
    const grade = combineScores(al.score, null);
    $('.staff-wrap', body).innerHTML = staffHtml(tag, notes, { names: true, hits: al.hits });
    finish({ grade, srs: true, cue, msg: `Pitch ${Math.round(al.score * 100)}%` });
  }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/** On a computer, say how to type notes. */
function typingHelp() {
  if (!hasKeyboard()) return '';
  return '<p class="muted small center typing-help">⌨️ Type note names <kbd>A</kbd>–<kbd>G</kbd> (in the key) · <kbd>Shift</kbd> ♯ · <kbd>Alt</kbd> ♭ · <kbd>H</kbd> reveal · <kbd>Space</kbd> start note</p>';
}

boot();
