#!/usr/bin/env python3
"""Find when each word is sung, per part, with speech recognition.

  align_lyrics.py --work work [--parts Lead,Bass,Tenor,Bari] [--wait]

For every transcribed tag (<work>/trans/<id>.json) the voices are
re-demixed (cheap) and faster-whisper (base.en, int8, CPU) transcribes
each part with word timestamps, primed with the tag's known lyrics.
Raw words land in <work>/words/<id>.json; build_tags.py aligns them to
the real lyric text and attaches syllables to notes.

Requirements: pip install faster-whisper
"""
import argparse, json, os, sys, time

import numpy as np
import librosa

sys.path.insert(0, os.path.dirname(__file__))
import extract_notes as X  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', default='work')
    ap.add_argument('--parts', default='Lead,Bass,Tenor,Bari')
    ap.add_argument('--model', default='base.en')
    ap.add_argument('--threads', type=int, default=1)
    ap.add_argument('--wait', action='store_true')
    a = ap.parse_args()
    from faster_whisper import WhisperModel
    model = WhisperModel(a.model, device='cpu', compute_type='int8', cpu_threads=a.threads)
    meta = {t['id']: t for t in json.load(open(f'{a.work}/meta.json'))}
    os.makedirs(f'{a.work}/words', exist_ok=True)
    parts = a.parts.split(',')
    while True:
        todo = []
        for f in sorted(os.listdir(f'{a.work}/trans')):
            tid = f[:-5]
            out = f'{a.work}/words/{tid}.json'
            done = json.load(open(out)) if os.path.exists(out) else {}
            if tid in meta and json.load(open(f'{a.work}/trans/{f}')).get('ok') and any(p not in done for p in parts):
                todo.append((meta[tid]['rank'], tid))
        if not todo:
            if not a.wait:
                break
            time.sleep(60); continue
        for _, tid in sorted(todo):
            t = meta[tid]
            out = f'{a.work}/words/{tid}.json'
            done = json.load(open(out)) if os.path.exists(out) else {}
            try:
                Y = {}
                for p in X.PARTS:
                    y, _ = librosa.load(f'{a.work}/audio/{tid}_{p}.mp3', sr=X.SR, mono=False)
                    Y[p] = y if y.ndim == 2 else np.vstack([y, y])
                n = min(y.shape[1] for y in Y.values())
                Y = {p: y[:, :n] for p, y in Y.items()}
                _, _, _, V = X.demix(Y)
                prompt = ' '.join((t.get('Lyrics') or '').split())[:400]
                for p in parts:
                    if p in done:
                        continue
                    v = V[X.PARTS.index(p)]
                    v16 = librosa.resample(v / (np.abs(v).max() + 1e-9), orig_sr=X.SR, target_sr=16000).astype('float32')
                    segs, _ = model.transcribe(v16, language='en', word_timestamps=True, initial_prompt=prompt or None,
                                               vad_filter=False, beam_size=1, condition_on_previous_text=False)
                    done[p] = [[w.word.strip(), round(float(w.start), 2), round(float(w.end), 2)] for s in segs for w in (s.words or [])]
                json.dump(done, open(out, 'w'))
                print(t['rank'], t['Title'], {p: len(done.get(p, [])) for p in parts}, flush=True)
            except Exception as e:
                print('error', tid, e, flush=True)
                json.dump({**done, **{p: [] for p in parts if p not in done}}, open(out, 'w'))
        if not a.wait:
            break


if __name__ == '__main__':
    main()
