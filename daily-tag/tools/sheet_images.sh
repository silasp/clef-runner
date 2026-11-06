#!/bin/sh
# Pre-render PDF sheet music to small greyscale PNGs (sheets/<id>.png) so the
# review screen can show them inline (iOS can't show a PDF inside a page).
# Uses the first-page PNGs omr_batch.py made with pdftoppm.
#   tools/sheet_images.sh work
set -e
work=${1:-work}
dir=$(dirname "$0")/..
mkdir -p "$dir/sheets"
python3 -c "
import json,sys
for t in json.load(open('$dir/data/tags.json'))['tags']:
    if (t.get('sheet') or '').lower().endswith('.pdf'): print(t['id'])" | while read id; do
  [ -f "$work/sheets/$id.png" ] || continue
  convert "$work/sheets/$id.png" -trim +repage -resize '1100x>' -colorspace Gray -dither None -colors 8 -strip "PNG8:$dir/sheets/$id.png"
done
