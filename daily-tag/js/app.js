// Daily Tag — UI shell. Screens: home (path), tag, lesson, results, settings.

import { PARTS, noteName, scaleDegree, keyName } from './music.js';
import { prepareTags, cardId, itemNotes, partStatus, learningQueue, nextNewItem, ensureCard, tagStatus, partOrder } from './curriculum.js';
import { buildLesson, lyricFor, nextNoteQuestion, listenChooseQuestion, lyricGapQuestion, chordAt, makeRng, allowed, EXERCISE_TYPES } from './lesson.js';
import { review, dayNumber, dueCards, cueMask, LEARNED_LEVEL, MEMORISED_LEVEL } from './srs.js';
import { XP, addXp, goalProgress, level as levelOf, checkBadges, setSkip, capabilities, rollStreak, BADGES, initialState } from './game.js';
import { load, save, exportJson, importJson } from './store.js';
import { renderStaff, renderContour } from './notation.js';
import { mountKeyboard, rangeFor } from './keyboard.js';
import { framesToNotes, alignPitches, lyricMatch, combineScores } from './scoring.js';
import * as audio from './audio.js';
import { listen, hasMic, hasSpeech } from './mic.js';
import { applyCorrections, mergeStores, pruneLocal, loadLocal, saveLocal, pending } from './corrections.js';
import { initReview, showReview, showReviewQueue, setReviewBack } from './review.js';

const $ = (s, el = document) => el.querySelector(s);
const app = document.getElementById('app');
let state = load();
let TAGS = [];
let BY_ID = {};
let RAW_BY_ID = {};         // tags as generated, before corrections
let RAW = [];
let REMOTE_FIXES = {};      // data/corrections.json
let LOCAL_FIXES = loadLocal();  // this device's edits, until they reach the repo
let WORD_POOL = [];
let lesson = null;

