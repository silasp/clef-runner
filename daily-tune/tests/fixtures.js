// Small synthetic tunes for unit tests (no network, no real data needed).
export function fakeTag(id, base = 60, n = 8, extra = {}) {
  const mk = off => Array.from({ length: n }, (_, i) => [base + off + (i % 3) * 2, i * 0.6 + (i >= n / 2 ? 0.4 : 0), i === n / 2 - 1 ? 1.4 : 0.5]);
  return {
    id, title: `Tune ${id}`, genre: 'folk', style: 'Reel',
    parts: { Melody: mk(0) },
    ...extra,
  };
}
