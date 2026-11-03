// Review & correct: our transcription, the sheet music and the real
// recording side by side, with quick fixes for notes and lyrics.
// Edits apply on this device at once; "Submit" opens a prefilled GitHub
// issue that the repo's apply-corrections workflow merges.

import { PARTS, noteName } from './music.js';
import { splitPhrases } from './curriculum.js';
import * as C from './corrections.js';
import * as audio from './audio.js';
import { rhythmGlyph } from './notation.js';
import { mountKeyboard, rangeFor } from './keyboard.js';

const LENGTHS = [
  [0.25, 'sixteenth'], [0.5, 'eighth'], [0.75, 'dotted eighth'], [1, 'quarter'],
  [1.5, 'dotted quarter'], [2, 'half'], [3, 'dotted half'], [4, 'whole'],
];

/** A small note-value icon (head, stem, flags, dot). */
function lengthIcon(beats) {
  const g = rhythmGlyph(beats);
  let s = `<svg viewBox="0 0 22 30" width="18" height="26" aria-hidden="true" class="len-ico">`;
  s += `<ellipse cx="8" cy="23" rx="5" ry="3.7" transform="rotate(-20 8 23)" class="${g.hollow ? 'h' : 'f'}"/>`;
  if (g.stem) s += `<line x1="12.6" x2="12.6" y1="22" y2="3"/>`;
  for (let f = 0; f < g.flags; f++) s += `<path d="M12.6 ${3 + f * 5} q 6 5 4 11" class="fl"/>`;
  if (g.dot) s += `<circle cx="18" cy="23" r="1.7" class="f"/>`;
  return s + '</svg>';
}

let env = null;      // { app, esc, toast, topBar, staffHtml, raw(id), tag(id), tags(), store(), remote(), save(), rank(id) }
let view = null;     // current review session

let back = null;     // hash to return to (a lesson or a tag page), or null for the review list

export function initReview(e) { env = e; }
export function setReviewBack(h) { back = h; }
const backHash = () => back || 'review';

const $ = (s, el = document) => el.querySelector(s);

/** Sheet image URL: PDFs are pre-rendered into sheets/<id>.png. */
export function sheetImage(tag) {
  if (!tag.sheet) return null;
  return /\.pdf$/i.test(tag.sheet) ? `sheets/${tag.id}.png` : tag.sheet;
}

function ranges(notes) {
  const out = [];
  let i = 0;
  for (const ph of splitPhrases(notes)) { out.push([i, i + ph.length]); i += ph.length; }
  return out;
}

function partNotes(id, part) {
  const t = env.tag(id);
  return t ? t.parts[part].map(n => [...n]) : [];
}

function entryFor(id) { return env.store()[id]; }

function partBadge(id, part) {
  const t = env.tag(id);
  const e = entryFor(id);
  const pe = e && e.parts && e.parts[part];
  if (pe && pe.notes) return '✎';
  if ((pe && pe.ok) || (t && t.checked && t.checked[part])) return '✓';
  return '';
}

// ---------------------------------------------------------------- queue
export function showReviewQueue() {
  const { app, esc } = env;
  const store = env.store();
  const pend = C.pending(store, env.remote());
  const tags = env.tags();
  const started = id => env.startedTags().includes(id);
  const sorted = [...tags].sort((a, b) => (started(b.id) - started(a.id)) || (a.rank - b.rank));
  const status = t => {
    const checked = PARTS.filter(p => partBadge(t.id, p)).length;
    return checked === 4 ? 'done' : checked ? 'part' : 'todo';
  };
  const nextTodo = sorted.find(t => status(t) !== 'done');
  app.innerHTML = `${env.topBar()}
  <main class="screen review-queue">
    <a href="#" class="back">‹ Path</a>
    <h1>Check the tags</h1>
    <p class="muted small">Compare our notes and words with the sheet music and the real singer, fix anything wrong, then submit. Fixes work on this phone straight away; submitting puts them in the library for everyone.</p>
    <div class="btns">
      ${nextTodo ? `<button class="primary" data-go="${nextTodo.id}">Check next: ${esc(nextTodo.title)}</button>` : ''}
      ${submitButton(pend.length)}
    </div>
    <ul class="rq">${sorted.map(t => {
      const st = status(t);
      return `<li data-go="${t.id}" class="${st}"><span class="rq-t">${esc(t.title)}</span>
        <span class="rq-s">${PARTS.map(p => `<i title="${p}">${partBadge(t.id, p) || '·'}</i>`).join('')}</span>
        <span class="muted small">${t.source === 'verified' ? '✓ sheet' : t.source}${pend.includes(t.id) ? ' · unsent' : ''}</span></li>`;
    }).join('')}</ul>
  </main>`;
  app.querySelectorAll('[data-go]').forEach(el => el.onclick = () => { location.hash = `review/${el.dataset.go}`; });
  bindSubmit(app);
}