const today = () => dayNumber();
const persist = () => save(state);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const caps = () => capabilities(state, Date.now(), { hasMic: hasMic(), hasAudio: audio.hasAudio() });

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    const [res, fixes] = await Promise.all([
      fetch('data/tags.json'),
      fetch('data/corrections.json').then(r => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    const raw = await res.json();
    RAW = raw.tags;
    RAW_BY_ID = Object.fromEntries(RAW.map(t => [String(t.id), t]));
    REMOTE_FIXES = fixes || {};
    pruneLocal(LOCAL_FIXES, REMOTE_FIXES);
    saveLocal(LOCAL_FIXES);
    rebuildTags();
  } catch (e) {
    app.innerHTML = `<div class="screen"><p class="err">Couldn't load the tag library. ${esc(e.message)}</p></div>`;
    return;
  }
  rollStreak(state, today());
  persist();
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/** Apply corrections (repo + this device) and prepare the library. */
function rebuildTags() {
  TAGS = prepareTags(applyCorrections(RAW, mergeStores(REMOTE_FIXES, LOCAL_FIXES)));
  BY_ID = Object.fromEntries(TAGS.map(t => [t.id, t]));
  WORD_POOL = [...new Set(TAGS.flatMap(t => (t.lyrics || '').split(/\s+/)))];
}

initReview({
  app, esc, toast, topBar,
  staffHtml: (...a) => staffHtml(...a),
  raw: id => RAW_BY_ID[String(id)],
  tag: id => BY_ID[String(id)],
  tags: () => TAGS,
  startedTags: () => [...new Set(Object.keys(state.cards).map(k => k.split('/')[0]))],
  store: () => LOCAL_FIXES,
  remote: () => REMOTE_FIXES,
  save: ({ rebuild = false } = {}) => { saveLocal(LOCAL_FIXES); if (rebuild) rebuildTags(); },
});

function route() {
  audio.stopAll();
  const h = location.hash.slice(1);
  if (h.startsWith('tag/')) return showTag(h.slice(4));
  if (h === 'settings') return showSettings();
  if (h === 'badges') return showBadges();
  if (h === 'review') { setReviewBack(null); return showReviewQueue(); }
  if (h.startsWith('review/')) return showReview(h.slice(7));
  if (h === 'lesson' && lesson) return renderExercise();
  if (h.startsWith('drill/')) return startDrill(h.slice(6));
  return showHome();
}

// ---------------------------------------------------------------- shared bits
function topBar() {
  const p = goalProgress(state, today());
  const deg = Math.round(p * 360);
  return `<header class="top">
    <a href="#" class="brand">💈 Daily&nbsp;Tag</a>
    <span class="stat" title="Day streak">🔥 ${state.streak}</span>
    <span class="stat" title="Gems">💎 ${state.gems}</span>
    <span class="ring" style="--deg:${deg}deg" title="Daily goal"><span>${Math.round(p * 100)}%</span></span>
    <a href="#settings" class="icon-btn" aria-label="Settings">⚙️</a>
  </header>`;
}

function partChip(tag, part) {
  const st = partStatus(tag, part, state.cards);
  let cls = 'todo', sym = part === 'Bari' ? 'Br' : part[0];
  if (st.done) { cls = 'done'; sym = '★'; }
  else if (st.learned) cls = 'learned';
  else if (st.introduced) cls = 'learning';
  return `<span class="chip ${cls}" title="${part}: ${st.learned ? 'learned' : `${st.introduced}/${st.phrases} phrases started`}${st.done ? ', memorised' : ''}">${sym}</span>`;
}

/** Four-part progress for the tag being learned: one bar per voice. */
function quartetBars(tag) {
  const order = partOrder(state.settings.myPart, state.settings.partOrder);
  return `<div class="quartet">${order.map(p => {
    const st = partStatus(tag, p, state.cards);
    const learnedPhrases = tag.phrases[p].filter((_, i) => {
      const c = state.cards[cardId(tag.id, p, i)];
      return c && c.level >= LEARNED_LEVEL;
    }).length;
    const pct = st.done ? 100 : st.learned ? 85 : Math.round(learnedPhrases / (st.phrases + 1) * 80);
    return `<div class="qrow"><span class="qname">${p}</span><span class="qbar"><i style="width:${pct}%" class="${st.done ? 'done' : st.learned ? 'learned' : ''}"></i></span><span class="qst">${st.done ? '★' : st.learned ? '✓' : `${learnedPhrases}/${st.phrases}`}</span></div>`;
  }).join('')}</div>`;
}

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
  const next = nextNewItem(TAGS, state.cards, state.settings.myPart, state.settings.mode, state.settings.partOrder);
  const due = dueCards(state.cards, t).length;
  const learnedToday = state.learnedLog.filter(m => m.day === t);
  const lvl = levelOf(state.xpTotal);
  const q = learningQueue(TAGS, state.settings.myPart, state.settings.mode, state.settings.partOrder);
  const seen = new Set();
  const pathTags = [];
  for (const x of q) if (!seen.has(x.tag.id)) { seen.add(x.tag.id); pathTags.push(x.tag); }
  const nextLabel = next ? `${esc(next.tag.title)} · ${next.part} · ${next.phrase === 'all' ? 'whole part' : `phrase ${next.phrase + 1}/${next.tag.phrases[next.part].length}`}` : 'Everything learned — reviews only!';
  const totalLearnedParts = TAGS.reduce((a, tg) => a + PARTS.filter(p => partStatus(tg, p, state.cards).done).length, 0);
  const wholeTags = TAGS.filter(tg => tagStatus(tg, state.cards).learnedParts === 4).length;

  app.innerHTML = `${topBar()}
  <main class="screen home">
    <section class="hero">
      <div class="hero-row"><span class="lvl">Lv ${lvl}</span><span class="muted">${state.xpTotal} XP · ${wholeTags}/${TAGS.length} tags · ${totalLearnedParts} parts memorised</span></div>
      <div class="today-card">
        <div class="muted small">Today's tag</div>
        <div class="today-title">${nextLabel}</div>
        ${next ? quartetBars(next.tag) : ''}
        ${learnedToday.length ? `<div class="payoff">✅ Learned today: ${learnedToday.map(m => esc((BY_ID[m.tagId] || {}).title) + ' · ' + m.part + (m.phrase === 'all' ? ' (whole part!)' : ` #${m.phrase + 1}`)).join(', ')}</div>` : ''}
        <button class="big go" data-act="start">${learnedToday.length ? 'Keep going' : 'Start'} · ~3 min</button>
        <div class="muted small">${due ? `${due} review${due > 1 ? 's' : ''} due` : 'No reviews due'}</div>
      </div>
      ${modeToggles()}
    </section>
    <section>
      <div class="row-head"><h2>Your path</h2><input class="filter" placeholder="Search tags" aria-label="Search tags"></div>
      <ol class="path">
        ${pathTags.map((tg, i) => `<li data-tag="${tg.id}" data-title="${esc(tg.title.toLowerCase())}">
          <span class="num">${i + 1}</span>
          <span class="tt"><b>${esc(tg.title)}${tg.source === 'verified' ? ' <span class="ver" title="Verified against the sheet music">✓</span>' : ''}</b><span class="muted small">${'●'.repeat(Math.max(1, Math.round(tg.difficulty / 2)))} ${esc(tg.arranger || '')}</span></span>
          <span class="chips">${PARTS.map(p => partChip(tg, p)).join('')}</span>
        </li>`).join('')}
      </ol>
    </section>
    <footer class="foot muted small">
      <a href="#badges">🏅 Badges (${state.badges.length}/${BADGES.length})</a> ·
      <a href="#review">🔍 Check tags${pending(LOCAL_FIXES, REMOTE_FIXES).length ? ` (${pending(LOCAL_FIXES, REMOTE_FIXES).length} unsent)` : ''}</a> ·
      Tags, lyrics & learning tracks from <a href="https://www.barbershoptags.com" target="_blank" rel="noopener">barbershoptags.com</a>
    </footer>
  </main>`;
  $('[data-act=start]').onclick = () => { audio.unlock(); startLesson(); };
  bindModeToggles(app);
  app.querySelectorAll('.path li').forEach(li => li.onclick = () => { location.hash = 'tag/' + li.dataset.tag; });
  $('.filter').oninput = e => {
    const v = e.target.value.toLowerCase();
    app.querySelectorAll('.path li').forEach(li => { li.style.display = li.dataset.title.includes(v) ? '' : 'none'; });
  };
}

// ---------------------------------------------------------------- tag page
function showTag(id) {
  const tag = BY_ID[id];
  if (!tag) { location.hash = ''; return; }
  app.innerHTML = `${topBar()}
  <main class="screen tagpage">
    <a href="#" class="back">‹ Path</a>
    <h1>${esc(tag.title)}</h1>
    <div class="muted small">${tag.arranger ? 'Arr. ' + esc(tag.arranger) + ' · ' : ''}Sung in ${keyName(tag.key.tonic, tag.key.mode)} · difficulty ${tag.difficulty}/10</div>
    ${tag.lyrics ? `<blockquote class="lyrics">${esc(tag.lyrics).replace(/\n/g, '<br>')}</blockquote>` : ''}
    <div class="parts">
      ${PARTS.map(p => {
        const st = partStatus(tag, p, state.cards);
        return `<div class="part-row">
          <div><b>${p}</b> ${partChip(tag, p)}<div class="muted small">${st.memorised}/${st.phrases} phrases memorised · ${tag.parts[p].length} notes</div></div>
          <div class="btns">
            <button class="sm" data-play="${p}" aria-label="Play ${p}">▶</button>
            ${tag.tracks && tag.tracks[p] ? `<button class="sm" data-track="${p}" aria-label="Real ${p} track">🎙</button>` : ''}
            <button class="sm primary" data-learn="${p}">Learn</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="links small">
      ${tag.sheet ? `<a href="${esc(tag.sheet)}" target="_blank" rel="noopener">📄 Sheet music</a> · ` : ''}
      <a href="${esc(tag.page)}" target="_blank" rel="noopener">barbershoptags.com page</a>
      ${tag.credit ? `<div class="muted">Learning tracks: ${esc(tag.credit)}</div>` : ''}
      <div class="muted">${SOURCE_NOTE[tag.source] || SOURCE_NOTE.audio}${tag.corrected ? ' Includes corrections by singers.' : ''}${tag.checked && Object.keys(tag.checked).length ? ` Checked by a singer: ${Object.keys(tag.checked).join(', ')}.` : ''}</div>
    </div>
    <button class="check-btn" data-act="review">🔍 Check &amp; fix this tag</button>
  </main>`;
  $('[data-act=review]').onclick = () => { setReviewBack('tag/' + tag.id); location.hash = `review/${tag.id}/Lead/0`; };
  app.querySelectorAll('[data-learn]').forEach(b => b.onclick = () => { audio.unlock(); startLesson({ tagId: tag.id, part: b.dataset.learn }); });
  app.querySelectorAll('[data-play]').forEach(b => b.onclick = () => {
    audio.stopAll();
    const p = b.dataset.play;
    const others = Object.fromEntries(PARTS.filter(x => x !== p).map(x => [x, tag.parts[x]]));
    audio.playNotes(tag.parts[p], { others });
  });
  app.querySelectorAll('[data-track]').forEach(b => b.onclick = () => trackButton(b, tag.tracks[b.dataset.track], 0, null));
}

const SOURCE_NOTE = {
  verified: '✓ Notes transcribed from the learning tracks and verified against the sheet music.',
  audio: 'Notes auto-transcribed from the learning tracks — may contain small errors; trust your ears and the sheet.',
  sheet: 'Notes read from the sheet music by OMR — may contain small errors; check the sheet.',
};

// ---------------------------------------------------------------- settings
function showSettings() {
  const s = state.settings;
  app.innerHTML = `${topBar()}
  <main class="screen settings">
    <a href="#" class="back">‹ Back</a>
    <h1>Settings</h1>
    <label>I sing
      <select name="myPart">${PARTS.map(p => `<option ${p === s.myPart ? 'selected' : ''}>${p}</option>`).join('')}</select>
    </label>
    <label>Learning order
      <select name="mode">
        <option value="tag-by-tag" ${s.mode === 'tag-by-tag' ? 'selected' : ''}>Whole tag: all four parts, then the next tag</option>
        <option value="my-part-first" ${s.mode === 'my-part-first' ? 'selected' : ''}>My part in every tag first, then the others</option>
      </select>
    </label>
    <label>Within a tag, start with
      <select name="partOrder">
        <option value="melody" ${s.partOrder === 'melody' ? 'selected' : ''}>The melody: Lead → Bass → Tenor → Bari</option>
        <option value="mine" ${s.partOrder === 'mine' ? 'selected' : ''}>My part, then Lead → Bass → Tenor → Bari</option>
      </select>
    </label>
    <label>Daily goal
      <select name="dailyGoal">${[20, 40, 80, 120].map(v => `<option value="${v}" ${v === s.dailyGoal ? 'selected' : ''}>${v} XP ${v === 20 ? '(1–2 min)' : v === 40 ? '(~3 min)' : v === 80 ? '(~6 min)' : '(~10 min)'}</option>`).join('')}</select>
    </label>
    <label>Show rhythm
      <select name="rhythm">
        <option value="learning" ${s.rhythm === 'learning' ? 'selected' : ''}>While learning a phrase (assessment is pitch-only)</option>
        <option value="always" ${s.rhythm === 'always' ? 'selected' : ''}>Always</option>
        <option value="never" ${s.rhythm === 'never' ? 'selected' : ''}>Never</option>
      </select>
    </label>
    <label class="check"><input type="checkbox" name="speech" ${s.speech ? 'checked' : ''} ${hasSpeech() ? '' : 'disabled'}> Check lyrics with speech recognition ${hasSpeech() ? '' : '(not supported here)'}</label>
    <label class="check"><input type="checkbox" name="octaveFree" ${s.octaveFree ? 'checked' : ''}> Accept singing in any octave</label>
    <label class="check"><input type="checkbox" name="showNames" ${s.showNames ? 'checked' : ''}> Show note names while learning</label>
    <h2>Backup</h2>
    <div class="btns"><button data-act="export">Copy progress</button><button data-act="import">Restore…</button><button data-act="reset" class="danger">Reset</button></div>
    <p class="muted small">Progress is stored on this device only.</p>
  </main>`;
  app.querySelectorAll('select, input[type=checkbox]').forEach(el => el.onchange = () => {
    const v = el.type === 'checkbox' ? el.checked : el.name === 'dailyGoal' ? Number(el.value) : el.value;
    state.settings[el.name] = v; persist();
  });
  $('[data-act=export]').onclick = async () => {
    const txt = exportJson(state);
    try { await navigator.clipboard.writeText(txt); toast('Copied to clipboard'); } catch (e) { prompt('Copy this backup:', txt); }
  };
  $('[data-act=import]').onclick = () => {
    const txt = prompt('Paste a Daily Tag backup');
    if (!txt) return;
    try { state = importJson(txt); persist(); toast('Restored'); showSettings(); } catch (e) { toast(e.message); }
  };
  $('[data-act=reset]').onclick = () => {
    if (confirm('Erase all progress?')) { state = initialState(); persist(); location.hash = ''; }
  };
}

function showBadges() {
  app.innerHTML = `${topBar()}<main class="screen"><a href="#" class="back">‹ Back</a><h1>Badges</h1>
  <div class="badges">${BADGES.map(b => `<div class="badge ${state.badges.includes(b.id) ? 'got' : ''}"><span>${b.icon}</span>${esc(b.name)}</div>`).join('')}</div>
  <p class="muted small">Best streak: ${state.bestStreak} days · Streak freezes: ${state.freezes} · Phrases learned: ${state.learnedLog.length} · memorised: ${state.memorisedLog.length}</p></main>`;
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
    tags: TAGS, cards: state.cards, today: today(), myPart: state.settings.myPart, mode: state.settings.mode,
    order: state.settings.partOrder, canListen: c.canListen, canSing: c.canSing, seed: Date.now() & 0xffff, focus,
  });
  if (!built.exercises.length) { toast('Nothing to practise right now 🎉'); return; }
  lesson = { ...built, i: 0, xp: 0, grades: [], learned: [], memorised: [], rng: makeRng(Date.now() & 0xffff) };
  location.hash = 'lesson';
  renderExercise();
}

/** #drill/<type>/<tagId>/<part>/<phrase> — a one-exercise lesson (handy for practice & tests). */
function startDrill(spec) {
  const [type, tagId, part, ph] = spec.split('/');
  const tag = BY_ID[tagId];
  if (!tag || !EXERCISE_TYPES[type] || !PARTS.includes(part)) { location.hash = ''; return; }
  const phrase = ph === 'all' ? 'all' : Math.max(0, Math.min(tag.phrases[part].length - 1, Number(ph) || 0));
  const id = cardId(tag.id, part, phrase);
  lesson = {
    exercises: [{ type, tagId: tag.id, part, phrase, cardId: id }], newItem: null,
    i: 0, xp: 0, grades: [], learned: [], memorised: [], rng: makeRng(Date.now() & 0xffff),
  };
  history.replaceState(null, '', '#lesson');
  renderExercise();
}

function exerciseContext(ex) {
  const tag = BY_ID[ex.tagId];
  if (ex.phrase !== 'all' && ex.phrase >= tag.phrases[ex.part].length) ex.phrase = tag.phrases[ex.part].length - 1;
  const notes = itemNotes(tag, ex.part, ex.phrase);
  const card = ensureCard(state.cards, ex.cardId);
  return { tag, notes, card };
}

function cueFor(ex, card) {
  if (ex.type === 'intro' || ex.type === 'guided') return 0;
  if (ex.review) return Math.min(5, card.level + 1);
  return Math.min(5, Math.max(1, card.level) + (ex.cueBoost || 0));
}

function renderExercise() {
  if (!lesson) { location.hash = ''; return; }
  audio.stopAll();
  const ex = lesson.exercises[lesson.i];
  if (!ex) return finishLesson();
  if (!BY_ID[ex.tagId]) { lesson.i++; return renderExercise(); }   // tag hidden by a correction
  const { tag, notes, card } = exerciseContext(ex);
  const cue = cueFor(ex, card);
  const pct = Math.round(lesson.i / lesson.exercises.length * 100);
  const needsListen = EXERCISE_TYPES[ex.type].listen || ex.type === 'intro';
  app.innerHTML = `<main class="screen lesson">
    <div class="lbar"><button class="icon-btn" data-act="quit" aria-label="Quit">✕</button><div class="prog"><i style="width:${pct}%"></i></div></div>
    <div class="ex-head"><span class="kind">${EXERCISE_TYPES[ex.type].label}</span>
      <span class="muted small">${esc(tag.title)} · ${ex.part} · ${ex.phrase === 'all' ? 'whole part' : `phrase ${ex.phrase + 1}/${tag.phrases[ex.part].length}`}${ex.review ? ' · review' : ''}</span></div>
    <div class="ex-body"></div>
    <div class="ex-foot">
      <div class="skips">
        ${ex.type === 'sing' ? '<button class="link" data-act="skip-sing">🤐 Can\'t sing now</button>' : ''}
        ${needsListen && ex.type !== 'intro' ? '<button class="link" data-act="skip-listen">🔇 Can\'t listen now</button>' : ''}
        ${ex.type === 'intro' || ex.type === 'guided' ? '<button class="link" data-act="fix">✎ Wrong notes or words?</button>' : ''}
        <button class="link" data-act="skip">Skip</button>
      </div>
      <div class="feedback" hidden></div>
    </div>
  </main>`;
  const fix = $('[data-act=fix]');
  if (fix) fix.onclick = () => { setReviewBack('lesson'); location.hash = `review/${tag.id}/${ex.part}/${ex.phrase}`; };
  $('[data-act=quit]').onclick = () => { if (confirm('Quit this lesson? Progress so far is kept.')) { lesson = null; location.hash = ''; } };
  $('[data-act=skip]').onclick = () => next();
  const sl = $('[data-act=skip-listen]');
  if (sl) sl.onclick = () => { setSkip(state, 'listen', Date.now()); persist(); swapForSilent(ex); };
  const ss = $('[data-act=skip-sing]');
  if (ss) ss.onclick = () => { setSkip(state, 'sing', Date.now()); persist(); swapForSilent(ex); };

  const body = $('.ex-body');
  const ctx = { ex, tag, notes, card, cue, body, finish: r => finishExercise(ex, r) };
  RENDER[ex.type](ctx);
}

/** Replace the current and remaining exercises that need sound/mic with silent ones. */
function swapForSilent(ex) {
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
    const entry = { day: today(), tagId: ex.tagId, part: ex.part, phrase: ex.phrase };
    if (before < LEARNED_LEVEL && after >= LEARNED_LEVEL) { state.learnedLog.push(entry); lesson.learned.push(entry); }
    if (before < MEMORISED_LEVEL && after >= MEMORISED_LEVEL) { state.memorisedLog.push(entry); lesson.memorised.push(entry); }
  }
  const xp = Math.round(XP.correct * grade) + (grade >= 1 ? XP.perfectBonus : 0);
  lesson.xp += xp;
  lesson.grades.push(grade);
  persist();
  const good = grade >= 0.85, ok = grade >= 0.6;
  audio.sfx(good ? 'good' : ok ? 'good' : 'bad');
  const fb = $('.feedback');
  $('.skips').hidden = true;
  fb.hidden = false;
  fb.className = 'feedback ' + (good ? 'good' : ok ? 'ok' : 'bad');
  fb.innerHTML = `<div><b>${good ? pick(['Nailed it!', 'Ring it!', 'Locked in!', 'Beautiful!']) : ok ? 'Close!' : 'Not quite'}</b> <span class="muted">+${xp} XP</span>
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
  const describe = m => `${esc((BY_ID[m.tagId] || {}).title)} — ${m.part}, ${m.phrase === 'all' ? 'the whole part!' : `phrase ${m.phrase + 1}`}`;
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
function staffHtml(tag, part, notes, opts = {}) {
  const names = opts.names && state.settings.showNames;
  const labels = names ? notes.map(n => noteName(n[0], tag.tonic, false)) : null;
  // long items: one staff row per ≤10 notes
  const rows = [];
  for (let i = 0; i < notes.length; i += 10) rows.push(i);
  return rows.map(start => {
    const slice = notes.slice(start, start + 10);
    const sub = arr => arr ? arr.slice(start, start + 10) : undefined;
    const rhythm = !!opts.force || state.settings.rhythm === 'always' || (state.settings.rhythm !== 'never' && !!opts.rhythm);
    return renderStaff(slice, {
      part, tonic: tag.tonic, names, labels: sub(labels), mask: sub(opts.mask), hits: sub(opts.hits),
      highlight: opts.highlight != null ? opts.highlight - start : -1, width: 340,
      rhythm, lyrics: opts.lyrics !== false,
    });
  }).join('');
}

function playButtons(tag, ex, notes, { harmony = true, track = true } = {}) {
  const c = caps();
  if (!c.canListen) return '';
  return `<div class="btns center">
    <button class="sm" data-act="play">▶ Play</button>
    ${harmony ? '<button class="sm" data-act="play-harm">▶ With harmony</button>' : ''}
    ${track && tag.tracks && tag.tracks[ex.part] ? '<button class="sm" data-act="play-track">🎙 Real singer</button>' : ''}
  </div>`;
}

function bindPlay(root, tag, ex, notes, onNote) {
  const p = root.querySelector('[data-act=play]');
  if (p) p.onclick = () => { audio.stopAll(); audio.playNotes(notes, { onNote }); };
  const h = root.querySelector('[data-act=play-harm]');
  if (h) h.onclick = () => {
    audio.stopAll();
    const others = Object.fromEntries(PARTS.filter(x => x !== ex.part).map(x => [x, tag.parts[x]]));
    audio.playNotes(notes, { others, onNote });
  };
  const tr = root.querySelector('[data-act=play-track]');
  if (tr) {
    audio.preloadTrack(tag.tracks[ex.part]);
    tr.onclick = () => {
      const start = notes[0][1], last = notes[notes.length - 1];
      trackButton(tr, tag.tracks[ex.part], start, last[1] + last[2]);
    };
  }
}

/** Play (or stop) a real recording from a button, showing loading progress. */
function trackButton(btn, url, start, end) {
  if (btn.dataset.playing) { audio.stopAll(); return; }
  audio.stopAll();
  const label = btn.innerHTML;
  audio.playTrack(url, start, end, err => { if (err) toast(err.message === 'blocked' ? 'The phone blocked playback — tap again' : 'The real recording needs a connection'); }, {
    onState: s => {
      btn.classList.toggle('loading', s === 'loading');
      btn.dataset.playing = s === 'loading' || s === 'playing' ? '1' : '';
      btn.innerHTML = s === 'loading' ? '<span class="spin"></span> Loading…' : s === 'playing' ? '■ Stop' : label;
    },
  });
}

const RENDER = {
  intro({ ex, tag, notes, body, finish }) {
    const lyr = lyricFor(tag, ex.part, ex.phrase);
    const degrees = notes.map(n => scaleDegree(n[0], tag.tonic)).join(' ');
    body.innerHTML = `
      <p class="prompt">Meet the next chunk of the <b>${ex.part}</b> part.</p>
      <div class="staff-wrap">${staffHtml(tag, ex.part, notes, { names: true, rhythm: true })}</div>
      ${lyr && !timedLyrics(notes) ? `<p class="lyric">“${esc(lyr)}”</p>` : ''}
      ${ex.phrase !== 'all' ? `<p class="muted small center">Scale degrees: ${degrees}</p>` : ''}
      ${playButtons(tag, ex, notes)}
      <button class="big go" data-act="got">Got it</button>`;
    const wrap = $('.staff-wrap', body);
    bindPlay(body, tag, ex, notes, i => { wrap.innerHTML = staffHtml(tag, ex.part, notes, { names: true, rhythm: true, highlight: i }); });
    if (caps().canListen) setTimeout(() => audio.playNotes(notes), 250);
    $('[data-act=got]', body).onclick = () => finish({ grade: 1, srs: false });
  },

  guided(ctx) { tapExercise(ctx, { guided: true }); },
  tap(ctx) { tapExercise(ctx, { guided: false }); },

  nextNote({ ex, tag, notes, body, finish, cue }) {
    const q = nextNoteQuestion(notes, lesson.rng);
    if (!q) return finish({ grade: 1 });
    const shown = notes.slice(0, q.index);
    body.innerHTML = `
      <p class="prompt">What's the next ${ex.part} note?</p>
      <div class="staff-wrap">${staffHtml(tag, ex.part, shown.concat([[q.answer, 0, 0]]), { names: cue <= 2, mask: shown.map(() => true).concat([false]) })}</div>
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

  listenChoose({ ex, tag, notes, body, finish }) {
    const q = listenChooseQuestion(notes, lesson.rng);
    body.innerHTML = `
      <p class="prompt">Listen — which shape is the ${ex.part} line?</p>
      <div class="btns center"><button class="big-play" data-act="hear">🔊</button></div>
      <div class="options col">${q.options.map((v, i) => `<button class="opt contour-opt" data-i="${i}">${renderContour(v)}</button>`).join('')}</div>`;
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

  chordFind({ ex, tag, notes, body, finish }) {
    const q = chordAt(tag, ex.part, notes, lesson.rng);
    const chord = Object.values(q.chord);
    const [lo, hi] = rangeFor(notes.map(n => n[0]));
    body.innerHTML = `
      <p class="prompt">Hear the chord — tap <b>your ${ex.part} note</b>.</p>
      <div class="btns center"><button class="big-play" data-act="hear">🔊</button><button class="sm" data-act="hint">💡 Hint</button></div>
      <div class="kb-host"></div>`;
    let tries = 0, hinted = false;
    const play = () => audio.playChord(chord, 1.8, hinted ? q.answer : null);
    $('[data-act=hear]', body).onclick = play;
    $('[data-act=hint]', body).onclick = () => { hinted = true; audio.playNote(q.answer, 0.8); };
    setTimeout(play, 250);
    const kb = mountKeyboard($('.kb-host', body), {
      lo, hi, tonic: tag.tonic, labels: state.settings.showNames, onKey: m => {
        audio.playNote(m, 0.35);
        if (m === q.answer) {
          kb.flash(m, 'right');
          finish({ grade: Math.max(0, (tries === 0 ? 1 : 0.5) - (hinted ? 0.4 : 0)) });
        } else {
          kb.flash(m, 'wrong');
          if (++tries >= 3) { kb.hint(q.answer); finish({ grade: 0, msg: `It was ${noteName(q.answer, tag.tonic, true)}.` }); }
        }
      },
    });
  },

  lyricGap({ ex, tag, body, finish }) {
    const text = lyricFor(tag, ex.part, ex.phrase);
    const q = text && lyricGapQuestion(text, lesson.rng, WORD_POOL);
    if (!q) return finish({ grade: 1 });
    body.innerHTML = `
      <p class="prompt">Fill in the missing word</p>
      <p class="lyric">${esc(q.before)} <span class="blank">_____</span> ${esc(q.after)}</p>
      <div class="options">${q.options.map(w => `<button class="opt" data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div>`;
    body.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      const ok = b.dataset.w === q.answer;
      b.classList.add(ok ? 'right' : 'wrong');
      body.querySelector(`[data-w="${q.answer}"]`)?.classList.add('right');
      body.querySelectorAll('.opt').forEach(x => x.disabled = true);
      finish({ grade: ok ? 1 : 0 });
    });
  },

  sing: singExercise,

  // a surprise quiz on another part of the same tag
  switch(ctx) {
    const { ex, tag, notes } = ctx;
    if (caps().canListen) {
      const ch = chordAt(tag, ex.part, [notes[0]], () => 0);
      setTimeout(() => audio.playChord(Object.values(ch.chord), 1.4), 200);
    }
    tapExercise(ctx, { guided: false, intro: `Switch! Now you're the <b>${ex.part}</b>${ex.phrase === 'all' ? ' — the whole part' : ''}. Tap it from memory.` });
  },
};

function tapExercise({ ex, tag, notes, body, finish, cue }, { guided, intro }) {
  const n = notes.length;
  const mask = guided ? new Array(n).fill(true) : cueMask(n, cue, n * 7 + (ex.phrase === 'all' ? 99 : ex.phrase));
  const revealed = mask.slice();
  const hits = new Array(n).fill(null);
  let i = 0, wrong = 0;
  const midis = notes.map(x => x[0]);
  const [lo, hi] = rangeFor(midis);
  const showNames = guided || cue <= 1;
  const lyr = lyricFor(tag, ex.part, ex.phrase);
  const prompt = intro ? intro : guided ? 'Tap along — follow the glowing key.'
    : cue >= 4 ? 'From memory: tap every note.' : cue <= 1 ? 'Tap the notes — say them in your head as you go.' : 'Tap the notes. Fill in the hidden ones from memory.';
  body.innerHTML = `
    <p class="prompt">${prompt}</p>
    <div class="staff-wrap"></div>
    ${lyr && cue < 5 && !timedLyrics(notes) ? `<p class="lyric small">“${esc(lyr)}”</p>` : ''}
    <div class="btns center">${caps().canListen ? '<button class="sm" data-act="pipe">🎵 Start note</button>' : ''}<button class="sm" data-act="hint">💡 Reveal next</button></div>
    <div class="kb-host"></div>`;
  const draw = () => {
    const hitArr = hits.map(h => h == null ? undefined : h);
    $('.staff-wrap', body).innerHTML = staffHtml(tag, ex.part, notes, {
      names: showNames, mask: revealed, highlight: i, hits: hits.some(h => h != null) ? hitArr : undefined,
      rhythm: guided, lyrics: cue <= 3,
    });
  };
  draw();
  const pipe = $('[data-act=pipe]', body);
  if (pipe) pipe.onclick = () => audio.pitchPipe(midis[0]);
  const kb = mountKeyboard($('.kb-host', body), {
    lo, hi, tonic: tag.tonic, labels: state.settings.showNames && cue <= 2, onKey: m => {
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
  // a tied continuation isn't sung again, so it isn't tapped either
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

function singExercise({ ex, tag, notes, body, finish, cue }) {
  const n = notes.length;
  const midis = notes.map(x => x[0]);
  const mask = cueMask(n, cue, n * 11);
  const lyr = lyricFor(tag, ex.part, ex.phrase);
  const speechOn = state.settings.speech && hasSpeech();
  body.innerHTML = `
    <p class="prompt">Sing the ${ex.part} line${lyr && cue >= 5 ? ' (words too!)' : ''}. Pitch counts, rhythm doesn't.</p>
    <div class="staff-wrap">${staffHtml(tag, ex.part, notes, { names: cue <= 1, mask, lyrics: cue <= 3 })}</div>
    ${lyr && cue < 5 && (cue > 3 || !timedLyrics(notes)) ? `<p class="lyric small">“${esc(lyr)}”</p>` : ''}
    <div class="sing-chips">${midis.map((m, k) => `<span class="schip" data-k="${k}">${mask[k] ? noteName(m, tag.tonic, false) : '•'}</span>`).join('')}</div>
    <div class="meter"><span class="now">–</span><span class="cents"><i></i></span></div>
    <div class="btns center">
      <button class="sm" data-act="pipe">🎵 My note</button>
      <button class="sm" data-act="chord">🎶 Chord</button>
    </div>
    <button class="big go rec" data-act="rec">🎤 Sing</button>
    <p class="muted small center status">${speechOn ? 'Speech check on — sing the words.' : 'Sing on any vowel.'}</p>`;
  $('[data-act=pipe]', body).onclick = () => audio.pitchPipe(midis[0]);
  $('[data-act=chord]', body).onclick = () => {
    const ch = chordAt(tag, ex.part, [notes[0]], () => 0);
    audio.playChord(Object.values(ch.chord), 1.6, midis[0]);
  };
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
        minMidi: Math.min(...midis) - (octaveFree ? 14 : 2), maxMidi: Math.max(...midis) + (octaveFree ? 14 : 2), speech: speechOn,
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
      rec.disabled = false; rec.textContent = '🎤 Sing';
      $('.status', body).textContent = 'Microphone unavailable — tap "Can\'t sing now" to switch to tapping.';
      return;
    }
    rec.disabled = false;
    rec.textContent = '■ Done';
    rec.classList.add('live');
    const total = notes[n - 1][1] + notes[n - 1][2] - notes[0][1];
    timer = setTimeout(stop, Math.min(45000, total * 2500 + 5000));
  };

  async function stop() {
    if (!session) return;
    clearTimeout(timer);
    const s = session; session = null;
    rec.disabled = true; rec.textContent = 'Scoring…';
    const res = await s.stop();
    const sung = framesToNotes(res.frames).map(x => x.midi);
    const al = alignPitches(sung, midis, { octaveFree });
    const pitch = al.score;
    const lyrScore = speechOn && res.speechOk && lyr ? lyricMatch(lyr, res.transcript) : null;
    const grade = combineScores(pitch, lyrScore);
    $('.staff-wrap', body).innerHTML = staffHtml(tag, ex.part, notes, { names: true, hits: al.hits });
    const msg = `Pitch ${Math.round(pitch * 100)}%` + (lyrScore != null ? ` · words ${Math.round(lyrScore * 100)}%${res.transcript ? ` (“${esc(res.transcript.slice(0, 60))}”)` : ''}` : '');
    finish({ grade, srs: true, cue, msg });
  }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/** True when these notes carry per-note syllables from the lyric alignment. */
function timedLyrics(notes) {
  return notes.some(n => n[4]);
}

boot();
