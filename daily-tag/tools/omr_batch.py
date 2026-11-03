#!/usr/bin/env python3
"""OMR every sheet of the top-N four-part tags with homr (pip install homr).

  omr_batch.py --work work --top 1000 [--homr path/to/homr]

Writes <work>/sheets/<id>.musicxml. Sheets are fetched politely (one at a
time); PDFs are rasterised with pdftoppm, small GIFs upscaled with
ImageMagick so the staff lines are thick enough for the model.
"""
import argparse, glob, json, os, re, subprocess, time
import xml.etree.ElementTree as ET


def all_tags(work):
    tags, seen = [], set()
    for f in glob.glob(f'{work}/api/top*.xml'):
        s = open(f, 'rb').read().decode('utf-8', 'replace')
        s = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', s)
        for t in ET.fromstring(s.encode()).findall('tag'):
            d = {c.tag: (c.text or '').strip() for c in t}
            d['_types'] = {c.tag: c.get('type') for c in t if c.get('type')}
            if d['id'] not in seen:
                seen.add(d['id']); tags.append(d)
    tags.sort(key=lambda t: -int(t['Downloaded'] or 0))
    for i, t in enumerate(tags):
        t['rank'] = i + 1
    return tags


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    ap.add_argument('--top', type=int, default=1000)
    ap.add_argument('--homr', default='homr')
    ap.add_argument('--with-sheet-only', action='store_true',
                    help='also OMR tags that have no per-part learning tracks')
    a = ap.parse_args()
    out = f'{a.work}/sheets'
    os.makedirs(out, exist_ok=True)
    tracked = lambda t: all(t['_types'].get(p) == 'mp3' for p in ('Tenor', 'Lead', 'Bari', 'Bass'))
    tags = [t for t in all_tags(a.work)[:a.top] if t['Parts'] == '4' and t.get('SheetMusicAlt')
            and 'Female' not in t['Type'] and (a.with_sheet_only or tracked(t))]
    json.dump(tags, open(f'{a.work}/top_meta.json', 'w'))
    print(len(tags), 'four-part tags with sheet music', flush=True)
    def priority(t):
        """Sheets that can add a tag first, pure verification last."""
        if not all(t['_types'].get(p) == 'mp3' for p in ('Tenor', 'Lead', 'Bari', 'Bass')):
            return 0                                  # no learning tracks: OMR is the only source
        f = f'{a.work}/trans/{t["id"]}.json'
        if not os.path.exists(f):
            return 2                                  # audio not processed yet
        r = json.load(open(f))
        good = r.get('ok') and r['resid'] <= 0.12 and all(r[p]['agree'] >= 0.6 for p in ('Tenor', 'Lead', 'Bari', 'Bass'))
        return 3 if good else 1                       # failed audio → OMR may rescue it

    def todo():
        return [t for t in tags if not (os.path.exists(f'{out}/{t["id"]}.musicxml') or os.path.exists(f'{out}/{t["id"]}.failed'))]

    while True:
        pending = todo()
        if not pending:
            break
        t = min(pending, key=lambda t: (priority(t), t['rank']))
        base = f'{out}/{t["id"]}'
        url = t['SheetMusicAlt']
        ext = url.rsplit('.', 1)[-1].lower()
        src = f'{base}.{ext}'
        if not os.path.exists(src):
            subprocess.run(['curl', '-sS', '-m', '60', '--retry', '3', '-o', src, url])
            time.sleep(1)
        img = src
        try:
            if ext == 'pdf':
                subprocess.run(['pdftoppm', '-r', '200', '-png', '-f', '1', '-singlefile', src, base], check=True, timeout=120)
                img = base + '.png'
            elif ext == 'gif':
                subprocess.run(['convert', src, '-resize', '200%', base + '.png'], check=True, timeout=120)
                img = base + '.png'
            subprocess.run([a.homr, img], capture_output=True, timeout=900)
        except Exception as e:
            print('error', t['rank'], t['Title'], e, flush=True)
        if os.path.exists(base + '.musicxml'):
            print('ok', t['rank'], t['Title'], flush=True)
        else:
            open(base + '.failed', 'w').close()
            print('fail', t['rank'], t['Title'], flush=True)


if __name__ == '__main__':
    main()
