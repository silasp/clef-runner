/* library.js — the browsable catalogue behind "Library" mode and the search /
   multiselect picker. Aggregates scale & arpeggio exercises (App.Scales),
   hand-curated named licks + folk tunes (App.Licks) and any imported files
   (App.Import) into one list of {id, name, group, kind, lick()} items. The game,
   given a list of selected ids, resolves them to lick objects and repeats them
   endlessly (transposing per phrase when random-key is on). */
(function (App) {
  'use strict';

  function items() {
    let out = App.Scales ? App.Scales.catalog() : [];
    if (App.Licks && App.Licks.catalog) out = out.concat(App.Licks.catalog());
    if (App.Import) out = out.concat(App.Import.files());
    return out;
  }

  function byId(id) {
    const all = items();
    for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  // Resolve a selected id to a playable lick object, or null if it's gone.
  function lick(id) { const it = byId(id); return it ? it.lick() : null; }

  // Case-insensitive search over an item's name, group and source (so licks are
  // findable by artist/collection too, e.g. "Parker" or "Grappelli"). Capped for
  // snappy rendering.
  function search(query, limit) {
    const all = items();
    const q = (query || '').trim().toLowerCase();
    const hit = q ? all.filter((it) =>
      it.name.toLowerCase().includes(q) ||
      it.group.toLowerCase().includes(q) ||
      (it.source && it.source.toLowerCase().includes(q))) : all;
    return limit ? hit.slice(0, limit) : hit;
  }

  App.Library = { items, byId, lick, search };
})(window.App = window.App || {});
