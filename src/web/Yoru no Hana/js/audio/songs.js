/**
 * The soundtrack. See music.js for the notation: chords drive the generated
 * bass / arpeggio / pad / drum parts, `mel` is the hand written melody (one
 * token per eighth note, eight per bar).
 *
 * Section options: lead (melody instrument), bass (oct8 root8 pump walk half
 * long), arp (up16 rise16 up8 updown8 koto sparse stab8 pulse8), arpInst,
 * pad (pad strings organ), drums (rock drive half taiko festival calm march
 * shuffle), crash, fill.
 */
export const SONGS = [
  {
    id: 'title',
    title: 'Yoru no Hana',
    comment: 'The title theme. A koto and a bamboo flute under the summer moon; it should feel like the last evening of the holidays.',
    bpm: 88,
    reverb: 0.4,
    sections: {
      I: { chords: 'Dm Bb C A', lead: 'bell', arp: 'koto', arpInst: 'koto', pad: 'pad',
        mel: 'd5 . a4 . f5 . e5 . | d5 . . . c5 . a4 . | g4 . c5 . e5 . g5 . | e5 - - - a4 - - -' },
      A: { chords: 'Dm Bb C Am Gm Bb A A', lead: 'flute', arp: 'koto', pad: 'pad', bass: 'long', drums: 'calm',
        mel: 'a4 - d5 e5 f5 - e5 d5 | f5 - - - g5 f5 e5 d5 | e5 - - - c5 - d5 e5 | a4 - - - - - . . |' +
          ' bb4 - d5 - g5 - f5 e5 | f5 - - - d5 - bb4 - | c#5 - e5 - a5 - g5 - | a5 - - - - - - -' },
      B: { chords: 'Bb C Am Dm Gm C F,A Dm', lead: 'flute', arp: 'up8', arpInst: 'piano', pad: 'strings', bass: 'half', drums: 'half',
        mel: 'd5 - f5 - bb5 - a5 g5 | g5 - - - e5 - c5 - | e5 - a5 - c6 - b5 a5 | a5 - - - f5 - d5 - |' +
          ' g5 - - f5 g5 - bb5 - | c6 - - - g5 - e5 - | f5 - e5 - c#5 - e5 - | d5 - - - - - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 's1',
    title: 'Paper Lanterns, Endless Fair',
    comment: 'Stage 1. The festival street of Tsukimachi, hours after it should have closed. Taiko and festival flutes that do not know when to stop.',
    bpm: 152,
    sections: {
      I: { chords: 'Em Em D D', arp: 'koto', drums: 'festival', bass: 'root8' },
      A: { chords: 'Em D C D Em D C,D Em', lead: 'lead', arp: 'koto', bass: 'oct8', drums: 'festival', crash: true,
        mel: 'e5 - g5 a5 b5 - a5 g5 | a5 - - g5 a5 - d6 - | b5 - a5 g5 e5 - g5 - | a5 - - - - - . . |' +
          ' e5 - g5 a5 b5 - d6 - | e6 - d6 b5 a5 - g5 - | a5 - g5 e5 d5 - e5 - | e5 - - - - - . .' },
      B: { chords: 'C D Bm Em C D B B', lead: 'flute', arp: 'up16', arpInst: 'koto', bass: 'oct8', drums: 'taiko', pad: 'strings',
        mel: 'g5 - - e5 g5 - a5 - | a5 - - f#5 a5 - b5 - | b5 - d6 - f#5 - b5 - | g5 - - - e5 - - - |' +
          ' c6 - b5 a5 g5 - a5 - | b5 - a5 g5 f#5 - d5 - | d#5 - f#5 - b5 - a5 - | b5 - - - - - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 'b1',
    title: 'Hozuki Market at Midnight',
    comment: 'Theme of Tomoe Hozuki. A cheerful tune for a girl who would happily keep the stalls open for a hundred years.',
    bpm: 160,
    sections: {
      I: { chords: 'Am Am', arp: 'up16', arpInst: 'koto', drums: 'rock', bass: 'oct8', crash: true },
      A: { chords: 'Am F G E Am F G E', lead: 'lead', arp: 'up16', bass: 'oct8', drums: 'rock', crash: true,
        mel: 'a5 - e5 a5 c6 - b5 a5 | a5 - - - f5 - a5 - | g5 - d5 g5 b5 - a5 g5 | g#5 - - - e5 - - - |' +
          ' a5 - e5 a5 c6 - d6 - | e6 - d6 c6 a5 - f5 - | g5 - b5 - d6 - b5 - | e6 - - - - - - -' },
      B: { chords: 'Dm E Am A7 Dm G C,F E', lead: 'brass', arp: 'stab8', arpInst: 'organ', bass: 'pump', drums: 'drive', pad: 'strings',
        mel: 'f5 - a5 - d6 - c6 - | b5 - g#5 - e5 - g#5 - | a5 - c6 - e6 - d6 c6 | c#6 - - - a5 - g5 - |' +
          ' f5 - a5 - d6 - f6 - | d6 - b5 - g5 - b5 - | c6 - e6 - f6 - a5 - | g#5 - - - b5 - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 's2',
    title: 'Moon on Still Water',
    comment: 'Stage 2. Lake Kagami holds a second moon that will not move. Glassy arpeggios rippling outward.',
    bpm: 132,
    reverb: 0.35,
    sections: {
      I: { chords: 'Bm G A F#m', arp: 'rise16', arpInst: 'bell', arpOct: 72, pad: 'pad' },
      A: { chords: 'Bm G A F#m Bm G Em F#', lead: 'flute', arp: 'rise16', arpInst: 'bell', arpOct: 72, bass: 'root8', drums: 'half', pad: 'pad',
        mel: 'f#5 - - - b5 - a5 - | g5 - - - d5 - e5 - | e5 - c#5 - a4 - c#5 e5 | f#5 - - - - - . . |' +
          ' f#5 - - - b5 - c#6 - | d6 - - - b5 - g5 - | e5 - g5 b5 e6 - d6 c#6 | c#6 - - - a#5 - - -' },
      B: { chords: 'G A F#m Bm Em A D,G F#', lead: 'lead', arp: 'up16', arpInst: 'koto', bass: 'oct8', drums: 'rock', pad: 'strings', crash: true,
        mel: 'b5 - a5 - g5 - d5 - | e5 - - - c#5 - e5 - | a5 - f#5 - c#5 - f#5 a5 | b5 - - - - - d6 - |' +
          ' e6 - d6 - b5 - g5 - | a5 - - - e5 - c#5 - | d5 - f#5 - g5 - b5 - | a#5 - - - - - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 'b2',
    title: 'The Lily That Never Closes',
    comment: 'Theme of Minamo Suiren. Half a lullaby, half a dance; the piano keeps nodding off and waking up again.',
    bpm: 148,
    sections: {
      I: { chords: 'Gm D', arp: 'up16', arpInst: 'piano', drums: 'half', bass: 'half' },
      A: { chords: 'Gm Eb Bb F Gm Eb Cm D', lead: 'piano', arp: 'up16', arpInst: 'koto', bass: 'oct8', drums: 'drive', pad: 'strings', crash: true,
        mel: 'd5 - g5 - a5 - bb5 a5 | g5 - - - eb5 - g5 - | f5 - d5 - bb4 - d5 f5 | a5 - - - - - . . |' +
          ' d5 - g5 - a5 - bb5 - | c6 - bb5 - g5 - eb5 - | eb5 - g5 - c6 - bb5 a5 | a5 - - - f#5 - - -' },
      B: { chords: 'Eb F D Gm Eb F D D', lead: 'lead', arp: 'up16', arpInst: 'bell', arpOct: 72, bass: 'oct8', drums: 'rock', pad: 'pad',
        mel: 'g5 - bb5 - eb6 - d6 c6 | c6 - - - a5 - f5 - | f#5 - a5 - d6 - c6 - | bb5 - - - g5 - - - |' +
          ' g5 - bb5 - eb6 - f6 - | f6 - eb6 - d6 - c6 - | d6 - c6 - a5 - f#5 - | d5/f#5 a5/d6 - - - - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 's3',
    title: 'Primrose Wind',
    comment: 'Stage 3. A meadow of evening primroses that opened at dusk and have been waiting ever since.',
    bpm: 140,
    sections: {
      I: { chords: 'D A Bm G', arp: 'up8', arpInst: 'koto', drums: 'shuffle', bass: 'root8' },
      A: { chords: 'D A Bm F#m G D Em A', lead: 'flute', arp: 'up8', arpInst: 'koto', bass: 'walk', drums: 'shuffle', pad: 'pad',
        mel: 'f#5 - a5 - d6 - c#6 b5 | a5 - - - e5 - a5 - | b5 - - a5 f#5 - d5 - | c#5 - - - - - . . |' +
          ' d5 - f#5 - g5 - b5 - | a5 - f#5 - d5 - f#5 - | g5 - - - e5 - b4 - | c#5 - e5 - a5 - - -' },
      B: { chords: 'G A F#m Bm G A D D', lead: 'lead', arp: 'koto', bass: 'oct8', drums: 'rock', pad: 'strings', crash: true,
        mel: 'b5 - - a5 g5 - d5 - | e5 - - - c#5 - a4 - | c#5 - f#5 - a5 - g#5 - | f#5 - - - d5 - - - |' +
          ' b5 - d6 - e6 - d6 b5 | c#6 - - - a5 - e5 - | f#5 - - e5 d5 - c#5 - | d5 - - - - - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 'b3',
    title: 'Amber Wings Toward the Light',
    comment: 'Theme of Kohaku Matsuyoi. Moths cannot help flying at a flame. Fast, warm and a little reckless.',
    bpm: 168,
    sections: {
      I: { chords: 'Fm C', arp: 'up16', arpInst: 'koto', drums: 'drive', bass: 'oct8', crash: true },
      A: { chords: 'Fm Db Eb C Fm Db Bbm C', lead: 'lead', arp: 'up16', arpInst: 'koto', bass: 'oct8', drums: 'drive', crash: true,
        mel: 'c5 - f5 - ab5 - g5 f5 | f5 - - - db5 - f5 - | g5 - eb5 - bb4 - eb5 g5 | e5 - - - - - . . |' +
          ' c5 - f5 - ab5 - c6 - | db6 - c6 - ab5 - f5 - | f5 - bb5 - db6 - c6 bb5 | c6 - - - e5 - g5 - ' },
      B: { chords: 'Db Eb Cm Fm Bbm C Db,Eb F', lead: 'brass', arp: 'stab8', arpInst: 'organ', bass: 'pump', drums: 'rock', pad: 'strings',
        mel: 'ab5 - db6 - f6 - eb6 db6 | eb6 - - - bb5 - g5 - | g5 - c6 - eb6 - d6 c6 | c6 - - - ab5 - f5 - |' +
          ' f5 - bb5 - db6 - f6 - | e6 - - - c6 - g5 - | f5 - ab5 - g5 - bb5 - | a5 - - - - - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 's4',
    title: 'Thousand Steps, Thousand Threads',
    comment: 'Stage 4. The old stone stairway up Mount Hoshigase, wrapped in silk. Written in the old miyako-bushi scale.',
    bpm: 136,
    reverb: 0.35,
    sections: {
      I: { chords: 'Em F Em F', arp: 'koto', arpInst: 'koto', drums: 'taiko', bass: 'long' },
      A: { chords: 'Am F G Em Am F Dm E', lead: 'flute', arp: 'koto', bass: 'root8', drums: 'taiko', pad: 'pad',
        mel: 'a5 - c6 - b5 - a5 - | f5 - - - a5 - c6 - | b5 - d6 - g6 - f6 e6 | e6 - - - - - . . |' +
          ' a5 - c6 - e6 - f6 - | f6 - e6 c6 a5 - c6 - | d6 - f6 - a6 - g6 f6 | e6 - - - g#5 - b5 -' },
      B: { chords: 'F E F E Dm Am F E', lead: 'lead', arp: 'up16', arpInst: 'koto', bass: 'oct8', drums: 'drive', pad: 'strings', crash: true,
        mel: 'c5 - f5 - a5 - g5 f5 | e5 - - - g#5 - b5 - | c6 - b5 - a5 - f5 - | e5 - - - b4 - e5 - |' +
          ' f5 - a5 - d6 - c6 - | c6 - b5 a5 e5 - c5 - | c5 - f5 - a5 - c6 - | b5 - - - - - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 'b4',
    title: 'Lace of the Snake Gourd',
    comment: 'Theme of Itoha Karasuuri. The snake gourd flower opens only at night, a white lace no one sees. Elegant and quietly dangerous.',
    bpm: 156,
    sections: {
      I: { chords: 'Cm G', arp: 'up16', arpInst: 'koto', drums: 'half', bass: 'half' },
      A: { chords: 'Cm Ab Fm G Cm Ab Fm,G Cm', lead: 'strings', arp: 'up16', arpInst: 'koto', bass: 'oct8', drums: 'drive', crash: true,
        mel: 'c5 - eb5 - g5 - f5 eb5 | eb5 - - - c5 - ab4 - | ab4 - c5 - f5 - eb5 d5 | d5 - - - b4 - - - |' +
          ' c5 - eb5 - g5 - c6 - | c6 - bb5 - ab5 - eb5 - | f5 - ab5 - g5 - b5 - | c6 - - - - - - -' },
      B: { chords: 'Ab Bb G Cm Fm Bb Eb,Ab G', lead: 'lead', arp: 'koto', arpInst: 'koto', bass: 'pump', drums: 'rock', pad: 'pad',
        mel: 'ab5 - c6 - eb6 - c6 ab5 | bb5 - - - f5 - d5 - | d5 - g5 - b5 - d6 - | c6 - - - g5 - eb5 - |' +
          ' f5 - ab5 - c6 - f6 - | d6 - - - bb5 - f5 - | g5 - bb5 - c6 - eb6 - | d6 - - - b5 - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 's5',
    title: 'Above the Sea of Clouds',
    comment: 'Stage 5. The observatory stands above the clouds, close enough to the stars to touch them, and the stars are not turning.',
    bpm: 144,
    reverb: 0.35,
    sections: {
      I: { chords: 'A E F#m D', arp: 'rise16', arpInst: 'bell', arpOct: 72, pad: 'pad', drums: 'half' },
      A: { chords: 'A E F#m C#m D A Bm E', lead: 'lead', arp: 'rise16', arpInst: 'bell', arpOct: 72, bass: 'oct8', drums: 'rock', pad: 'pad', crash: true,
        mel: 'e5 - a5 - c#6 - b5 a5 | g#5 - - - e5 - b4 - | c#5 - f#5 - a5 - g#5 f#5 | e5 - - - - - . . |' +
          ' d5 - f#5 - a5 - d6 - | c#6 - - - a5 - e5 - | d5 - f#5 - b5 - a5 f#5 | g#5 - - - b5 - - -' },
      B: { chords: 'D E C#m F#m Bm E A,F#m E', lead: 'brass', arp: 'up16', arpInst: 'koto', bass: 'oct8', drums: 'drive', pad: 'strings',
        mel: 'a5 - - f#5 a5 - d6 - | b5 - - g#5 b5 - e6 - | e6 - c#6 - g#5 - c#6 - | a5 - - - f#5 - - - |' +
          ' f#5 - b5 - d6 - f#6 - | e6 - d6 - b5 - g#5 - | a5 - c#6 - c#6 - a5 - | b5 - - - - - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 'b5',
    title: 'Armillary of the Stopped Sky',
    comment: 'Theme of Seira Yorugao. Brass rings turning inside rings: a scholar who did the arithmetic and did not like the answer.',
    bpm: 172,
    sections: {
      I: { chords: 'Bm F#', arp: 'up16', arpInst: 'bell', arpOct: 72, drums: 'drive', bass: 'oct8', crash: true },
      A: { chords: 'Bm G A F# Bm G Em F#', lead: 'lead', arp: 'up16', arpInst: 'koto', bass: 'oct8', drums: 'drive', crash: true,
        mel: 'b5 - f#5 b5 d6 - c#6 b5 | b5 - - - g5 - d5 - | c#5 - e5 - a5 - g5 f#5 | f#5 - - - a#5 - - - |' +
          ' b5 - f#5 b5 d6 - e6 - | d6 - b5 - g5 - b5 - | g5 - b5 - e6 - d6 c#6 | c#6 - - - f#5 - - -' },
      B: { chords: 'G A Bm Bm Em A F# F#', lead: 'brass', arp: 'rise16', arpInst: 'bell', arpOct: 72, bass: 'pump', drums: 'rock', pad: 'strings',
        mel: 'd6 - g5 - b5 - d6 - | e6 - a5 - c#6 - e6 - | f#6 - - - d6 - b5 - | f#5 - b5 - d6 - f#6 - |' +
          ' e6 - - - b5 - g5 - | a5 - c#6 - e6 - a6 - | f#6 - e6 - c#6 - a#5 - | f#6 - - - - - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 's6',
    title: 'Garden Beneath the Moon',
    comment: 'Stage 6. The summit garden where the night flower blooms once a year. Everything is white, and the moon is very close.',
    bpm: 128,
    reverb: 0.45,
    sections: {
      I: { chords: 'F#m D E C#m', arp: 'koto', arpInst: 'koto', pad: 'strings' },
      A: { chords: 'F#m D E C#m Bm D E E', lead: 'flute', arp: 'koto', bass: 'half', drums: 'calm', pad: 'strings',
        mel: 'c#5 - f#5 - g#5 - a5 g#5 | f#5 - - - d5 - a4 - | b4 - e5 - g#5 - f#5 e5 | e5 - - - - - . . |' +
          ' c#5 - f#5 - a5 - c#6 - | b5 - a5 - f#5 - d5 - | e5 - g#5 - b5 - a5 g#5 | g#5 - - - - - - -' },
      B: { chords: 'D E C#m F#m Bm C#m D,E F#m', lead: 'lead', arp: 'up16', arpInst: 'bell', arpOct: 72, bass: 'oct8', drums: 'half', pad: 'pad',
        mel: 'a5 - - f#5 d5 - f#5 - | g#5 - - e5 b4 - e5 - | e5 - g#5 - c#6 - b5 - | a5 - - - f#5 - - - |' +
          ' f#5 - b5 - d6 - c#6 b5 | c#6 - - - g#5 - e5 - | f#5 - a5 - g#5 - b5 - | a5 - - - - - - -' },
    },
    order: ['I', 'A', 'B'],
    loop: 1,
  },
  {
    id: 'b6',
    title: 'One Night, One Bloom',
    comment: 'Theme of Yoruka Gekka, the queen of the night flower. The fastest piece here, because she knows she has only until dawn.',
    bpm: 176,
    sections: {
      I: { chords: 'Dm Bb C A', arp: 'up16', arpInst: 'koto', pad: 'strings', drums: 'half', bass: 'half' },
      A: { chords: 'Dm Bb C A Dm Bb Gm A', lead: 'lead', arp: 'up16', arpInst: 'koto', bass: 'oct8', drums: 'drive', pad: 'strings', crash: true,
        mel: 'a5 - d6 - e6 - f6 e6 | d6 - - - bb5 - f5 - | g5 - c6 - e6 - d6 c6 | c#6 - - - - - . . |' +
          ' a5 - d6 - e6 - f6 - | g6 - f6 - d6 - bb5 - | bb5 - d6 - g6 - f6 e6 | e6 - - - c#6 - - -' },
      B: { chords: 'Bb C Am Dm Gm C F,A Dm', lead: 'brass', arp: 'rise16', arpInst: 'bell', arpOct: 72, bass: 'pump', drums: 'rock', pad: 'strings',
        mel: 'f6 - - d6 bb5 - d6 - | e6 - - c6 g5 - c6 - | c6 - e6 - a6 - g6 - | f6 - - - d6 - - - |' +
          ' d6 - g6 - f6 - d6 - | e6 - c6 - g5 - e6 - | f6 - e6 - c#6 - e6 - | d6 - - - - - - -' },
      C: { chords: 'Gm Dm Bb A Gm Dm Eb A', lead: 'flute', arp: 'koto', bass: 'half', drums: 'half', pad: 'pad',
        mel: 'g5 - - - a5 - bb5 - | a5 - - - f5 - d5 - | f5 - - - g5 - a5 - | e5 - - - c#5 - - - |' +
          ' g5 - - - a5 - bb5 - | d6 - - - c6 - a5 - | g5 - - - bb5 - eb6 - | e6 - - - - - - -' },
    },
    order: ['I', 'A', 'B', 'C'],
    loop: 1,
  },
  {
    id: 'ending',
    title: 'Dawn Over Tsukimachi',
    comment: 'The ending. The first morning in what felt like a very long time. Thank you for playing.',
    bpm: 84,
    reverb: 0.45,
    sections: {
      A: { chords: 'F C Dm Bb F C Bb C', lead: 'piano', arp: 'updown8', arpInst: 'koto', bass: 'long', pad: 'strings',
        mel: 'c5 - f5 - a5 - g5 f5 | e5 - - - c5 - - - | d5 - f5 - a5 - c6 - | bb5 - - - - - . . |' +
          ' a5 - - g5 f5 - c5 - | e5 - - d5 c5 - g5 - | f5 - d5 - bb4 - d5 - | e5 - - - g5 - - -' },
      B: { chords: 'Dm Am Bb F Gm Am Bb C', lead: 'flute', arp: 'updown8', arpInst: 'piano', bass: 'half', drums: 'calm', pad: 'pad',
        mel: 'a5 - - - d6 - c6 - | c6 - - - e5 - a5 - | bb5 - - a5 g5 - f5 - | f5 - - - c5 - - - |' +
          ' d5 - g5 - bb5 - d6 - | c6 - - - a5 - e5 - | f5 - g5 - a5 - bb5 - | c6 - - - - - - -' },
    },
    order: ['A', 'B'],
    loop: 0,
  },
];