function submitButton(n) {
  return n ? `<button class="sm submit" data-act="submit">Submit ${n} fix${n > 1 ? 'es' : ''} ↗</button>` : '';
}

function bindSubmit(root) {
  const b = root.querySelector('[data-act=submit]');
  if (b) b.onclick = () => submit();
}

/** Open the prefilled GitHub issue for everything unsent. */
export function submit() {
  const store = env.store();
  const ids = C.pending(store, env.remote());
  if (!ids.length) { env.toast('Nothing to submit'); return; }
  const orig = Object.fromEntries(ids.map(id => [id, env.raw(id)]).filter(([, t]) => t));
  const sub = C.buildSubmission(store, ids, orig);
  if (sub.fits) {
    window.open(sub.url, '_blank', 'noopener');
  } else {
    // too long for a link: copy the text, open a blank issue to paste it into
    // (both inside the tap, or iOS blocks them)
    const copied = navigator.clipboard ? navigator.clipboard.writeText(sub.body) : Promise.reject(new Error('no clipboard'));
    window.open(sub.shortUrl, '_blank', 'noopener');
    copied.then(() => env.toast('Too long for a link: the details are copied — paste them as the issue text'))
      .catch(() => window.prompt('Copy this, then paste it as the issue text:', sub.body));
  }
  for (const id of ids) store[id].submitted = true;
  env.save();
  env.toast('Submitted on GitHub — the library updates a minute after you press “Submit new issue”');
  if (location.hash === '#review') showReviewQueue();
}

// ---------------------------------------------------------------- review screen
/** #review/<id>[/<Part>[/<phrase>]] */
export function showReview(args) {
  const [id, partArg, phraseArg] = args.split('/');
  const tag = env.tag(id);
  if (!tag) {
    env.toast('That tag is hidden or missing');
    location.hash = 'review';
    return;
  }
  const part = PARTS.includes(partArg) ? partArg : (view && view.id === id ? view.part : 'Lead');
  if (!view || view.id !== id || view.part !== part) {
    const notes = partNotes(id, part);
    view = { id, part, notes, saved: JSON.stringify(notes), undo: [], sel: 0, phrase: 0, whole: false, range: null };
  }
  const rs = ranges(view.notes);
  if (phraseArg === 'all') view.whole = true;
  else if (phraseArg != null && phraseArg !== '') { view.whole = false; view.phrase = Math.min(rs.length - 1, Math.max(0, Number(phraseArg) || 0)); }
  if (!view.range || view.rangeKey !== `${view.whole}:${view.phrase}`) {
    view.range = view.whole ? [0, view.notes.length] : rs[Math.min(view.phrase, rs.length - 1)];
    view.rangeKey = `${view.whole}:${view.phrase}`;
    view.sel = view.range[0];
  }
  render();
}

function slice() { return view.notes.slice(view.range[0], view.range[1]); }

