// Gamification: XP, daily goal, streak (with freezes), badges.
// Pure state transitions on a plain object, persisted by store.js.

export const XP = { correct: 10, perfectBonus: 5, lessonDone: 15, memorised: 25 };
export const DEFAULT_GOAL = 40; // ≈ one short lesson

export function initialState() {
  return {
    version: 2,
    settings: {
      myPart: 'Lead',
      mode: 'tag-by-tag',      // learn all four parts of a tag, then the next tag
      partOrder: 'melody',     // Lead → Bass → Tenor → Bari ('mine' = my part first)
      dailyGoal: DEFAULT_GOAL,
      speech: true,
      octaveFree: true,
      showNames: true,
      synthVolume: 0.7,
    },
    cards: {},
    xpTotal: 0,
    xpByDay: {},
    streak: 0,
    bestStreak: 0,
    lastActiveDay: null,
    freezes: 1,
    gems: 0,
    lessons: 0,
    learnedLog: [],   // {day, tagId, part, phrase} — reached level 2 (recalled today)
    memorisedLog: [], // {day, tagId, part, phrase} — reached level 4 (long-term)
    badges: [],
    skips: { listenUntil: 0, singUntil: 0 },
  };
}

/** Roll the streak forward to `today` (call on app open and on activity). */
export function rollStreak(state, today) {
  const s = state;
  if (s.lastActiveDay == null) return s;
  const gap = today - s.lastActiveDay;
  if (gap <= 1) return s;
  // missed days: consume freezes, otherwise reset
  const missed = gap - 1;
  if (s.freezes >= missed) {
    s.freezes -= missed;
    s.lastActiveDay = today - 1;
  } else {
    s.streak = 0;
  }
  return s;
}

export function addXp(state, amount, today) {
  state.xpTotal += amount;
  state.xpByDay[today] = (state.xpByDay[today] || 0) + amount;
  // goal reached today for the first time → streak tick
  const before = state.xpByDay[today] - amount;
  if (before < state.settings.dailyGoal && state.xpByDay[today] >= state.settings.dailyGoal) {
    rollStreak(state, today);
    if (state.lastActiveDay !== today) {
      state.streak += 1;
      state.lastActiveDay = today;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      state.gems += 5;
      if (state.streak % 7 === 0) state.freezes = Math.min(3, state.freezes + 1);
      return { goalReached: true };
    }
  }
  return { goalReached: false };
}

export function goalProgress(state, today) {
  return Math.min(1, (state.xpByDay[today] || 0) / state.settings.dailyGoal);
}

export function level(xpTotal) {
  // gentle curve: level n needs 50·n·(n+1)/2 XP
  let n = 0;
  while (50 * (n + 1) * (n + 2) / 2 <= xpTotal) n++;
  return n + 1;
}

export const BADGES = [
  { id: 'first-lesson', icon: '🎵', name: 'First Ring', test: s => s.lessons >= 1 },
  { id: 'first-phrase', icon: '🧠', name: 'First Phrase Learned', test: s => s.learnedLog.length >= 1 },
  { id: 'first-memorised', icon: '🔒', name: 'Locked In', test: s => s.memorisedLog.length >= 1 },
  { id: 'streak-3', icon: '🔥', name: '3-Day Streak', test: s => s.bestStreak >= 3 },
  { id: 'streak-7', icon: '🌟', name: 'Week of Tags', test: s => s.bestStreak >= 7 },
  { id: 'streak-30', icon: '🏆', name: 'Month of Tags', test: s => s.bestStreak >= 30 },
  { id: 'phrases-10', icon: '🎶', name: '10 Phrases Learned', test: s => s.learnedLog.length >= 10 },
  { id: 'phrases-50', icon: '🎼', name: '50 Phrases Memorised', test: s => s.memorisedLog.length >= 50 },
  { id: 'first-tag-part', icon: '🎤', name: 'Whole Part!', test: s => s.memorisedLog.some(m => m.phrase === 'all') },
  { id: 'all-four', icon: '🧩', name: 'All Four Parts', test: s => quartetDone(s, s.learnedLog) },
  { id: 'quartet', icon: '💈', name: 'Whole Quartet Memorised', test: s => quartetDone(s, s.memorisedLog) },
  { id: 'xp-1000', icon: '💎', name: '1000 XP', test: s => s.xpTotal >= 1000 },
];

function quartetDone(s, log) {
  const byTag = {};
  for (const m of log) if (m.phrase === 'all') (byTag[m.tagId] = byTag[m.tagId] || new Set()).add(m.part);
  return Object.values(byTag).some(set => set.size >= 4);
}

/** Award any newly earned badges; returns the new ones. */
export function checkBadges(state) {
  const got = [];
  for (const b of BADGES) {
    if (!state.badges.includes(b.id) && b.test(state)) { state.badges.push(b.id); got.push(b); }
  }
  return got;
}

/**
 * "Can't listen / can't sing now" skips last 15 minutes, like Duolingo.
 */
export function setSkip(state, kind, nowMs, minutes = 15) {
  const key = kind === 'listen' ? 'listenUntil' : 'singUntil';
  state.skips[key] = nowMs + minutes * 60000;
}

export function capabilities(state, nowMs, env = {}) {
  const { hasMic = true, hasAudio = true } = env;
  return {
    canListen: hasAudio && nowMs >= state.skips.listenUntil,
    canSing: hasMic && hasAudio && nowMs >= state.skips.singUntil,
  };
}

/** Merge a stored object over a fresh state so new fields get defaults. */
export function migrate(stored) {
  const base = initialState();
  if (!stored || typeof stored !== 'object') return base;
  // v2: the default became "learn every part of a tag" (was my-part-first)
  if ((stored.version || 1) < 2 && stored.settings) {
    stored = { ...stored, settings: { ...stored.settings, mode: 'tag-by-tag', partOrder: 'melody' } };
  }
  return {
    ...base,
    ...stored,
    version: base.version,
    settings: { ...base.settings, ...(stored.settings || {}) },
    skips: { ...base.skips, ...(stored.skips || {}) },
  };
}
