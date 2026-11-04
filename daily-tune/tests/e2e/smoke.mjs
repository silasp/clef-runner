// End-to-end smoke test: loads the app on an iPhone SE-sized viewport and
// completes a full lesson in "silent" mode (no listening, no singing).
// Usage: serve the folder (npm run serve) then `npm run test:e2e`.
// Env: BASE_URL (default http://localhost:8080/), SHOTS=dir to save screenshots.
import { createRequire } from 'node:module';
// works with a local devDependency or a globally installed playwright
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

await page.goto(BASE);
await page.waitForSelector('.today-card');
await shot('01-home');

// no horizontal overflow at 320px
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok(overflow <= 0, `page overflows horizontally by ${overflow}px`);

// go silent: can't listen + can't sing
await page.click('[data-act=toggle-listen]');
await page.click('[data-act=toggle-sing]');
assert.match(await page.textContent('[data-act=toggle-listen]'), /Silent/);

await page.click('[data-act=start]');
await page.waitForSelector('.ex-body');
const kinds = [];
for (let step = 0; step < 15; step++) {
  if (await page.$('.results')) break;
  const kind = (await page.textContent('.kind')).trim();
  kinds.push(kind);
  if (step === 1) await shot('02-exercise');
  if (await page.$('[data-act=got]')) {
    await page.click('[data-act=got]');
  } else if (await page.$('.kb')) {
    // answer tap exercises by reading the target notes from the app state is not
    // possible from outside, so use the hint button to reveal + tap each note
    for (let k = 0; k < 60 && !(await page.isVisible('.feedback')); k++) {
      const hinted = await page.$('.kb .hint');
      if (hinted) { await hinted.dispatchEvent('pointerdown'); continue; }
      const hintBtn = await page.$('[data-act=hint]');
      if (hintBtn) await hintBtn.click(); else break;
    }
  } else if (await page.$('.opt')) {
    await page.click('.opt');
  }
  if (!(await page.isVisible('.feedback'))) await page.click('[data-act=skip]');
  else { if (step === 2) await shot('03-feedback'); await page.click('[data-act=next]'); }
}
await page.waitForSelector('.results', { timeout: 5000 });
await shot('04-results');
const xp = await page.textContent('.res-grid b');
assert.match(xp, /\+\d+/);
for (const k of kinds) assert.ok(!/heard|chord|Sing it/i.test(k), `silent mode showed "${k}"`);

// progress persisted
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('daily-tune:v1')));
assert.ok(stored.lessons >= 1 && Object.keys(stored.cards).length >= 1);

// genre filter + search across the whole library (not just the rows drawn)
await page.click('[data-act=home]');
await page.waitForSelector('.path li');
await page.selectOption('.genre', 'jazz');
await page.waitForSelector('.path li');
await page.fill('.filter', 'parker solo');
const found = await page.$$eval('.path li .tt b', els => els.map(e => e.textContent));
assert.ok(found.length >= 3 && found.every(t => /parker/i.test(t)), 'search finds the Parker solos: ' + found.slice(0, 3).join(', '));
await page.fill('.filter', '');
await page.selectOption('.genre', 'folk');
await page.waitForSelector('.path li');

// tune page: the whole tune engraved, chunk bar, settings render
await page.click('.path li');
await page.waitForSelector('.tagpage .staff');
assert.ok(await page.$('.tagpage .chunks i'), 'chunk progress bar');
const tuneOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok(tuneOverflow <= 0, `tune page overflows by ${tuneOverflow}px`);
await shot('05-tune');
await page.goto(BASE + '#settings');
await page.waitForSelector('.settings');
await page.selectOption('select[name=clef]', 'bass');
await shot('06-settings');
assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
console.log('e2e smoke OK — exercises:', kinds.join(' | '));
await browser.close();
