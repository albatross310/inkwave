// Fixtures for the MusicXML path.
//
// LICENSING + THESIS INTEGRITY. Every score here is HAND-AUTHORED for this test suite — scales and
// triads, written to exercise the parser. Nothing here is a real engraving, so:
//   - no in-copyright notation enters the repo (§B7's licensing discipline is not just about the
//     library browser — it is about what we commit), and
//   - none of Peter's own work reaches a fixture, a log, or a screenshot.
// `?music=demo` puts these on screen, LABELLED. That is exactly why they must stay synthetic.
//
// These are also the only scores in the repo whose expected parse is known by construction, which
// is what lets the parser be checked against something other than itself.

/** Four bars, C major, 4/4, one voice: an ascending scale. Bars printed 1-4, no pickup. */
export const SIMPLE_SCALE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Ascending Scale</work-title></work>
  <identification><creator type="composer">Inkwave Test Suite</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><sound tempo="60"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="4">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`

/**
 * SIMPLE_SCALE with BAR 3 CORRECTED — the same score after the student fixed a wrong note in
 * MuseScore and re-exported. Bar 3's first note is B4 in the original and B-FLAT 4 here (midi 71 →
 * 70); every other bar is byte-identical.
 *
 * This exists so §B6's claim ("fix the master and every excerpt updates") can be tested by actually
 * fixing a master and demanding the excerpt change. Written out in full rather than derived from
 * SIMPLE_SCALE by string replacement: a replacement that silently failed to match would make this
 * fixture EQUAL to the original, and a "does the excerpt update?" test would then be asserting
 * against an unchanged master — passing or failing for reasons having nothing to do with the code.
 * `fixtures.test.ts` additionally asserts the two differ, and differ ONLY in bar 3.
 */
export const SIMPLE_SCALE_FIXED = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Ascending Scale</work-title></work>
  <identification><creator type="composer">Inkwave Test Suite</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><sound tempo="60"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="4">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`

/**
 * A score that OPENS WITH A PICKUP, printed "0" and marked implicit — so printed bar N sits at
 * index N. This is the case where "bar number" and "position" genuinely disagree, which is why the
 * addressing model carries both.
 */
export const PICKUP_SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Pickup Study</work-title></work>
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">
    <measure number="0" implicit="yes">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="1">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`

/** A tie across a barline: C4 held from bar 1 into bar 2 — one sounding note of 8 quarter notes. */
export const TIED_SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Tie Study</work-title></work>
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`

/**
 * Two staves, chords and a <backup> — the piano case. Bar 1 has a C-major triad in the right hand
 * (one onset, three notes) over a C2 in the left, reached via <backup>.
 */
export const PIANO_SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Chord Study</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <staves>2</staves>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>4</duration><type>whole</type><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><rest/><duration>2</duration><type>half</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>half</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>whole</type><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

/**
 * A score whose SECOND BAR OPENS WITH A REST IN EVERY VOICE — so the bar's first sounding note is
 * genuinely later than the barline.
 *
 * This fixture exists because of a real miss. The rebase-to-the-bar behaviour ("an excerpt starting
 * on a rest keeps its silence") was first tested against PIANO_SCORE, whose bar 2 has a left-hand
 * note sitting exactly on the downbeat — so "rebase to the bar" and "rebase to the first note" gave
 * the SAME answer, and the test passed under both. A mutation proved it: swapping the implementation
 * for the wrong one changed nothing. The fixture, not the assertion, was the problem — a
 * known-negative identical to the right answer by construction (CLAUDE.md's recurring disease).
 *
 * Here the two answers differ by a full half note, so the test can fail.
 */
export const REST_START_SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Rest Start Study</work-title></work>
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><rest/><duration>2</duration><type>half</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`

/** A score whose tempo changes mid-piece — for the piecewise tempo map. */
export const TEMPO_CHANGE_SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Tempo Study</work-title></work>
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction placement="above"><direction-type><words>Andante</words></direction-type><sound tempo="60"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <direction placement="above"><direction-type><words>Allegro</words></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`
