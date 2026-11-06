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


def test_degenerate_sheet_does_not_match():
    audio = [60, 64, 62, 64, 62, 60, 59, 57, 60, 65]
    assert B.part_agreement(audio, [64]) == 0.0           # one repeated pitch
    assert B.part_agreement(audio, [60, 64]) < 0.7        # two notes found among ten
    assert B.part_agreement(audio, audio) == 1.0


def test_rhythm_quantisation():
    assert B.quantise_beats(1.05) == 1 and B.quantise_beats(0.48) == 0.5 and B.quantise_beats(3.3) == 3
    parts = {p: [[60, i * 0.5, 0.45] for i in range(8)] + [[60, 4.0, 2.0]] for p in B.PARTS}
    B.add_rhythm(parts)
    beats = [n[3] for n in parts['Lead']]
    assert len(set(beats[:8])) == 1, beats         # steady notes get one value
    assert beats[-1] > beats[0], beats             # the held last note is longer


def test_finale_mus_reader(tmp=None):
    """A synthetic legacy Finale file: four voices of three notes, one tied."""
    import struct, zlib, tempfile
    import finale_mus
    recs = b''
    ent = 1
    # voice k: three quarter notes, harmonic levels descending by voice
    for k, levels in enumerate([(2, 3, 4), (0, 1, 2), (-3, -2, -1), (-7, -6, -5)]):
        ids = list(range(ent, ent + 3))
        for j, lev in enumerate(levels):
            e = ids[j]
            prev = 0 if j == 0 else ids[j - 1]
            nxt = ids[j + 1] if j < 2 else 0
            rec = struct.pack('<IhIIhhhhhh', e, 0, prev, nxt, 1024, 0, 2048, 0xC000 - 0x10000, 128, 1)
            tie = 0x4000 if (k == 1 and j == 1) else 0
            alt = 1 if (k == 0 and j == 0) else 0
            rec += struct.pack('<hhH', lev * 16 + alt, 0, 0x8001 | tie) + b'\0' * 6
            assert len(rec) == 38
            recs += rec
        ent += 3
    z = zlib.compress(recs)
    data = b'ENIGMA BINARY FILE' + b'\0' * 100 + struct.pack('<HII', 0x16, len(z), 0) + z
    with tempfile.NamedTemporaryFile(suffix='.mus', delete=False) as fh:
        fh.write(data)
    parts = finale_mus.to_parts(fh.name, 'Major:C')
    assert [n[0] for n in parts['Lead']] == [60, 62, 64], parts['Lead']
    assert [n[0] for n in parts['Tenor']] == [65, 65, 67], parts['Tenor']        # E♯ = F, F, G
    assert [n[0] for n in parts['Bass']][0] < [n[0] for n in parts['Bari']][0]
    assert all(n[2] == 1.0 for n in parts['Lead'])


def test_musicxml_reader():
    """Two staves, two voices each, with lyrics, a tie, a rest and a barline."""
    import tempfile
    import score_parts
    def note(step, octv, voice, staff, dur=1, lyric=None, tie=False, rest=False):
        p = '<rest/>' if rest else f'<pitch><step>{step}</step><octave>{octv}</octave></pitch>'
        t = '<tie type="start"/>' if tie else ''
        ly = f'<lyric number="1"><syllabic>single</syllabic><text>{lyric}</text></lyric>' if lyric else ''
        return f'<note>{p}<duration>{dur}</duration>{t}<voice>{voice}</voice><staff>{staff}</staff>{ly}</note>'
    m1 = ('<attributes><divisions>1</divisions><key><fifths>0</fifths></key><staves>2</staves>'
          '<clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>'
          '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
          + note('E', 5, 1, 1) + note('G', 5, 1, 1) + '<backup><duration>2</duration></backup>'
          + note('C', 5, 2, 1, lyric='Hel-'.rstrip('-'), tie=True) + note('C', 5, 2, 1, lyric=None)
          + '<backup><duration>2</duration></backup>'
          + note('G', 3, 3, 2) + note('E', 3, 3, 2) + '<backup><duration>2</duration></backup>'
          + note('C', 3, 4, 2) + note('C', 3, 4, 2, rest=True))
    m2 = note('F', 5, 1, 1, 2) + '<backup><duration>2</duration></backup>' + note('C', 5, 2, 1, 2, lyric='lo') \
        + '<backup><duration>2</duration></backup>' + note('A', 3, 3, 2, 2) + '<backup><duration>2</duration></backup>' + note('F', 2, 4, 2, 2)
    xml = ('<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Quartet</part-name></score-part></part-list>'
           f'<part id="P1"><measure number="1">{m1}</measure><measure number="2">{m2}</measure></part></score-partwise>')
    with tempfile.NamedTemporaryFile('w', suffix='.xml', delete=False) as fh:
        fh.write(xml)
    parts, key = score_parts.to_parts(fh.name)
    lead = parts['Lead']
    assert [n[0] for n in lead] == [60, 60, 60], lead                 # treble-8: C5 written = C4 sung
    assert '~' in lead[0][4] and '|' in lead[2][4], lead
    assert [n[0] for n in parts['Tenor']] == [64, 67, 65]
    assert parts['Bass'][1][0] is None, parts['Bass']                 # the rest
    assert lead[0][3] == 'Hel' and lead[2][3] == 'lo'
    assert parts['Tenor'][0][3] == 'Hel', 'lyrics shared with parts that have none'


if __name__ == '__main__':
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            fn(); print('ok', name)
