/* stats.js — local play stats (replaces the leaderboard). All persisted to
   localStorage: player name, most-recent score, time & score totals for today
   and all-time, plus milestone bookkeeping that drives the celebration screens.
   Each milestone fires once by remembering the highest tier already celebrated. */
(function (App) {
  'use strict';

  const KEY = 'sr.stats';
  const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Milestone tiers. Streak is in days; time tiers in minutes.
  const STREAK_TIERS = [2, 3, 5, 7, 10, 14, 21, 30, 50, 75, 100, 150, 200, 365];
  const TIME_TODAY_TIERS = [10, 20, 30, 45, 60, 90, 120, 180];
  const TIME_ALL_TIERS = [60, 180, 300, 600, 1200, 3000, 6000];

  // ---- award (celebration) pacing ----------------------------------------
  // Awards unlock as the player's CUMULATIVE all-time score passes growing
  // thresholds (500, 1500, 3000, 5000, 7500 …) — gaps widen so each award takes
  // progressively more sustained effort. An award is only granted when an
  // "opportunity window" is also open (see js/main.js): first page load, or once
  // enough practice has accumulated. That window starts at ~10 min of practice
  // and scales toward slightly above the player's median daily practice, nudging
  // longer sessions.
  const AWARD_BASE = 500;
  const AWARD_MIN_MS = 10 * 60000;  // floor: ~every 10 minutes of practice
  const AWARD_MAX_MS = 90 * 60000;  // never stretch the window beyond this
  const AWARD_MED_FACTOR = 1.2;     // sit "slightly above" the median daily practice
  function awardTargetFor(level) {
    level = Math.max(0, level | 0);
    return AWARD_BASE * ((level + 1) * (level + 2)) / 2;
  }
  function median(a) {
    if (!a || !a.length) return 0;
    const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

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
      bestDayStreak: 0, // longest run of consecutive days played, ever
      today: { date: d, timeMs: 0, score: 0, bestScore: 0, bestStreak: 0 },
      allTime: { timeMs: 0, score: 0, bestStreak: 0 },
      days: [],          // total practice ms for recent completed days (for the median)
      awardsEarned: 0,   // celebration awards unlocked so far (cumulative-score tiers)
      lastAwardAtMs: 0,  // lifetime practice ms snapshot when the last award fired
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
    if (typeof s.bestDayStreak !== 'number') s.bestDayStreak = 0;
    if (!Array.isArray(s.days)) s.days = [];
    if (typeof s.awardsEarned !== 'number') s.awardsEarned = 0;
    if (typeof s.lastAwardAtMs !== 'number') s.lastAwardAtMs = 0;
    return s;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch (e) {} }

  // reset the per-day buckets at midnight
  function rollDay() {
    const d = todayStr();
    if (stats.today.date !== d) {
      // archive the finished day's total practice (drives the median-daily cadence)
      if (stats.today.timeMs > 0) stats.days = (stats.days || []).concat(stats.today.timeMs).slice(-30);
      stats.today = { date: d, timeMs: 0, score: 0, bestScore: 0, bestStreak: 0 };
      save();
    }
    if (stats.seen.timeTodayDate !== d) { stats.seen.timeTodayDate = d; stats.seen.timeToday = 0; }
    return stats;
  }

  let stats = load();
  rollDay();

  const Stats = {
    get() { return rollDay(); },
    refresh() { stats = load(); rollDay(); return stats; },

    setName(name) {
      name = (name == null ? '' : String(name)).trim().slice(0, 24);
      if (name !== stats.name) { stats.name = name; save(); }
      return stats.name;
    },

    // Record a finished game into the running totals + bests.
    recordGame(score, timeMs, bestStreak) {
      rollDay();
      score = Math.max(0, score | 0);
      timeMs = Math.max(0, Math.round(timeMs || 0));
      bestStreak = Math.max(0, bestStreak | 0);
      stats.lastScore = score;
      stats.today.score += score;
      stats.today.timeMs += timeMs;
      stats.today.bestScore = Math.max(stats.today.bestScore || 0, score);
      stats.today.bestStreak = Math.max(stats.today.bestStreak || 0, bestStreak);
      stats.allTime.score += score;
      stats.allTime.timeMs += timeMs;
      stats.allTime.bestStreak = Math.max(stats.allTime.bestStreak || 0, bestStreak);
      save();
      return stats;
    },

    // Track the longest run of consecutive days played (called with the current
    // day streak each session); keeps the all-time maximum.
    recordDayStreak(days) {
      days = Math.max(0, days | 0);
      if (days > (stats.bestDayStreak || 0)) { stats.bestDayStreak = days; save(); }
      return stats.bestDayStreak;
    },

    // ---- awards (cumulative-score milestones, gated by opportunity windows) ----

    // Cumulative all-time score needed for the next award.
    awardTarget() { return awardTargetFor(stats.awardsEarned || 0); },
    // Points still to go before the next award (for the live HUD hint).
    pointsToNext(liveScore) { return Math.max(0, Math.ceil(this.awardTarget() - (liveScore || 0))); },
    // Practice ms that must accumulate between awards: ~10 min, scaling toward
    // slightly above the player's median daily practice (pushes longer sessions).
    awardIntervalMs() {
      const med = median(stats.days || []);
      return Math.min(AWARD_MAX_MS, Math.max(AWARD_MIN_MS, Math.round(med * AWARD_MED_FACTOR)));
    },
    // True once enough practice has accrued since the last award. liveExtraMs is
    // the current (unrecorded) session's play time.
    awardWindowOpen(liveExtraMs) {
      const since = (stats.allTime.timeMs + (liveExtraMs || 0)) - (stats.lastAwardAtMs || 0);
      return since >= this.awardIntervalMs();
    },
    // Grant the next award iff the cumulative-score milestone is reached AND an
    // opportunity window is open (force bypasses the window — used on first load).
    // Returns {value, level} when granted, else null.
    tryAward(liveScore, liveExtraMs, force) {
      const target = this.awardTarget();
      if ((liveScore || 0) < target) return null;          // milestone not reached
      if (!force && !this.awardWindowOpen(liveExtraMs)) return null; // not in a window
      stats.awardsEarned = (stats.awardsEarned || 0) + 1;
      stats.lastAwardAtMs = stats.allTime.timeMs + (liveExtraMs || 0); // restart the window
      save();
      return { value: Math.round(target), level: stats.awardsEarned };
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
