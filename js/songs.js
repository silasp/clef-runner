/* songs.js — lazy, sharded song library (thesession.org corpus, ~54k tunes).
   Shards (js/data/<genre>.<n>.js) are loaded on demand via <script> injection
   (works offline + file://, unlike fetch) only when a genre is selected, so boot
   stays fast. Each shard pushes ["genre", <JSON string>] to App.SONG_RAW; the
   JSON is parsed lazily and tunes are kept as thin records ({name, source, _p,
   _d, _res}) — the per-note MIDI/duration arrays are expanded only when a tune
   is actually picked to play (see game._loadNextLick). */
(function (App) {
  'use strict';
  const decoded = {};   // genre -> [thin records]
  const loadingP = {};  // genre -> Promise
  const done = new Set(); // raw entries already consumed (by index)

  function inject(src) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  function consumeRaw(genre) {
    const raw = App.SONG_RAW || [];
    const out = decoded[genre] || (decoded[genre] = []);
    for (let i = 0; i < raw.length; i++) {
      if (done.has(i) || !raw[i] || raw[i][0] !== genre) continue;
      done.add(i);
      let obj; try { obj = JSON.parse(raw[i][1]); } catch (e) { continue; }
      raw[i] = null; // free the big raw JSON string; keep only thin records
      const res = obj.res || 4, types = obj.types, srcs = obj.srcs;
      for (const row of obj.t) {
        // new shards carry a `srcs` table (OpenEWLD/POP909/ADL); thesession shards
        // use a `types` table with the default trad. prefix.
        const source = srcs ? (srcs[row[3]] || 'song')
          : ('trad. · thesession.org · ' + ((types && types[row[3]]) || 'Tune'));
        out.push({ name: row[0], source: source, _p: row[1], _d: row[2], _res: res });
      }
    }
    return out;
  }

  function ensure(genre) {
    if (genre === 'all') return ensureAll();
    if (decoded[genre]) return Promise.resolve(decoded[genre]);
    if (loadingP[genre]) return loadingP[genre];
    const man = (App.SONG_MANIFEST || {})[genre] || [];
    if (!man.length) { decoded[genre] = []; return Promise.resolve(decoded[genre]); }
    loadingP[genre] = (async () => {
      for (const src of man) await inject(src);
      return consumeRaw(genre);
    })();
    return loadingP[genre];
  }

  function ensureAll() {
    const gs = Object.keys(App.SONG_MANIFEST || {});
    return Promise.all(gs.map(ensure)).then(() => {
      const all = [];
      gs.forEach((g) => { const d = decoded[g]; if (d) all.push.apply(all, d); });
      return all;
    });
  }

  App.Songs = {
    ensure,
    has: (g) => g === 'all' ? !!Object.keys(App.SONG_MANIFEST || {}).length : !!((App.SONG_MANIFEST || {})[g]),
    loaded: (g) => g === 'all' ? Object.keys(App.SONG_MANIFEST || {}).every((x) => decoded[x]) : !!decoded[g],
    pool: (g) => {
      if (g === 'all') { const a = []; Object.keys(App.SONG_MANIFEST || {}).forEach((x) => { if (decoded[x]) a.push.apply(a, decoded[x]); }); return a; }
      return decoded[g] || [];
    },
    count: (g) => App.Songs.pool(g).length,
  };
})(window.App = window.App || {});
