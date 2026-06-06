/* auth.js — player profile, local high-scores/leaderboard, optional Google SSO.
   Works fully offline with a guest profile; Google sign-in activates only when a
   CLIENT_ID is configured AND the page is served over http(s). */
(function (App) {
  'use strict';

  const KEY_PROFILE = 'sr.profile';
  const KEY_SCORES = 'sr.scores';
  const KEY_BEST = 'sr.best';
  const listeners = [];
  let profile = null;
  let clientId = '';

  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  function emit() { listeners.forEach((cb) => cb(profile)); }

  function setProfile(p) { profile = p; save(KEY_PROFILE, p); emit(); }

  // decode the payload of a Google ID token (JWT) — client-side display only
  function decodeJwt(token) {
    try {
      const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) { return null; }
  }

  function bestKey(instKey, difficulty) { return instKey + ':' + difficulty; }

  const Auth = {
    init(googleClientId) {
      clientId = googleClientId || '';
      profile = load(KEY_PROFILE, null);
      const served = location.protocol === 'http:' || location.protocol === 'https:';
      this.googleAvailable = !!clientId && served;
      if (this.googleAvailable && window.google && google.accounts) {
        try {
          google.accounts.id.initialize({
            client_id: clientId,
            callback: (resp) => {
              const p = decodeJwt(resp.credential);
              if (p) setProfile({ name: p.name || p.email, picture: p.picture, sub: p.sub, google: true });
            },
          });
        } catch (e) { this.googleAvailable = false; }
      }
      emit();
    },

    renderGoogleButton(el) {
      if (!this.googleAvailable || !window.google) return false;
      try {
        google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with' });
        return true;
      } catch (e) { return false; }
    },

    signInGuest(name) {
      name = (name || '').trim() || 'Player';
      setProfile({ name, google: false });
    },

    signOut() {
      if (profile && profile.google && this.googleAvailable && window.google) {
        try { google.accounts.id.disableAutoSelect(); } catch (e) {}
      }
      setProfile(null);
    },

    getProfile() { return profile; },
    onChange(cb) { listeners.push(cb); },

    // ---- scores ----
    recordScore(entry) {
      const scores = load(KEY_SCORES, []);
      const row = Object.assign({
        name: profile ? profile.name : 'Player',
        picture: profile ? profile.picture : null,
        date: new Date().toISOString(),
      }, entry);
      scores.push(row);
      // keep last 200 to bound storage
      save(KEY_SCORES, scores.slice(-200));

      const best = load(KEY_BEST, {});
      const k = bestKey(entry.instrument, entry.difficulty);
      if (!best[k] || entry.score > best[k].score) {
        best[k] = { score: entry.score, bestStreak: entry.bestStreak, date: row.date };
        save(KEY_BEST, best);
        return { newBest: true };
      }
      return { newBest: false };
    },

    getBest(instKey, difficulty) {
      const best = load(KEY_BEST, {});
      return best[bestKey(instKey, difficulty)] || null;
    },

    // top N rows for an instrument (across difficulties), highest score first
    leaderboard(instKey, n) {
      const scores = load(KEY_SCORES, []);
      return scores
        .filter((s) => s.instrument === instKey)
        .sort((a, b) => b.score - a.score)
        .slice(0, n || 10);
    },
  };

  App.Auth = Auth;
})(window.App = window.App || {});
