#!/usr/bin/env python3
"""Assemble data/tags.json from barbershoptags.com metadata + transcriptions.

Inputs (produced by tools/extract_notes.py):
  --meta   JSON list of tag metadata records from the barbershoptags.com API
  --trans  directory of <id>.json transcription results
Output:
  data/tags.json

Only tags whose four parts were transcribed cleanly are kept, ordered by
popularity (download count), capped at --limit.
"""
import argparse, json, os, re, subprocess, time, urllib.parse

PARTS = ['Tenor', 'Lead', 'Bari', 'Bass']
RANGE = {'Tenor': (55, 84), 'Lead': (45, 76), 'Bari': (43, 74), 'Bass': (33, 67)}
SITE = 'https://www.barbershoptags.com/'


def clean_notes(notes, part):
    lo, hi = RANGE[part]
    out = [n for n in notes if n[2] >= 0.12 and lo <= n[0] <= hi]
    # merge identical neighbours separated by a tiny gap
    merged = []
    for n in out:
        if merged and merged[-1][0] == n[0] and n[1] - (merged[-1][1] + merged[-1][2]) < 0.07:
            merged[-1][2] = round(n[1] + n[2] - merged[-1][1], 2)
        else:
            merged.append(list(n))
    # trailing blips after the final held note (breath / release noise)
    while len(merged) > 3 and merged[-1][2] < 0.3 and merged[-2][2] >= 1.0:
        merged.pop()
    return merged


def slug(title):
    return re.sub(r'[^A-Za-z0-9]+', '-', title).strip('-')


def resolve_track(url, cache):
    """dbaction.php download links redirect to a static, range-seekable mp3."""
    if not url:
        return None
    if url in cache:
        return cache[url]
    direct = None
    for attempt in range(3):
        r = subprocess.run(['curl', '-sS', '-I', '-m', '30', url], capture_output=True, text=True)
        m = re.search(r'^location:\s*(\S+)', r.stdout, re.I | re.M)
        if m:
            loc = m.group(1)
            q = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)
            if 'f' in q:
                direct = SITE + urllib.parse.quote(q['f'][0])
            break
        time.sleep(2 * (attempt + 1))
    cache[url] = direct or url
    time.sleep(0.4)
    return cache[url]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--meta', required=True)
    ap.add_argument('--trans', required=True)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'data', 'tags.json'))
    ap.add_argument('--cache', default='track_cache.json')
    ap.add_argument('--limit', type=int, default=100)
    ap.add_argument('--min-acc', type=float, default=0.8)
    ap.add_argument('--min-coverage', type=float, default=0.4)
    a = ap.parse_args()

    meta = json.load(open(a.meta))
    meta.sort(key=lambda t: -int(t.get('Downloaded') or 0))
    cache = json.load(open(a.cache)) if os.path.exists(a.cache) else {}
    tags, rejected = [], []
    for t in meta:
        if len(tags) >= a.limit:
            break
        f = os.path.join(a.trans, f"{t['id']}.json")
        if not os.path.exists(f):
            continue
        tr = json.load(open(f))
        if not tr.get('ok'):
            continue
        parts, bad = {}, None
        for p in PARTS:
            if tr[p]['acc'] < a.min_acc:
                bad = f'{p} acc {tr[p]["acc"]}'
            parts[p] = clean_notes(tr[p]['notes'], p)
            if not 3 <= len(parts[p]) <= 90:
                bad = f'{p} has {len(parts[p])} notes'
        # every voice should sing through most of the tag (catches dropouts)
        if not bad and all(parts[p] for p in PARTS):
            t0 = min(parts[p][0][1] for p in PARTS)
            t1 = max(n[1] + n[2] for p in PARTS for n in parts[p])
            for p in PARTS:
                cov = sum(n[2] for n in parts[p]) / max(1e-6, t1 - t0)
                if cov < a.min_coverage:
                    bad = f'{p} coverage {cov:.2f}'
        if bad:
            rejected.append((t['Title'], bad))
            continue
        tracks = {p: resolve_track(t.get(p), cache) for p in PARTS}
        json.dump(cache, open(a.cache, 'w'), indent=0)
        sheet = t.get('SheetMusicAlt') or t.get('SheetMusic') or ''
        credit = ', '.join(x for x in [t.get('Quartet'), t.get('Teacher')] if x)
        tags.append({
            'id': int(t['id']),
            'title': t['Title'],
            'alt': t.get('AltTitle') or '',
            'version': t.get('Version') or '',
            'arranger': t.get('Arranger') or '',
            'writtenKey': t.get('WritKey') or '',
            'lyrics': re.sub(r'\s+\n', '\n', (t.get('Lyrics') or '').strip()),
            'downloads': int(t.get('Downloaded') or 0),
            'rating': round(float(t.get('Rating') or 0), 2),
            'page': f"{SITE}tag-{t['id']}-{slug(t['Title'])}",
            'sheet': sheet,
            'credit': credit,
            'tracks': tracks,
            'parts': parts,
        })
        print(len(tags), t['Title'], {p: len(parts[p]) for p in PARTS}, flush=True)
    out = {
        'source': 'barbershoptags.com API — metadata, lyrics and learning-track links; '
                  'notes auto-transcribed from the single-part learning tracks (pYIN).',
        'generated': time.strftime('%Y-%m-%d'),
        'tags': tags,
    }
    with open(a.out, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
    print('wrote', len(tags), 'tags; rejected', len(rejected))
    for r in rejected:
        print('  rejected', *r)


if __name__ == '__main__':
    main()
