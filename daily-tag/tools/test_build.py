"""Self-test for build_tags helpers:  python3 tools/test_build.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import build_tags as B


def test_syllables_and_melisma():
    notes = [[57, 0.1, .3], [58, .4, .4], [60, .8, .3], [61, 1.2, .2], [62, 1.4, .6], [64, 2.1, .3], [65, 2.5, 2]]
    times = B.word_times('And I will wait for-ever', [['And', 0.0, .3], ['I', .35, .6], ['will', .7, .9], ['wait', 1.1, 1.3], ['forever', 2.0, 3]])
    syl = B.attach_syllables(notes, 'And I will wait for-ever', times)
    assert syl[:4] == ['And', 'I', 'will', 'wait'], syl
    assert syl[4] == '', syl                       # 'wait' held over the next note
    assert syl[5].endswith('-') and syl[6], syl    # for- ever


def test_no_words_means_no_syllables():
    assert B.attach_syllables([[60, 0, 1]], 'hello there', None) == [None]
    assert B.word_times('', [['x', 0, 1]]) is None


def test_rhythm_quantisation():
    assert B.quantise_beats(1.05) == 1 and B.quantise_beats(0.48) == 0.5 and B.quantise_beats(3.3) == 3
    parts = {p: [[60, i * 0.5, 0.45] for i in range(8)] + [[60, 4.0, 2.0]] for p in B.PARTS}
    B.add_rhythm(parts)
    beats = [n[3] for n in parts['Lead']]
    assert len(set(beats[:8])) == 1, beats         # steady notes get one value
    assert beats[-1] > beats[0], beats             # the held last note is longer


if __name__ == '__main__':
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            fn(); print('ok', name)
