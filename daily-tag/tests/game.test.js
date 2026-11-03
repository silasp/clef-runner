import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, addXp, rollStreak, goalProgress, level, checkBadges, setSkip, capabilities, migrate } from '../js/game.js';
import { load, save, importJson, exportJson, STORAGE_KEY } from '../js/store.js';

test('reaching the daily goal extends the streak once per day', () => {
  const s = initialState();
  s.settings.dailyGoal = 30;
  assert.equal(addXp(s, 20, 100).goalReached, false);
  assert.equal(addXp(s, 15, 100).goalReached, true);
  assert.equal(s.streak, 1);
  addXp(s, 50, 100);
  assert.equal(s.streak, 1);
  addXp(s, 40, 101);
  assert.equal(s.streak, 2);
  assert.equal(goalProgress(s, 101), 1);
});

test('missed days use streak freezes, otherwise reset', () => {
  const s = initialState();
  s.settings.dailyGoal = 10;
  addXp(s, 10, 100);
  s.freezes = 1;
  addXp(s, 10, 102); // missed 101 → freeze
  assert.equal(s.streak, 2);
  assert.equal(s.freezes, 0);
  rollStreak(s, 105);
  assert.equal(s.streak, 0);
});

test('levels and badges', () => {
  assert.equal(level(0), 1);
  assert.equal(level(50), 2);
  assert.ok(level(1000) > level(500));
  const s = initialState();
  s.lessons = 1;
  s.learnedLog.push({ day: 1, tagId: '1', part: 'Lead', phrase: 0 });
  const got = checkBadges(s).map(b => b.id);
  assert.ok(got.includes('first-lesson') && got.includes('first-phrase'));
  assert.equal(checkBadges(s).length, 0, 'no duplicates');
});

test("situational skips expire", () => {
  const s = initialState();
  setSkip(s, 'sing', 1000, 15);
  assert.equal(capabilities(s, 2000).canSing, false);
  assert.equal(capabilities(s, 1000 + 16 * 60000).canSing, true);
  assert.equal(capabilities(s, 2000, { hasMic: false }).canSing, false);
});

test('store round-trips and survives bad data', () => {
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = initialState(); s.xpTotal = 123;
  assert.ok(save(s, storage));
  assert.equal(load(storage).xpTotal, 123);
  mem.set(STORAGE_KEY, '{oops');
  assert.equal(load(storage).xpTotal, 0);
  assert.equal(importJson(exportJson(s)).xpTotal, 123);
  assert.throws(() => importJson('{"x":1}'));
  assert.equal(migrate({ settings: { myPart: 'Bass' } }).settings.dailyGoal, 40);
});
