/* songs.js — lazy, sharded song library (thesession.org corpus, ~54k tunes).
   Shards (js/data/<genre>.<n>.js) are loaded on demand via <script> injection
   (works offline + file://, unlike fetch) only when a genre is selected, so boot
   stays fast. Each shard pushes ["genre", <JSON string>] to App.SONG_RAW; the
   JSON is parsed lazily and tunes are kept as thin records ({name, source, _p,
   _d, _res}) — the per-note MIDI/duration arrays are expanded only when a tune
   is actually picked to play (see game._loadNextLick).

   A subset of the shards carry NAMED artist transcriptions (Charlie Parker
   Omnibook, Stéphane Grappelli, Weimar Jazz DB solo phrases; see
   App.CURATED_SHARDS in manifest.js). As those shards are consumed, their
   records are also collected into a cross-genre `curatedPool` so the Library can
   browse and search them by artist — the bulk anonymous corpus stays out. */
(function (App) {
  'use strict';
  const decoded = {};       // genre -> [thin records]
  const curatedPool = [];   // named artist phrases, browsable in the Library
  const shardP = {};        // src path -> Promise<loaded?> (dedups injection)
  const injected = new Set(); // src paths successfully injected
  const done = new Set();   // App.SONG_RAW indices already consumed
  const curatedCbs = [];

  // Sources whose records are curated, named licks (worth browsing) rather than
  // part of the huge anonymous corpus, mapped to the artist/collection label
  // shown as their Library group.
  function curatedGroup(src) {
    src = src || '';
    if (/Omnibook/i.test(src)) return 'Charlie Parker';
    if (/Grappelli/i.test(src)) return 'Stéphane Grappelli';
    if (/Weimar/i.test(src)) return 'Weimar Jazz DB';
    return null;
  }

  function inject(src) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  // Inject a shard at most once, no matter how many genre/curated loads request
  // it (a shard can belong to both the genre corpus and the curated set).
  function injectOnce(src) {
    if (shardP[src]) return shardP[src];
    shardP[src] = inject(src).then((ok) => { if (ok) injected.add(src); return ok; });
    return shardP[src];
  }

  // Consume every not-yet-parsed App.SONG_RAW entry, routing each tune to its
  // genre bucket and — when its source is a named artist collection — into the
  // curated pool too. Runs synchronously, so concurrent loaders can't interleave.
  function consumePending() {
    const raw = App.SONG_RAW || [];
    let addedCurated = false;
    for (let i = 0; i < raw.length; i++) {
      if (done.has(i) || !raw[i]) continue;
      const genre = raw[i][0];
      done.add(i);
      let obj; try { obj = JSON.parse(raw[i][1]); } catch (e) { continue; }
      raw[i] = null; // free the big raw JSON string; keep only thin records
      const res = obj.res || 4, types = obj.types, srcs = obj.srcs;
      const bucket = decoded[genre] || (decoded[genre] = []);
      for (const row of obj.t) {
        // new shards carry a `srcs` table (OpenEWLD/POP909/ADL/artist); thesession
        // shards use a `types` table with the default trad. prefix.
        const source = srcs ? (srcs[row[3]] || 'song')
          : ('trad. · thesession.org · ' + ((types && types[row[3]]) || 'Tune'));
        const rec = { name: row[0], source: source, _p: row[1], _d: row[2], _res: res };
        bucket.push(rec);
        const group = curatedGroup(source);
        if (group) { rec._genre = genre; rec._group = group; curatedPool.push(rec); addedCurated = true; }
      }
    }
    if (addedCurated) curatedCbs.forEach((cb) => { try { cb(curatedPool); } catch (e) {} });
  }

  // Load a set of shard files (skipping any already loaded), then parse whatever
  // they pushed. Shared by genre loads and the curated load.
  function loadShards(list) {
    return Promise.all((list || []).map(injectOnce)).then(() => { consumePending(); });
  }

  function manLoaded(genre) {
    const man = (App.SONG_MANIFEST || {})[genre] || [];
    return man.length ? man.every((s) => injected.has(s)) : true;
  }

  function ensure(genre) {
    if (genre === 'all') return ensureAll();
    if (manLoaded(genre)) return Promise.resolve(decoded[genre] || (decoded[genre] = []));
    return loadShards((App.SONG_MANIFEST || {})[genre] || []).then(() => decoded[genre] || (decoded[genre] = []));
  }

  function ensureAll() {
    const gs = Object.keys(App.SONG_MANIFEST || {});
    const all = [];
    gs.forEach((g) => { (all).push.apply(all, (App.SONG_MANIFEST || {})[g] || []); });
    return loadShards(all).then(() => {
      const out = [];
      gs.forEach((g) => { const d = decoded[g]; if (d) out.push.apply(out, d); });
      return out;
    });
  }

  // Load just the curated artist shards and return their pooled records. Cheap
  // enough to trigger from the Library without pulling the whole corpus.
  function ensureCurated() {
    return loadShards(App.CURATED_SHARDS || []).then(() => curatedPool);
  }

  App.Songs = {
    ensure,
    ensureCurated,
    has: (g) => g === 'all' ? !!Object.keys(App.SONG_MANIFEST || {}).length : !!((App.SONG_MANIFEST || {})[g]),
    loaded: (g) => g === 'all' ? Object.keys(App.SONG_MANIFEST || {}).every((x) => manLoaded(x)) : manLoaded(g),
    curated: () => curatedPool,
    curatedLoaded: () => (App.CURATED_SHARDS || []).every((s) => injected.has(s)),
    onCurated: (cb) => curatedCbs.push(cb),
    pool: (g) => {
      if (g === 'all') { const a = []; Object.keys(App.SONG_MANIFEST || {}).forEach((x) => { if (decoded[x]) a.push.apply(a, decoded[x]); }); return a; }
      return decoded[g] || [];
    },
    count: (g) => App.Songs.pool(g).length,
  };
})(window.App = window.App || {});