function render() {
  const { app, esc } = env;
  const tag = env.tag(view.id);
  const [from, to] = view.range;
  const notes = slice();
  const rs = ranges(view.notes);
  const img = sheetImage(tag);
  const dirty = JSON.stringify(view.notes) !== view.saved;
  const lastPhrase = view.whole || view.phrase >= rs.length - 1;
  const nextPart = PARTS[PARTS.indexOf(view.part) + 1];
  const pend = C.pending(env.store(), env.remote()).length;
  const sel = Math.min(Math.max(view.sel, from), to - 1);
  view.sel = sel;
  const selNote = view.notes[sel];
  const sourceLabel = { verified: '✓ recordings + sheet agree', audio: 'from the recordings', sheet: 'read from the sheet music' }[tag.source] || tag.source;

  app.innerHTML = `
  <main class="screen review">
    <div class="rv-top">
      <a href="#${backHash()}" class="back">‹ ${back === 'lesson' ? 'Back to the lesson' : back ? 'Back' : 'All tags'}</a>
      ${submitButton(pend)}
    </div>
    <h1>${esc(tag.title)}</h1>
    <div class="muted small">#${tag.rank} · our notes ${sourceLabel}${tag.corrected ? ' · corrected' : ''}</div>
    <div class="tabs" role="tablist">${PARTS.map(p => `<button role="tab" class="tab ${p === view.part ? 'on' : ''}" data-part="${p}">${p} <b>${partBadge(view.id, p)}</b></button>`).join('')}</div>
    <div class="phrase-nav">
      <button class="sm" data-act="prev" ${!view.whole && view.phrase > 0 ? '' : 'disabled'} aria-label="Previous phrase">‹</button>
      <span>${view.whole ? `Whole ${view.part} part` : `Phrase ${view.phrase + 1} of ${rs.length}`}</span>
      <button class="sm" data-act="next" ${!view.whole && view.phrase < rs.length - 1 ? '' : 'disabled'} aria-label="Next phrase">›</button>
      <button class="sm" data-act="whole">${view.whole ? 'Phrases' : 'Whole part'}</button>
    </div>

    <div class="rv-grid">
      <section class="panel ours">
        <h2>Ours</h2>
        <div class="staff-wrap">${env.staffHtml(tag, view.part, notes, { names: true, rhythm: true, highlight: sel - from, force: true })}</div>
        <div class="btns center">
          <button class="sm" data-act="play">▶ Ours</button>
          ${tag.tracks && tag.tracks[view.part] ? `<button class="sm" data-act="real">🎙 Real</button>
          <button class="sm" data-act="both">▶ Both</button>
          <button class="sm" data-act="real-all">🎙 Whole track</button>` : ''}
        </div>
      </section>

      <section class="panel sheet">
        <h2>Sheet music</h2>
        ${img ? `<div class="sheet-box"><img src="${esc(img)}" alt="Sheet music for ${esc(tag.title)}" loading="lazy" referrerpolicy="no-referrer"></div>
        <p class="muted small center"><a href="${esc(tag.sheet)}" target="_blank" rel="noopener">Open full size ↗</a></p>`
        : '<p class="muted">No sheet music for this tag.</p>'}
      </section>

      <section class="panel fix">
        <h2>Fix</h2>
        <div class="chips">${notes.map((n, k) => {
          const i = from + k;
          return `<button class="nchip ${i === sel ? 'sel' : ''}" data-i="${i}"><b>${noteName(n[0], tag.tonic)}</b><span>${esc(n[4] || (k ? '–' : ''))}</span></button>`;
        }).join('')}</div>
        <div class="edit-bar" aria-label="Edit the selected note">
          <button class="sm" data-op="down" title="Semitone down">▼</button>
          <button class="sm" data-op="up" title="Semitone up">▲</button>
          <button class="sm" data-op="split" title="Split into two repeated notes">✂ Split</button>
          <button class="sm" data-op="merge" title="Merge with the next note" ${sel < view.notes.length - 1 ? '' : 'disabled'}>⊕ Merge</button>
          <button class="sm" data-op="delete" title="Delete note" ${view.notes.length > 1 ? '' : 'disabled'}>🗑</button>
          <button class="sm" data-op="undo" ${view.undo.length ? '' : 'disabled'}>↶ Undo</button>
        </div>
        <div class="pitch-row">
          <span class="muted small">Tap a key to set <b>${noteName(selNote[0], tag.tonic)}</b>'s pitch</span>
          <label class="check small"><input type="checkbox" name="advance" ${view.advance === false ? '' : 'checked'}> then next note</label>
        </div>
        <div class="kb-host fix-kb"></div>
        <div class="edit-bar">
          <button class="sm" data-op="oct-down" title="Octave down">8va ▼</button>
          <button class="sm" data-op="oct-up" title="Octave up">8va ▲</button>
        </div>
        <div class="len-bar" role="group" aria-label="Length of the selected note">
          ${LENGTHS.map(([b, name]) => `<button class="sm len ${Math.abs((selNote[3] || 0) - b) < 0.01 ? 'on' : ''}" data-len="${b}" title="${name}" aria-label="${name}">${lengthIcon(b)}</button>`).join('')}
        </div>
        <div class="edit-bar" role="group" aria-label="Barlines and ties">
          <button class="sm ${C.hasFlag(selNote, '|') ? 'on' : ''}" data-op="bar" ${sel > 0 ? '' : 'disabled'} title="Barline before this note">┃ Bar before</button>
          <button class="sm ${C.hasFlag(selNote, '~') ? 'on' : ''}" data-op="tie" ${view.notes[sel + 1] && view.notes[sel + 1][0] === selNote[0] ? '' : 'disabled'} title="Tie to the next note (same pitch, held — not sung again)">⁀ Tie to next</button>
        </div>
        <div class="edit-bar autobar">
          <button class="sm" data-op="autobar" title="Treat the selected note as a downbeat and place barlines every bar from here">Bars from here, every</button>
          <select name="perBar" aria-label="Beats per bar">${[2, 3, 4, 6].map(b => `<option value="${b}" ${b === (view.perBar || 4) ? 'selected' : ''}>${b} beats</option>`).join('')}</select>
        </div>
        <label class="syl">Syllable on ${noteName(selNote[0], tag.tonic)}
          <input name="syl" value="${esc(selNote[4] || '')}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="(held from before)">
        </label>
        <label class="syl">Words for these notes
          <span class="row"><input name="words" value="${esc(C.lyricText(view.notes, from, to))}" autocomplete="off" autocapitalize="off" spellcheck="false">
          <button class="sm" data-act="lay">Apply</button></span>
          <span class="muted small">One word per note. Split words with “-” (lo-ving). “_” holds the previous syllable over a note.</span>
        </label>
        ${tag.lyrics ? `<p class="muted small">Tag lyrics: “${esc(tag.lyrics.replace(/\s+/g, ' ').trim())}”</p>` : ''}
      </section>
    </div>

    <div class="btns rv-actions">
      ${dirty ? '<button data-act="revert">Discard my edits</button>' : ''}
      <button class="primary go" data-act="ok">${dirty ? 'Save' : '✓ Correct'}${lastPhrase ? (back === 'lesson' ? ' → back to lesson' : nextPart ? ` → ${nextPart}` : ' → done') : ' → next phrase'}</button>
    </div>
    <p class="center"><button class="link danger" data-act="hide">🚩 This tag is too wrong to fix — hide it</button></p>
  </main>`;
  bind();
  const imgEl = $('.sheet img', app);
  if (imgEl) imgEl.onerror = () => { imgEl.closest('.sheet-box').outerHTML = '<p class="muted">Couldn’t load a preview.</p>'; };
  if (tag.tracks && tag.tracks[view.part]) audio.preloadTrack(tag.tracks[view.part]);
}

