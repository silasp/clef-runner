// Spaced-repetition scheduling (Leitner boxes with SM-2 style ease).
// A "card" is one memorisable unit: a phrase of one part of one tag, or
// the whole part chained together.
//
// level 0  = new / just failed      → full notation + names shown
// level 1  = seen once correctly    → full notation
// level 2  = recalled               → only some notes shown (vanishing cues)
// level 3  = solid                  → first note only
// level 4+ = memorised              → no cues at all
// The level doubles as the "cue fade" for notation.

export const INTERVAL_DAYS = [0, 1, 2, 4, 8, 16, 35, 75];
export const MEMORISED_LEVEL = 4;
export const LEARNED_LEVEL = 2;
export const MAX_LEVEL = INTERVAL_DAYS.length - 1;

export function dayNumber(date = new Date()) {
  // local calendar day, so the streak rolls over at the user's midnight
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round(d.getTime() / 86400000);
}

export function newCard(id) {
  return { id, level: 0, ease: 2.5, due: 0, reps: 0, lapses: 0, last: null, best: 0 };
}

/**
 * Apply a graded review.
 * @param {object} card
 * @param {number} grade     0..1 accuracy of the attempt
 * @param {number} today     day number
 * @param {number} [cueLevel=MAX_LEVEL] how much help was shown (see cue levels above);
 *   a success can lift the card at most to max(1, cueLevel), so copying from
 *   full notation never counts as memory: to climb, the learner is tested
 *   one cue-step harder than their current level.
 * Spacing rule: within one day a card can reach level 2 ("learned today")
 * but no further — long-term levels need a gap between reviews.
 */
export function review(card, grade, today, cueLevel = MAX_LEVEL) {
  const c = { ...card };
  const sameDay = c.last === today;
  c.reps++;
  c.last = today;
  c.best = Math.max(c.best || 0, grade);
  if (grade >= 0.85) {
    let cap = Math.min(MAX_LEVEL, Math.max(1, cueLevel));
    if (sameDay) cap = Math.min(cap, 2);
    if (c.level < cap) c.level = c.level + 1;
    c.ease = Math.min(3.0, c.ease + 0.05);
  } else if (grade >= 0.6) {
    c.ease = Math.max(1.3, c.ease - 0.1);
  } else {
    if (c.level >= 2) c.lapses++;
    c.level = Math.max(0, c.level - 2);
    c.ease = Math.max(1.3, c.ease - 0.2);
  }
  const base = INTERVAL_DAYS[c.level];
  const scaled = c.level <= 1 ? base : Math.round(base * (c.ease / 2.5));
  c.due = today + Math.max(c.level >= 2 ? 1 : 0, scaled);
  return c;
}

export function isDue(card, today) {
  return card.reps > 0 && card.due <= today;
}

export function isMemorised(card) {
  return !!card && card.level >= MEMORISED_LEVEL;
}

/** Due cards, most overdue / weakest first. */
export function dueCards(cards, today) {
  return Object.values(cards)
    .filter(c => isDue(c, today))
    .sort((a, b) => (a.due - b.due) || (a.level - b.level));
}

/**
 * Cue mask for notation fading: which note indices are shown.
 * Deterministic for a given (count, level, seed) so a lesson is stable.
 */
export function cueMask(count, level, seed = 1) {
  if (level <= 1) return new Array(count).fill(true);
  if (level >= 4) return new Array(count).fill(false);
  if (level === 3) return Array.from({ length: count }, (_, i) => i === 0);
  // level 2: first note + roughly every other note, pseudo-randomly offset
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: count }, (_, i) => i === 0 || rnd() < 0.4);
}
