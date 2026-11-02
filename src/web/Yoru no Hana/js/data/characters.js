/**
 * The cast: names, colours, the look the drawn fallback sprites use, and the
 * profiles shown in the Characters screen. `look` is also what the sprite
 * sheet prompt in README.md describes, so generated art and the fallbacks
 * agree on hair, eyes and clothes.
 */
export const CAST = {
  akari: {
    id: 'akari',
    name: 'Akari Hinomiya',
    jp: '灯宮 あかり',
    title: 'Apprentice Lantern Maker',
    color: '#ff5a3c',
    accent: '#ffc04a',
    look: {
      hair: '#c9361f', hairDark: '#7e1d12', eyes: '#ffa424', skin: '#ffe8da',
      dress: '#d8303a', dress2: '#fff4ea', obi: '#ff9b1c', style: 'bob', prop: 'lantern',
    },
    profile: [
      'Apprentice at the Hinomiya lantern shop on Tsukimachi\'s festival street, and the loudest person on it. Her late grandfather made the shop\'s lanterns for fifty years; she makes them now, a little crooked.',
      'Every summer she hangs one lantern for him so his spirit can find the way home and back again. Tonight the lanterns will not go out and the spirits cannot leave, and she has decided that is a personal insult.',
      'Fights with the paper lanterns she makes herself. They home in on whatever she is angry at.',
    ],
  },
  shizuku: {
    id: 'shizuku',
    name: 'Shizuku Mikagami',
    jp: '水鏡 しずく',
    title: 'Ferry Keeper of the Mirror Lake',
    color: '#4fb8ff',
    accent: '#d8f2ff',
    look: {
      hair: '#b9cce8', hairDark: '#7088b0', eyes: '#7fd0ff', skin: '#fff0ea',
      dress: '#283a86', dress2: '#f4f7ff', obi: '#7fc8ff', style: 'long', prop: 'mirror',
    },
    profile: [
      'The quiet girl who rows the old ferry across Lake Kagami. Her family has kept the crossing for generations, and on festival nights her boat carries more than living passengers.',
      'She noticed the problem before anyone else: the moon in the lake has not moved for hours, and the spirits waiting on the shore cannot cross a lake whose reflection is stuck.',
      'Polite, precise, hard to rattle. Her bronze hand mirror throws moonlight as needles of water.',
    ],
  },
  tomoe: {
    id: 'tomoe',
    name: 'Tomoe Hozuki',
    jp: '鬼灯 ともえ',
    title: 'Lantern Plant of the Endless Fair',
    color: '#ff8a1a',
    accent: '#ffd04a',
    look: {
      hair: '#ff8a2a', hairDark: '#b85212', eyes: '#ffcf3a', skin: '#ffeede',
      dress: '#ff7a1a', dress2: '#2a1610', obi: '#2a1610', style: 'buns', prop: 'husks',
    },
    profile: [
      'The spirit of a pot of hozuki, the lantern plant sold at summer fairs, whose papery orange husks glow like little lanterns. She has haunted Tsukimachi\'s festival for as long as there has been one.',
      'An endless night means an endless fair, and an endless fair is the best thing that has ever happened to her. She sees no problem at all.',
    ],
  },
  minamo: {
    id: 'minamo',
    name: 'Minamo Suiren',
    jp: '睡蓮 みなも',
    title: 'Dreaming Lily of Lake Kagami',
    color: '#ff7ac4',
    accent: '#5fe0d8',
    look: {
      hair: '#ffc6dc', hairDark: '#e07aa6', eyes: '#3fd0c4', skin: '#fff2ee',
      dress: '#2fb8a8', dress2: '#ffffff', obi: '#ff7ac4', style: 'wavy', prop: 'lily',
    },
    profile: [
      'A water lily spirit who shares the lake with the old koi. Night lilies open in the evening and close at sunrise, and she has always found the closing part rather sad.',
      'Sleepy, dreamy and much stronger than she looks. Tonight her lilies never have to close, and she would like to keep it that way.',
    ],
  },
  kohaku: {
    id: 'kohaku',
    name: 'Kohaku Matsuyoi',
    jp: '待宵 こはく',
    title: 'Amber Moth Who Waits for Dusk',
    color: '#ffc23a',
    accent: '#a0602a',
    look: {
      hair: '#ffd27a', hairDark: '#c08a3a', eyes: '#ffb21a', skin: '#fff0de',
      dress: '#f4e2c0', dress2: '#a8642a', obi: '#ffd23a', style: 'fluffy', prop: 'wings',
    },
    profile: [
      'A hawk moth who lives among the evening primroses of Matsuyoi Meadow. The primroses open at dusk for the moths, and the moths come for them; it is an old arrangement.',
      'Shy until she is not. The floating festival lanterns are the brightest lights she has ever seen, and she has been collecting them, one by one, all night.',
    ],
  },
  itoha: {
    id: 'itoha',
    name: 'Itoha Karasuuri',
    jp: '烏瓜 いとは',
    title: 'Lace Weaver of the Cedar Steps',
    color: '#b070ff',
    accent: '#ffffff',
    look: {
      hair: '#2a1a3a', hairDark: '#140a1e', eyes: '#c080ff', skin: '#fbefee',
      dress: '#3a2050', dress2: '#ffffff', obi: '#ff5a2a', style: 'updo', prop: 'threads',
    },
    profile: [
      'A jorogumo weaver living on the thousand stone steps up Mount Hoshigase. She loves the snake gourd, whose white lace flowers open only in the dark and are gone by morning.',
      'Elegant, unhurried, and not easily surprised. Someone at the summit asked her for a very large net and a very strong thread, and she does not ask clients what things are for.',
    ],
  },
  seira: {
    id: 'seira',
    name: 'Seira Yorugao',
    jp: '夜顔 せいら',
    title: 'Stargazer Who Stilled the Sky',
    color: '#5a8cff',
    accent: '#ffd76a',
    look: {
      hair: '#26346e', hairDark: '#141c44', eyes: '#3a6cff', skin: '#fff0e4',
      dress: '#1c2858', dress2: '#ffffff', obi: '#ffd76a', style: 'braid', prop: 'armillary',
    },
    profile: [
      'A human astronomer who keeps the old Hoshimi Observatory above the clouds. She has watched the night flower bloom on the summit every summer since she was a child.',
      'She did the arithmetic: the flower is old, and this bloom may be its last. So she turned her armillary sphere backwards and stopped the sky. She knows it cannot last. She did it anyway.',
    ],
  },
  yoruka: {
    id: 'yoruka',
    name: 'Yoruka Gekka',
    jp: '月下 夜華',
    title: 'Queen of the One Night Bloom',
    color: '#f2f0ff',
    accent: '#a8ffcf',
    look: {
      hair: '#f6f4ff', hairDark: '#d8c890', eyes: '#ffe28a', skin: '#fff6f2',
      dress: '#fbfaff', dress2: '#bff0c8', obi: '#ffb0c8', style: 'flowing', prop: 'crescent',
    },
    profile: [
      'The spirit of the night flower, the queen of the night, that blooms on the summit of Mount Hoshigase for a single night each summer. Its light guides the festival spirits home before dawn.',
      'She has bloomed and wilted more times than anyone can count, and she has never once seen the morning. This year she is afraid it is her last bloom, and she has asked the night not to end.',
    ],
  },
};

