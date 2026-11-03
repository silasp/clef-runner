// End-to-end: the review & correct screen. Fixes a phrase's notes and words,
// checks the fix applies on the device, survives a reload, and produces a
// prefilled GitHub issue. Usage: serve the folder, then `node tests/e2e/review.mjs`.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: !!process.env.FULL }); };
// capture the issue URL instead of opening GitHub
await page.addInitScript(() => { window.open = url => { window.__opened = url; return null; }; });

await page.goto(BASE + '#review');
await page.waitForSelector('.rq li');
const count = await page.locator('.rq li').count();
assert.ok(count > 100, `review list shows the library (${count})`);
await shot('r1-list');

// a tag with PDF sheet music (pre-rendered image) and learning tracks
const id = await page.evaluate(async () => {
  const d = await (await fetch('data/tags.json')).json();
  for (const t of d.tags) {
    if (!/\.pdf$/i.test(t.sheet || '') || !t.tracks) continue;
    const r = await fetch(`sheets/${t.id}.png`, { method: 'HEAD' });
    if (r.ok) return String(t.id);
  }
});
assert.ok(id, 'found a tag with a pre-rendered sheet');
await page.goto(BASE + `#review/${id}/Lead/0`);
await page.waitForSelector('.review .nchip');
await page.waitForFunction(() => { const i = document.querySelector('.sheet img'); return i && i.complete && i.naturalWidth > 300; });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok(overflow <= 0, `review screen overflows by ${overflow}px`);
await shot('r2-review');

const before = await page.locator('.nchip').count();
await page.click('.nchip >> nth=0');
await page.click('[data-op=split]');
assert.equal(await page.locator('.nchip').count(), before + 1, 'split adds a repeated note');
await page.click('[data-op=up]');
const words = Array.from({ length: before + 1 }, (_, i) => `w${i}`).join(' ');
await page.fill('input[name=words]', words);
await page.click('[data-act=lay]');
assert.equal(await page.textContent('.nchip >> nth=1 >> span'), 'w1');

// lengths, barlines and ties
await page.click('.nchip >> nth=0');
await page.click('[data-len="0.5"]');
assert.ok(await page.locator('[data-len="0.5"].on').count(), 'eighth selected');
await page.click('.nchip >> nth=1');
await page.click('[data-op=bar]');
assert.equal(await page.locator('.ours .st-bar').count(), 1, 'barline drawn');
await page.click('[data-op=autobar]');
await page.click('.nchip >> nth=0');
await page.click('[data-op=down]');      // the split pair is a semitone apart now: make them equal again
assert.equal(await page.locator('[data-op=tie]:not([disabled])').count(), 1, 'tie allowed between equal pitches');
await page.click('[data-op=tie]');
assert.equal(await page.locator('.ours .st-tie').count(), 1, 'tie drawn');
const flags = await page.evaluate(id => JSON.parse(localStorage.getItem('daily-tag:corrections'))[id].parts.Lead.notes.map(n => n[5] || ''), id);
assert.equal(flags[0], '~');
assert.equal(flags[1], '|');
await page.click('[data-act=play]');      // synth copes with ties
await page.waitForSelector('.nchip.playing', { timeout: 3000 });   // notes light up as they play

// set pitches from the keyboard: tap a key, selection moves on
await page.click('.nchip >> nth=2');
const kbKey = await page.evaluate(() => {
  const keys = [...document.querySelectorAll('.fix-kb [data-midi]')].map(k => Number(k.dataset.midi));
  return keys[Math.floor(keys.length / 2)];
});
await page.click(`.fix-kb [data-midi="${kbKey}"]`);
const after = await page.evaluate(id => JSON.parse(localStorage.getItem('daily-tag:corrections'))[id].parts.Lead.notes[2][0], id);
assert.equal(after, kbKey, 'keyboard sets the pitch');
assert.equal(await page.getAttribute('.nchip.sel', 'data-i'), '3', 'then moves to the next note');
await page.click('.nchip >> nth=2');
await page.click('[data-op=oct-up]');
assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem('daily-tag:corrections'))[id].parts.Lead.notes[2][0], id), kbKey + 12);
await page.click('[data-op=undo]');
await shot('r3-edited');

// the fix is live on this device, before submitting
const stored = await page.evaluate(k => JSON.parse(localStorage.getItem('daily-tag:corrections')), 'x');
assert.ok(stored[id].parts.Lead.notes, 'edit stored locally');
assert.equal(stored[id].parts.Lead.notes[0][3], 0.5);
await page.reload();
await page.waitForSelector('.review .nchip');
assert.equal(await page.locator('.nchip').count(), before + 1, 'edit survives a reload');

// mark the part correct, then submit
const okLabel = await page.textContent('[data-act=ok]');
assert.match(okLabel, /next phrase|Tenor|Bari|Bass|done/);
const unsent = page.locator('[data-act=submit]');
assert.match(await unsent.textContent(), /Submit 1 fix/);
await unsent.click();
const url = await page.evaluate(() => window.__opened);
assert.ok(url && url.startsWith('https://github.com/silas-dsc/daily-tag/issues/new?title='), url);
const body = decodeURIComponent(new URL(url).searchParams.get('body'));
assert.match(body, /daily-tag-corrections/);
assert.match(body, /Lead ✎/);

// the corrected notes reach lessons too
await page.goto(BASE + `#drill/intro/${id}/Lead/0`);
await page.waitForSelector('.ex-body .staff-wrap');
assert.match(await page.textContent('.ex-body'), /w0/);
assert.ok(await page.locator('[data-act=fix]').count(), 'lesson offers a fix link');

// hide a tag
page.on('dialog', d => d.accept('not a real tag'));
await page.goto(BASE + `#review/${id}/Lead/0`);
await page.waitForSelector('[data-act=hide]');
await page.click('[data-act=hide]');
await page.waitForSelector('.rq li');
const hidden = await page.evaluate(k => JSON.parse(localStorage.getItem('daily-tag:corrections')), 'x');
assert.equal(hidden[id].hide, true);
assert.equal(await page.locator(`.rq li[data-go="${id}"]`).count(), 0, 'hidden tag gone from the list');

assert.deepEqual(errors, []);
await browser.close();
console.log(`e2e review OK — tag ${id}, ${before}→${before + 1} notes, issue URL ${url.length} chars`);