function edit(fn, { keepSel = false, then = null } = {}) {
  view.undo.push({ notes: view.notes, range: [...view.range], sel: view.sel });
  if (view.undo.length > 50) view.undo.shift();
  const before = view.notes.length;
  view.notes = fn(view.notes);
  view.range = [view.range[0], view.range[1] + view.notes.length - before];
  if (!keepSel) view.sel = Math.min(view.sel, view.range[1] - 1);
  if (then) then();
  persistEdit();
  render();
}

/** Keep the edit applied on this device (unsent until Submit). */
function persistEdit() {
  const store = env.store();
  const original = env.raw(view.id).parts[view.part];
  if (C.sameNotes(view.notes, original)) {
    const pe = store[view.id] && store[view.id].parts[view.part];
    if (pe) { delete pe.notes; if (!pe.ok) C.forget(store, view.id, view.part); }
  } else {
    const ok = !!(store[view.id] && store[view.id].parts[view.part] && store[view.id].parts[view.part].ok);
    C.recordPart(store, view.id, view.part, { notes: view.notes, ok });
  }
  env.save({ rebuild: true });
}

function bind() {
  const { app } = env;
  const tag = env.tag(view.id);
  bindSubmit(app);
  const go = (phrase, part = view.part) => { location.hash = `review/${view.id}/${part}/${phrase}`; };
  app.querySelectorAll('[data-part]').forEach(b => b.onclick = () => go(0, b.dataset.part));
  $('[data-act=prev]', app).onclick = () => go(view.phrase - 1);
  $('[data-act=next]', app).onclick = () => go(view.phrase + 1);
  $('[data-act=whole]', app).onclick = () => go(view.whole ? 0 : 'all');
  app.querySelectorAll('.nchip').forEach(b => b.onclick = () => {
    view.sel = Number(b.dataset.i);
    audio.unlock(); audio.stopAll(); audio.playNote(view.notes[view.sel][0], 0.5);
    render();
  });
  const sound = () => { audio.unlock(); audio.stopAll(); audio.playNote(view.notes[view.sel][0], 0.45); };
  app.querySelectorAll('[data-op]').forEach(b => b.onclick = () => {
    const i = view.sel;
    switch (b.dataset.op) {
      case 'up': edit(n => C.transpose(n, i, 1), { keepSel: true }); sound(); break;
      case 'down': edit(n => C.transpose(n, i, -1), { keepSel: true }); sound(); break;
      case 'oct-up': edit(n => C.transpose(n, i, 12), { keepSel: true }); sound(); break;
      case 'oct-down': edit(n => C.transpose(n, i, -12), { keepSel: true }); sound(); break;
      case 'split': edit(n => C.splitNote(n, i), { keepSel: true }); break;
      case 'merge': edit(n => C.mergeNext(n, i), { keepSel: true }); break;
      case 'delete': edit(n => C.deleteNote(n, i)); break;
      case 'bar': edit(n => C.toggleFlag(n, i, '|'), { keepSel: true }); break;
      case 'tie': edit(n => C.toggleFlag(n, i, '~'), { keepSel: true }); break;
      case 'autobar': edit(n => C.autoBars(n, i, view.perBar || 4), { keepSel: true }); break;
      case 'undo': {
        const u = view.undo.pop();
        if (u) { view.notes = u.notes; view.range = u.range; view.sel = u.sel; persistEdit(); render(); }
        break;
      }
    }
  });
  app.querySelectorAll('[data-len]').forEach(b => b.onclick = () => edit(n => C.setBeats(n, view.sel, Number(b.dataset.len)), { keepSel: true }));
  const per = $('select[name=perBar]', app);
  per.onchange = () => { view.perBar = Number(per.value); };
  // keyboard: tap a key to set the selected note's pitch
  const partMidis = view.notes.map(n => n[0]);
  const [lo, hi] = rangeFor([...partMidis, Math.min(...partMidis) - 3, Math.max(...partMidis) + 3], 12);
  const kbHost = $('.fix-kb', app);
  view.kb = mountKeyboard(kbHost, {
    lo, hi, tonic: tag.tonic, labels: true,
    onKey: m => {
      audio.unlock(); audio.stopAll(); audio.playNote(m, 0.45);
      const i = view.sel;
      if (m === view.notes[i][0]) { if (view.advance !== false) { view.sel = Math.min(i + 1, view.range[1] - 1); render(); } return; }
      edit(n => C.transpose(n, i, m - n[i][0]), { keepSel: true, then: () => { if (view.advance !== false) view.sel = Math.min(i + 1, view.range[1] - 1); } });
    },
  });
  view.kb.hint(view.notes[view.sel][0]);
  const kbWrap = kbHost.querySelector('.kb-wrap');
  if (view.kbScroll != null) kbWrap.scrollLeft = view.kbScroll;
  kbWrap.onscroll = () => { view.kbScroll = kbWrap.scrollLeft; };
  $('input[name=advance]', app).onchange = e => { view.advance = e.target.checked; };
  const syl = $('input[name=syl]', app);
  syl.onchange = () => edit(n => C.setSyllable(n, view.sel, syl.value), { keepSel: true });
  const words = $('input[name=words]', app);
  const lay = () => edit(n => C.layLyrics(n, words.value, view.range[0], view.range[1]), { keepSel: true });
  $('[data-act=lay]', app).onclick = lay;
  words.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); lay(); } };
  syl.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); syl.blur(); } };

  // listening
  const phraseNotes = () => slice();
  const realBtn = (btn, start, end, alsoSynth) => {
    audio.unlock(); audio.stopAll();
    const label = btn.textContent;
    let synthStarted = false, following = false;
    audio.playTrack(tag.tracks[view.part], start, end, err => { if (err) env.toast(err.message === 'blocked' ? 'The phone blocked playback — tap again' : 'The real recording needs a connection'); }, {
      onState: s => {
        btn.classList.toggle('loading', s === 'loading');
        btn.textContent = s === 'loading' ? '⏳ Loading…' : s === 'playing' ? '■ Stop' : label;
        btn.dataset.playing = s === 'playing' || s === 'loading' ? '1' : '';
        if (s === 'playing' && alsoSynth && !synthStarted) { synthStarted = true; setTimeout(() => audio.playNotes(phraseNotes()), 150); }
        if (s === 'playing' && !following) { following = true; audio.followTrack(view.notes, i => highlight(i)); }
      },
    });
  };
  const ns = phraseNotes();
  const start = ns[0][1], last = ns[ns.length - 1], end = last[1] + last[2];
  const p = $('[data-act=play]', app);
  if (p) p.onclick = () => {
    audio.unlock(); audio.stopAll();
    const from = view.range[0];
    const secs = audio.playNotes(ns, { onNote: k => highlight(from + k) });
    clearTimeout(view.synthEnd);
    view.synthEnd = setTimeout(() => { if (view) highlight(-1); }, secs * 1000 + 100);
  };
  for (const [act, s, e, synth] of [['real', start, end, false], ['both', start, end, true], ['real-all', 0, null, false]]) {
    const b = $(`[data-act=${act}]`, app);
    if (b) b.onclick = () => (b.dataset.playing ? audio.stopAll() : realBtn(b, s, e, synth));
  }

  // decisions
  const rv = $('[data-act=revert]', app);
  if (rv) rv.onclick = () => {
    view.notes = env.raw(view.id).parts[view.part].map(n => [...n]);
    view.undo = []; view.range = null; view.rangeKey = null;
    persistEdit();
    showReview(`${view.id}/${view.part}/0`);
  };
  $('[data-act=ok]', app).onclick = () => {
    audio.stopAll();
    const rs = ranges(view.notes);
    if (!view.whole && view.phrase < rs.length - 1) { go(view.phrase + 1); return; }
    // part done: record it as checked (with any edits)
    const store = env.store();
    const original = env.raw(view.id).parts[view.part];
    C.recordPart(store, view.id, view.part, { notes: C.sameNotes(view.notes, original) ? null : view.notes, ok: true });
    if (C.sameNotes(view.notes, original) && store[view.id].parts[view.part]) delete store[view.id].parts[view.part].notes;
    env.save({ rebuild: true });
    view.saved = JSON.stringify(view.notes);
    const nextPart = PARTS[PARTS.indexOf(view.part) + 1];
    if (back !== 'lesson' && nextPart) { go(0, nextPart); return; }
    env.toast(back === 'lesson' ? `Saved — thanks!` : `${tag.title} checked ✓`);
    location.hash = backHash();
  };
  $('[data-act=hide]', app).onclick = () => {
    const why = window.prompt('What’s wrong with it? (optional)', '');
    if (why === null) return;
    C.recordHide(env.store(), view.id, { comment: why });
    env.save({ rebuild: true });
    view = null;
    env.toast('Hidden on this phone — Submit to remove it for everyone');
    location.hash = back && back !== 'lesson' ? 'review' : backHash();
  };
}

/** Light up note i (index into the whole part; -1 = none) on the chips,
 *  the staff and the keyboard, as the synth or the real singer reaches it. */
function highlight(i) {
  const app = env.app;
  app.querySelectorAll('.nchip').forEach(b => b.classList.toggle('playing', Number(b.dataset.i) === i));
  const [from, to] = view.range;
  const tag = env.tag(view.id);
  const wrap = app.querySelector('.ours .staff-wrap');
  if (wrap && tag) {
    const on = i >= from && i < to;
    wrap.innerHTML = env.staffHtml(tag, view.part, view.notes.slice(from, to), { names: true, rhythm: true, highlight: on ? i - from : view.sel - from, force: true });
    wrap.classList.toggle('live', on);
  }
  if (view.kb) view.kb.light(i >= 0 && view.notes[i] ? view.notes[i][0] : null);
}
