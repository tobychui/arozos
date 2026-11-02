/**
 * The How to Play pages: one entry per page, each a list of [term, text].
 */
export const MANUAL = [
  {
    title: 'Controls',
    lines: [
      ['Move', 'Arrow keys  (or W A S D)'],
      ['Shoot', 'Z  (or J / Space) - hold'],
      ['Focus', 'Shift  (or L) - slow movement, shows your hitbox'],
      ['Bomb', 'X  (or K)'],
      ['Pause', 'Esc  (or P)'],
      ['Skip dialogue', 'Hold Ctrl'],
      ['Debug menu', 'F3 - cheats, stage skips, a story viewer and unlocks. Runs that use cheats keep no score.'],
      ['Gamepad', 'D-pad / stick, A shoot, B bomb, X or RB focus, Start pause'],
      ['Touch', 'Drag anywhere on the playfield to move (she follows your finger\'s motion) - she fires while you touch. Buttons appear in the sidebar.'],
    ],
  },
  {
    title: 'The Basics',
    lines: [
      ['Hitbox', 'Only the small dot at the centre of your heroine can be hit. Focus to see it. Bullets that brush past her count as a Graze, worth score and point value.'],
      ['Power', 'Red P items raise power from 1.00 to 4.00. Each full point adds one option (lantern or mirror). Losing a life drops one point.'],
      ['Points', 'Blue 点 items are worth more the higher you catch them. Above the collection line near the top of the screen, every item flies to you at full value.'],
      ['Bombs', 'A bomb clears bullets and makes you invulnerable for a while. Bombing within a moment of being hit cancels the hit (a death-bomb).'],
      ['Pieces', 'Pink blossoms are life pieces, green leaves bomb pieces. Three of a kind make a whole one.'],
    ],
  },
  {
    title: 'Cards',
    lines: [
      ['Hanafuda cards', 'Bosses fight with named attacks called cards. When one is declared her portrait sweeps across the screen and its name appears in the corner.'],
      ['Capture', 'Clear a card without being hit or bombing to capture it and earn its bonus. The bonus shrinks as the timer runs down.'],
      ['Rewards', 'Every capture also gives a bomb piece; capturing a boss\'s last card gives a life piece.'],
      ['Card Practice', 'Every card you have seen can be replayed from the title menu with one life and no bombs.'],
      ['Endings', 'Each heroine has a good ending for clearing all six stages without continuing, and another for those who continued.'],
    ],
  },
];
