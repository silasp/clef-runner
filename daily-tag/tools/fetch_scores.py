#!/usr/bin/env python3
"""Download arrangers' score files (barbershoptags.com "Notation" field) for
the tags build_tags.py considers, and convert Finale .musx to MusicXML.

  fetch_scores.py --work work --top 1000

Writes <work>/notation/<id>.<ext> (mscz, xml, mxl, musx, mus, sib, nwc) and
<work>/mxl/<id>.mxl for .musx (needs `pip install musx2mxl`). Readable:
MuseScore 1–4 and MusicXML (score_parts.py), legacy Finale .mus
(finale_mus.py), .musx via musx2mxl. Sibelius and NoteWorthy aren't.
"""
import argparse, os, shutil, subprocess, time

import omr_batch

PARTS = ('Tenor', 'Lead', 'Bari', 'Bass')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    ap.add_argument('--top', type=int, default=1000)
    a = ap.parse_args()
    os.makedirs(f'{a.work}/notation', exist_ok=True)
    os.makedirs(f'{a.work}/mxl', exist_ok=True)
    tags = [t for t in omr_batch.all_tags(a.work)[:a.top]
            if t['Parts'] == '4' and 'Female' not in t['Type'] and t.get('NotationAlt')
            and all(t['_types'].get(p) == 'mp3' for p in PARTS)]
    conv = shutil.which('musx2mxl')
    for t in tags:
        url = t['NotationAlt']
        ext = url.rsplit('.', 1)[-1].lower()
        out = f'{a.work}/notation/{t["id"]}.{ext}'
        if not (os.path.exists(out) and os.path.getsize(out) > 0):
            subprocess.run(['curl', '-sS', '-L', '-m', '90', '--retry', '3', '-o', out, url])
            time.sleep(1)                                   # be polite
        mxl = f'{a.work}/mxl/{t["id"]}.mxl'
        if ext == 'musx' and conv and not os.path.exists(mxl):
            subprocess.run([conv, '--output_path', mxl, out], capture_output=True, timeout=300)
    print(len(tags), 'score files')


if __name__ == '__main__':
    main()
