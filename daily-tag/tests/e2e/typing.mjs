// Desktop: the tapping exercise can be answered by typing note names.
// Usage: serve the folder, then `node tests/e2e/typing.mjs [drill-hash]`.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });   // mouse + keyboard
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE);
await page.waitForSelector('.today-card');
// the first tag on the path, guided tapping of its first phrase
const hash = process.argv[2] || await page.evaluate(() => {
  const li = document.querySelector('.path li');
  return `drill/guided/${li.dataset.tag || li.dataset.tune}/${li.dataset.tune ? '0' : 'Lead/0'}`;
});
await page.goto(BASE + '#' + hash);
await page.waitForSelector('.kb');
assert.ok(await page.isVisible('.typing-help'), 'shows the typing help on a computer');
for (let k = 0; k < 80 && !(await page.isVisible('.feedback')); k++) {
  // the glowing key is the next note; find the letter (and modifier) that types it
  const combo = await page.evaluate(async () => {
    const { typedNote } = await import('./js/keyboard.js');
    const kb = document.querySelector('.kb');
    const target = Number(kb.querySelector('.hint').dataset.midi);
    const tonic = Number(kb.dataset.tonic);
    for (const letter of 'ABCDEFG') for (const [shift, alt] of [[false, false], [true, false], [false, true]]) {
      if (typedNote(letter, { shift, alt }, { tonic, target }) === target) return { letter, shift, alt };
    }
    return null;
  });
  assert.ok(combo, 'every note can be typed');
  const mods = [combo.shift && 'Shift', combo.alt && 'Alt'].filter(Boolean);
  await page.keyboard.press([...mods, 'Key' + combo.letter].join('+'));
}
await page.waitForSelector('.feedback', { timeout: 3000 });
const fb = await page.textContent('.feedback');
assert.match(fb, /Nailed|Ring|Locked|Beautiful|Lovely|In tune|Right on/, 'all typed notes were right: ' + fb);
assert.deepEqual(errors, []);
console.log('e2e typing OK —', hash);
await browser.close();
