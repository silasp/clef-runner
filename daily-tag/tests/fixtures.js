// Small synthetic tags for unit tests (no network, no real data needed).
export function fakeTag(id, base = 60, n = 8, extra = {}) {
  const mk = off => Array.from({ length: n }, (_, i) => [base + off + (i % 3) * 2, i * 0.6 + (i >= n / 2 ? 0.4 : 0), i === n / 2 - 1 ? 1.4 : 0.5]);
  return {
    id, title: `Tag ${id}`, lyrics: 'oh how I love to sing a tag with you tonight', arranger: 'Test',
    parts: { Tenor: mk(7), Lead: mk(0), Bari: mk(-5), Bass: mk(-12) },
    tracks: { Tenor: 'https://example.org/t.mp3', Lead: 'https://example.org/l.mp3', Bari: 'https://example.org/b.mp3', Bass: 'https://example.org/bs.mp3' },
    ...extra,
  };
}
