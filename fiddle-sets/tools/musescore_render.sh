#!/usr/bin/env bash
# Render a MusicXML file with MuseScore 3 (headless) to PNG pages, to check
# exactly what MuseScore users will see.  Usage: tools/musescore_render.sh file.musicxml outprefix
set -euo pipefail
export QT_QPA_PLATFORM=offscreen
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-$(mktemp -d)}"
chmod 700 "$XDG_RUNTIME_DIR"
mscore3 -o "$2.png" -r "${DPI:-90}" "$1" 2>&1 | grep -E "success|error" || true
