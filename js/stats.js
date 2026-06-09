/* stats.js — local play stats (replaces the leaderboard). All persisted to
   localStorage: player name, most-recent score, time & score totals for today
   and all-time, plus milestone bookkeeping that drives the celebration screens.
   Each milestone fires once by remembering the highest tier already celebrated. */
(function (App) {
  'use strict';

  const KEY = 'sr.stats';
  const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Milestone tiers. Score is per-game; streak is in days; time tiers in minutes.
  const SCORE_TIERS = [50, 100, 200, 350, 500, 750, 1000, 1500, 2500, 4000, 6000, 9000, 15000];
  const STREAK_TIERS = [2, 3, 5, 7, 10, 14, 21, 30, 50, 75, 100, 150, 200, 365];
  const TIME_TODAY_TIERS = [10, 20, 30, 45, 60, 90, 120, 180];
  const TIME_ALL_TIERS = [60, 180, 300, 600, 1200, 3000, 6000];

  function highest(tiers, value) {
    let r = 0;
    for (const t of tiers) if (value >= t) r = t;
    return r;
  }

  function blank() {
    const d = todayStr();
    return {
      name: '',
      lastScore: 0,
      today: { date: d, timeMs: 0, score: 0 },
      allTime: { timeMs: 0, score: 0 },
      // highest tier already celebrated (so each milestone fires exactly once)
      seen: { streak: 0, timeAll: 0, timeToday: 0, timeTodayDate: d },
    };
  }

  function load() {
    let s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    const b = blank();
    if (!s || typeof s !== 'object') return b;
    s.today = Object.assign(b.today, s.today || {});
    s.allTime = Object.assign(b.allTime, s.allTime || {});
    s.seen = Object.assign(b.seen, s.seen || {});
    if (typeof s.name !== 'string') s.name = '';
    if (typeof s.lastScore !== 'number') s.lastScore = 0;
    return s;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch (e) {} }

  // reset the per-day buckets at midnight
  function rollDay() {
    const d = todayStr();
    if (stats.today.date !== d) stats.today = { date: d, timeMs: 0, score: 0 };
    if (stats.seen.timeTodayDate !== d) { stats.seen.timeTodayDate = d; stats.seen.timeToday = 0; }
    return stats;
  }

  let stats = load();
  rollDay();

  const Stats = {
    SCORE_TIERS,
    highest,

    get() { return rollDay(); },
    refresh() { stats = load(); rollDay(); return stats; },

    setName(name) {
      name = (name == null ? '' : String(name)).trim().slice(0, 24);
      if (name !== stats.name) { stats.name = name; save(); }
      return stats.name;
    },

    // Record a finished game into the running totals.
    recordGame(score, timeMs) {
      rollDay();
      score = Math.max(0, score | 0);
      timeMs = Math.max(0, Math.round(timeMs || 0));
      stats.lastScore = score;
      stats.today.score += score;
      stats.today.timeMs += timeMs;
      stats.allTime.score += score;
      stats.allTime.timeMs += timeMs;
      save();
      return stats;
    },

    // ---- milestone checks (return descriptors, recording what's been seen) ----

    // Day-streak milestone: returns {kind:'streak', value} once per tier reached.
    streakMilestone(days) {
      const reached = highest(STREAK_TIERS, days | 0);
      if (reached > (stats.seen.streak || 0)) {
        stats.seen.streak = reached; save();
        return { kind: 'streak', value: reached };
      }
      return null;
    },

    // Time milestones (today + all-time), evaluated against the stored totals.
    // Returns an array of newly-reached {kind, value} descriptors (value = minutes).
    timeMilestones() {
      rollDay();
      const out = [];
      const todayMin = Math.floor(stats.today.timeMs / 60000);
      const allMin = Math.floor(stats.allTime.timeMs / 60000);
      const rt = highest(TIME_TODAY_TIERS, todayMin);
      if (rt > (stats.seen.timeToday || 0)) { stats.seen.timeToday = rt; out.push({ kind: 'timeToday', value: rt }); }
      const ra = highest(TIME_ALL_TIERS, allMin);
      if (ra > (stats.seen.timeAll || 0)) { stats.seen.timeAll = ra; out.push({ kind: 'timeAll', value: ra }); }
      if (out.length) save();
      return out;
    },
  };

  App.Stats = Stats;
})(window.App = window.App || {});