// `sub` is the secondary name line under `name`: the Japanese name while
// the game is in English, the romanised name once a translation renames the
// cast (data/locale.js). The drawn fallback portraits always use `jp`.
for (const c of Object.values(CAST)) c.sub = c.jp;

export const PLAYERS = ['akari', 'shizuku'];
export const BOSSES = ['tomoe', 'minamo', 'kohaku', 'itoha', 'seira', 'yoruka'];
/** Order of the characters in the sprite sheet (portraits row by row, then chibis). */
export const SHEET_ORDER = ['akari', 'shizuku', 'tomoe', 'minamo', 'kohaku', 'itoha', 'seira', 'yoruka'];

/**
 * Difficulties. Besides d() in the stage scripts, each one tunes the whole
 * run: bulletSpeed scales how far enemy bullets travel per frame (shapes
 * stay the same, they just open more slowly), bossHp scales boss health,
 * extraLives is added to the Starting Lives setting, bombs is the stock
 * after every life, deathBomb the frames a hit can still be cancelled.
 */
export const DIFFICULTIES = [
  { id: 'easy', name: 'Bud', jp: '蕾', desc: 'For first steps into the night. Slower, sparser bullets, an extra life and more bombs.', bulletSpeed: 0.78, bossHp: 0.75, extraLives: 1, bombs: 4, deathBomb: 18 },
  { id: 'normal', name: 'Bloom', jp: '花', desc: 'The festival as it was meant to be played.', bulletSpeed: 1, bossHp: 1, extraLives: 0, bombs: 3, deathBomb: 9 },
  { id: 'hard', name: 'Full Bloom', jp: '満開', desc: 'For those who have seen the dawn once already.', bulletSpeed: 1, bossHp: 1, extraLives: 0, bombs: 3, deathBomb: 9 },
  { id: 'lunatic', name: 'Midnight', jp: '真夜中', desc: 'The night at its deepest. Not recommended for anyone.', bulletSpeed: 1, bossHp: 1, extraLives: 0, bombs: 3, deathBomb: 9 },
];
