/* stats.js — local play stats (replaces the leaderboard). All persisted to
   localStorage: player name, most-recent score, time & score totals for today
   and all-time, plus milestone bookkeeping that drives the celebration screens.
   Each milestone fires once by remembering the highest tier already celebrated. */
(function (App) {
  'use strict';

  const KEY = 'sr.profiles';     // id -> profile record
  const KEY_ACTIVE = 'sr.activeId';
  const KEY_OLD = 'sr.stats';    // pre-multi-profile single blob (migrated once)
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

  // ---- treasure economy ---------------------------------------------------
  const SHOP = { freeze: 60 };          // gem price of a streak freeze
  // Variable-reward payout for opening a treasure box (mostly small, rare jackpot).
  function rollBox() {
    const r = Math.random();
    if (r < 0.55) return { gems: 5 + ((Math.random() * 11) | 0), tier: 'common' };
    if (r < 0.85) return { gems: 16 + ((Math.random() * 25) | 0), tier: 'nice' };
    if (r < 0.97) return { gems: 45 + ((Math.random() * 46) | 0), tier: 'rare' };
    return { gems: 150 + ((Math.random() * 151) | 0), tier: 'jackpot' };
  }
  const cityKey = (p) => (p ? (p.city + '|' + p.country) : '');

  // ---------- profile records ---------------------------------------------
  // Every local player is one profile record (shape below). Records live in a
  // map (id -> record) under KEY; KEY_ACTIVE names the one currently in play.
  // Same-named records are fused on load (most progress wins) so duplicate
  // profiles spawned across tabs/sessions never split a player's progress, and
  // every save re-merges with what's on disk first, so a stale tab can never
  // roll another tab's totals backward — fixing the "progress reset" when the
  // app is open in several tabs.
  function newId() { return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  const normName = (n) => (n == null ? '' : String(n)).trim().toLowerCase();

  function blank() {
    const d = todayStr();
    return {
      id: newId(),
      savedAt: 0,        // last write time (ms) — tiebreaker for "newest"
      name: '',
      lastScore: 0,
      bestDayStreak: 0, // longest run of consecutive days played, ever
      today: { date: d, timeMs: 0, score: 0, bestScore: 0, bestStreak: 0 },
      allTime: { timeMs: 0, score: 0, bestStreak: 0 },
      days: [],          // total practice ms for recent completed days (for the median)
      awardsEarned: 0,   // celebration awards unlocked so far (cumulative-score tiers)
      lastAwardAtMs: 0,  // lifetime practice ms snapshot when the last award fired
      gems: 0,           // soft currency
      boxes: 0,          // unopened treasure boxes banked from treasure notes
      freezes: 0,        // streak-freeze consumables owned
      boxesOpened: 0,    // lifetime boxes opened (stat)
      passport: {},      // "City|Country" -> times that celebration was collected
      // highest tier already celebrated (so each milestone fires exactly once)
      seen: { streak: 0, timeAll: 0, timeToday: 0, timeTodayDate: d },
    };
  }

  // Coerce an arbitrary parsed object into a valid record.
  function normalize(s) {
    const b = blank();
    if (!s || typeof s !== 'object') return b;
    s.today = Object.assign(b.today, s.today || {});
    s.allTime = Object.assign(b.allTime, s.allTime || {});
    s.seen = Object.assign(b.seen, s.seen || {});
    if (typeof s.id !== 'string' || !s.id) s.id = b.id;
    if (typeof s.savedAt !== 'number') s.savedAt = 0;
    if (typeof s.name !== 'string') s.name = '';
    if (typeof s.lastScore !== 'number') s.lastScore = 0;
    if (typeof s.bestDayStreak !== 'number') s.bestDayStreak = 0;
    if (!Array.isArray(s.days)) s.days = [];
    if (typeof s.awardsEarned !== 'number') s.awardsEarned = 0;
    if (typeof s.lastAwardAtMs !== 'number') s.lastAwardAtMs = 0;
    if (typeof s.gems !== 'number') s.gems = 0;
    if (typeof s.boxes !== 'number') s.boxes = 0;
    if (typeof s.freezes !== 'number') s.freezes = 0;
    if (typeof s.boxesOpened !== 'number') s.boxesOpened = 0;
    if (!s.passport || typeof s.passport !== 'object') s.passport = {};
    return s;
  }

  // One comparable "how much progress" number (score dominates, then time/streak).
  function progressOf(r) {
    const a = (r && r.allTime) || {};
    return (a.score || 0) * 1e7 + Math.min(9.9e6, (a.timeMs || 0) / 60 + (r.bestDayStreak || 0) * 1000);
  }

  // Fuse record b into a. Monotonic totals take the max (never roll back).
  // Spendable balances (gems/boxes/freezes) keep a's value when opts.keepBalances
  // is set (a = the live record being saved, so a purchase isn't undone), else
  // the max (when merging two distinct profiles, keep the richer balance).
  function mergeRec(a, b, opts) {
    a = normalize(a); b = normalize(b); opts = opts || {};
    const out = a;
    out.name = a.name || b.name;
    out.bestDayStreak = Math.max(a.bestDayStreak, b.bestDayStreak);
    out.lastScore = (a.savedAt >= b.savedAt) ? a.lastScore : b.lastScore;
    if (a.today.date === b.today.date) {
      out.today = {
        date: a.today.date,
        timeMs: Math.max(a.today.timeMs, b.today.timeMs),
        score: Math.max(a.today.score, b.today.score),
        bestScore: Math.max(a.today.bestScore, b.today.bestScore),
        bestStreak: Math.max(a.today.bestStreak, b.today.bestStreak),
      };
    } else {
      out.today = (a.today.date > b.today.date) ? a.today : b.today;
    }
    out.allTime = {
      timeMs: Math.max(a.allTime.timeMs, b.allTime.timeMs),
      score: Math.max(a.allTime.score, b.allTime.score),
      bestStreak: Math.max(a.allTime.bestStreak, b.allTime.bestStreak),
    };
    out.days = (a.days.length >= b.days.length) ? a.days : b.days;
    out.awardsEarned = Math.max(a.awardsEarned, b.awardsEarned);
    out.lastAwardAtMs = Math.max(a.lastAwardAtMs, b.lastAwardAtMs);
    out.boxesOpened = Math.max(a.boxesOpened, b.boxesOpened);
    const keep = opts.keepBalances;
    out.gems = keep ? a.gems : Math.max(a.gems, b.gems);
    out.boxes = keep ? a.boxes : Math.max(a.boxes, b.boxes);
    out.freezes = keep ? a.freezes : Math.max(a.freezes, b.freezes);
    const pp = Object.assign({}, a.passport);
    Object.keys(b.passport).forEach((k) => { pp[k] = Math.max(pp[k] || 0, b.passport[k]); });
    out.passport = pp;
    const od = out.today.date;
    out.seen = {
      streak: Math.max(a.seen.streak || 0, b.seen.streak || 0),
      timeAll: Math.max(a.seen.timeAll || 0, b.seen.timeAll || 0),
      timeTodayDate: od,
      timeToday: Math.max(
        a.seen.timeTodayDate === od ? (a.seen.timeToday || 0) : 0,
        b.seen.timeTodayDate === od ? (b.seen.timeToday || 0) : 0
      ),
    };
    out.savedAt = Math.max(a.savedAt, b.savedAt);
    return out;
  }

  // Read the profile map; on first run migrate the old single-blob stats.
  function readMap() {
    let m = null;
    try { m = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      m = {};
      let old = null;
      try { old = JSON.parse(localStorage.getItem(KEY_OLD)); } catch (e) {}
      if (old && typeof old === 'object') { const r = normalize(old); r.savedAt = r.savedAt || Date.now(); m[r.id] = r; }
    } else {
      Object.keys(m).forEach((id) => { m[id] = normalize(m[id]); m[id].id = id; });
    }
    return m;
  }

  // Collapse same-named records into one (richest wins, then fuse the rest in).
  function dedupe(m) {
    const groups = {};
    Object.keys(m).forEach((id) => { const k = normName(m[id].name); (groups[k] = groups[k] || []).push(m[id]); });
    const out = {};
    Object.keys(groups).forEach((k) => {
      const recs = groups[k];
      let canon = recs[0];
      for (let i = 1; i < recs.length; i++) if (progressOf(recs[i]) > progressOf(canon)) canon = recs[i];
      let merged = canon;
      recs.forEach((r) => { if (r !== canon) merged = mergeRec(merged, r); });
      merged.id = canon.id; merged.name = canon.name;
      out[canon.id] = merged;
    });
    return out;
  }

  function pickDefault(m) {
    let best = null;
    Object.keys(m).forEach((id) => { if (!best || progressOf(m[id]) > progressOf(m[best])) best = id; });
    return best;
  }

  // ---- module state: the profile map + the active record ------------------
  let map = dedupe(readMap());
  let activeId = localStorage.getItem(KEY_ACTIVE);
  if (!activeId || !map[activeId]) activeId = pickDefault(map); // default to the richest profile
  if (!activeId) { const r = blank(); r.savedAt = Date.now(); map[r.id] = r; activeId = r.id; }
  let stats = map[activeId];

  function saveAll() {
    try { localStorage.setItem(KEY, JSON.stringify(map)); localStorage.setItem(KEY_ACTIVE, activeId); } catch (e) {}
  }
  // Persist the active record, re-merging with whatever is on disk first so a
  // concurrent tab's progress is never overwritten (totals only move up).
  function save() {
    stats.savedAt = Date.now();
    let disk = null;
    try { disk = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (disk && typeof disk === 'object' && !Array.isArray(disk)) {
      if (disk[activeId]) { stats = mergeRec(stats, disk[activeId], { keepBalances: true }); stats.id = activeId; }
      // keep profiles other tabs added/advanced while we were playing
      Object.keys(disk).forEach((id) => { if (id !== activeId) map[id] = map[id] ? mergeRec(map[id], disk[id]) : normalize(disk[id]); });
    }
    map[activeId] = stats;
    saveAll();
  }

  // Re-read from disk (dedupe + keep the same player by name where possible).
  function reload() {
    const name = stats ? normName(stats.name) : null;
    map = dedupe(readMap());
    const byName = (name != null) ? Object.keys(map).find((k) => normName(map[k].name) === name) : null;
    activeId = byName || (map[activeId] ? activeId : pickDefault(map));
    if (!activeId) { const r = blank(); r.savedAt = Date.now(); map[r.id] = r; activeId = r.id; }
    stats = map[activeId];
    return stats;
  }

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

  saveAll();   // persist the deduped map before any rollDay save re-reads disk
  rollDay();

  const Stats = {
    SHOP,
    get() { return rollDay(); },
    refresh() { reload(); rollDay(); return stats; },

    // ---- local profiles ("which one is me?") -------------------------------
    activeId() { return activeId; },
    // Deduped list of local profiles, richest first, for the picker UI.
    listProfiles() {
      return Object.keys(map).map((id) => ({
        id, name: map[id].name || '', active: id === activeId,
        score: (map[id].allTime && map[id].allTime.score) || 0,
        timeMs: (map[id].allTime && map[id].allTime.timeMs) || 0,
        savedAt: map[id].savedAt || 0,
      })).sort((a, b) => (b.score - a.score) || (b.timeMs - a.timeMs) || (b.savedAt - a.savedAt));
    },
    // Make an existing profile active. Returns its record (or null).
    selectProfile(id) {
      if (!map[id] || id === activeId) return map[id] ? (rollDay(), stats) : null;
      save();                       // flush the current profile first
      activeId = id; stats = map[id]; rollDay(); saveAll();
      return stats;
    },
    // Select the profile with this name (case-insensitive), creating one if none
    // exists. This is how a name is chosen as "me".
    selectOrCreateByName(name) {
      const key = normName(name);
      const found = Object.keys(map).find((id) => normName(map[id].name) === key);
      if (found) return this.selectProfile(found);
      save();
      const r = blank(); r.name = (name == null ? '' : String(name)).trim().slice(0, 24); r.savedAt = Date.now();
      map[r.id] = r; activeId = r.id; stats = r; rollDay(); saveAll();
      return stats;
    },
    // Remove a profile; if it was active, fall back to the richest remaining one.
    deleteProfile(id) {
      if (!map[id]) return false;
      delete map[id];
      if (activeId === id) {
        activeId = pickDefault(map);
        if (!activeId) { const r = blank(); r.savedAt = Date.now(); map[r.id] = r; activeId = r.id; }
        stats = map[activeId]; rollDay();
      }
      saveAll();
      return true;
    },

    // ---- treasure economy: gems, boxes, streak freezes, passport -----------
    gems() { return stats.gems || 0; },
    boxes() { return stats.boxes || 0; },
    freezes() { return stats.freezes || 0; },
    addGems(n) { stats.gems = Math.max(0, (stats.gems || 0) + (n | 0)); save(); return stats.gems; },
    spendGems(n) { n = n | 0; if ((stats.gems || 0) < n) return false; stats.gems -= n; save(); return true; },
    // Bank a treasure box (cleared a treasure note).
    bankBox() { stats.boxes = (stats.boxes || 0) + 1; save(); return stats.boxes; },
    // Open one banked box → variable gem payout. Returns {gems, tier, remaining} or null.
    openBox() {
      if ((stats.boxes || 0) <= 0) return null;
      stats.boxes -= 1; stats.boxesOpened = (stats.boxesOpened || 0) + 1;
      const roll = rollBox();
      stats.gems = (stats.gems || 0) + roll.gems;
      save();
      return { gems: roll.gems, tier: roll.tier, remaining: stats.boxes };
    },
    // Buy a streak freeze with gems. Returns true on success.
    buyFreeze() { if (!this.spendGems(SHOP.freeze)) return false; stats.freezes = (stats.freezes || 0) + 1; save(); return true; },
    // Consume one streak freeze (to protect a missed day). Returns true if used.
    useFreeze() { if ((stats.freezes || 0) <= 0) return false; stats.freezes -= 1; save(); return true; },

    // Stamp a visited city into the passport. Returns {key, count, firstVisit}.
    stampCity(place) {
      const k = cityKey(place); if (!k) return null;
      const first = !stats.passport[k];
      stats.passport[k] = (stats.passport[k] || 0) + 1;
      save();
      return { key: k, count: stats.passport[k], firstVisit: first };
    },
    // Passport progress against a catalog of places (distinct City|Country).
    passportSummary(places) {
      const distinct = {}; (places || []).forEach((p) => { distinct[cityKey(p)] = p; });
      const keys = Object.keys(distinct);
      const got = keys.filter((k) => stats.passport[k]);
      const byCountry = {};
      keys.forEach((k) => { const c = distinct[k].country; (byCountry[c] = byCountry[c] || { got: 0, total: 0 }).total++; if (stats.passport[k]) byCountry[c].got++; });
      return { collected: got.length, total: keys.length, byCountry, has: (k) => !!stats.passport[k] };
    },

    setName(name) {
      name = (name == null ? '' : String(name)).trim().slice(0, 24);
      if (name === stats.name) return stats.name;
      // If another profile already owns this name, fuse this one into it so the
      // rename can never create a duplicate.
      const key = normName(name);
      const other = key && Object.keys(map).find((id) => id !== activeId && normName(map[id].name) === key);
      if (other) {
        map[other] = mergeRec(map[other], stats); map[other].name = name;
        delete map[activeId]; activeId = other; stats = map[other];
      } else {
        stats.name = name;
      }
      save();
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
