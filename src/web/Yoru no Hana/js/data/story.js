/**
 * The story: prologue, boss dialogue for each heroine and stage, and the
 * endings. Dialogue lines: { who, text, music?, title? } - `music` starts
 * the boss theme on that line, `title` shows the boss's name card.
 */

export const PROLOGUE = [
  'Tsukimachi is a small lakeside town at the foot of Mount Hoshigase.',
  'On the night of the summer lantern festival, its people light lanterns for the spirits who come home to visit, and send them off again before dawn.',
  'On the summit, they say, a white flower blooms for that one night only, and its light shows the spirits the way back.',
  'This year the flower bloomed as always. The lanterns were lit as always. Midnight came and went...',
  '...and the night did not end.',
];

export const PROLOGUE_CHAR = {
  akari: 'At the Hinomiya lantern shop, an apprentice noticed that her candles had not burned down a finger\'s width in hours. She picked up her lantern and went out into the street.',
  shizuku: 'On the shore of Lake Kagami, a ferry keeper noticed that the moon in the water had not moved since midnight. She took her mirror and stepped off the pier.',
};

const A = 'akari';
const S = 'shizuku';

export const DIALOGUE = {
  akari: {
    1: {
      pre: [
        { who: A, text: 'Three hours past midnight and the drums are still going. The stalls ran out of grilled squid ages ago!' },
        { who: A, text: 'And my lanterns won\'t burn down. Grandpa\'s lantern is hanging there like the night just started.' },
        { who: 'tomoe', text: 'Ehehe! Isn\'t it wonderful? A fair that never, ever ends!', title: true, music: true },
        { who: A, text: 'You\'re the hozuki from the pot market. You\'ve got your husks lit up like a whole lantern shop.' },
        { who: 'tomoe', text: 'Every year the fair closes, everyone goes home and I go back in my pot. Not this year! This year it\'s forever!' },
        { who: A, text: 'Forever means the spirits never get to go home either. Including someone I\'d like to see off properly.' },
        { who: 'tomoe', text: 'Then stay and play with me instead! Lantern maker against lantern plant!' },
        { who: A, text: 'Fine. Last game of the night. And then the night ends.' },
      ],
      post: [
        { who: 'tomoe', text: 'Awww... my husks are all crumpled. The fair was so much fun...' },
        { who: A, text: 'It\'ll be fun next year too. That\'s the whole point of next year.' },
        { who: 'tomoe', text: 'Hmm. If you really want the night to end, go to the lake. All the lanterns float out that way, and none of them come back.' },
        { who: A, text: 'The lake, huh. Thanks, Tomoe. Save me a candied apple next summer.' },
      ],
    },
    2: {
      pre: [
        { who: A, text: 'The whole lake is covered in lanterns. They float out and just... stop, like they hit a wall.' },
        { who: A, text: 'And the moon in the water isn\'t even wobbling. Creepy.' },
        { who: 'minamo', text: 'Mm... who\'s splashing... it\'s so peaceful tonight...', title: true, music: true },
        { who: A, text: 'Oh, a flower girl. Sorry, did I wake you?' },
        { who: 'minamo', text: 'Night lilies wake when the sun goes down. And tonight the sun never comes up... so I never have to close.' },
        { who: A, text: 'You\'re all in on this, aren\'t you? Everyone likes the night a little too much.' },
        { who: 'minamo', text: 'Every dawn my petals fold up and I can\'t see the moon anymore. Is it so bad to want to look a little longer?' },
        { who: A, text: 'It is if my grandpa is stuck on the shore because of it. Open wide, lily. I\'m coming through!' },
      ],
      post: [
        { who: 'minamo', text: 'Ahh... you made such big waves... the koi are all upset...' },
        { who: A, text: 'Sorry. Which way do the lanterns go from here?' },
        { who: 'minamo', text: 'Over the far shore, into the primrose meadow. Something there keeps pulling them in... something that loves bright lights.' },
        { who: A, text: 'Bright lights. Okay. Go back to sleep, Minamo. In the morning, I mean.' },
      ],
    },
    3: {
      pre: [
        { who: A, text: 'Evening primroses everywhere, and moths all over them. And... hey! Those are my lanterns!' },
        { who: 'kohaku', text: 'M-mine! I found them! They were floating around and nobody was holding them!', title: true, music: true },
        { who: A, text: 'They\'re festival lanterns. They\'re supposed to float. Up, away, home. Not into a moth\'s nest!' },
        { who: 'kohaku', text: 'But they\'re so bright... the brightest things I\'ve ever seen... I just want to stay close to them.' },
        { who: A, text: 'I get it, lanterns are great. I make them. But these ones have places to be.' },
        { who: 'kohaku', text: 'If the night ends they\'ll go out... and I\'ll be back to waiting for dusk again. I don\'t want to wait anymore!' },
        { who: A, text: 'Then I\'ll make you a lantern of your own after this. But first, hands off!' },
      ],
      post: [
        { who: 'kohaku', text: 'Y-you\'ll really make me one? A small one is fine...' },
        { who: A, text: 'A big one. With moths painted on it. Now, who told you the night would last?' },
        { who: 'kohaku', text: 'Nobody told me... but the spider lady on the stone steps is weaving something huge. All her silk goes up the mountain, right at the moon.' },
        { who: A, text: 'A spider weaving toward the moon. This night keeps getting weirder.' },
      ],
    },
    4: {
      pre: [
        { who: A, text: 'A thousand stone steps up Mount Hoshigase, and every single one wrapped in silk.' },
        { who: A, text: 'There\'s a rope of it going straight up into the sky. Right at the moon.' },
        { who: 'itoha', text: 'Mind the threads, little lantern. They bite.', title: true, music: true },
        { who: A, text: 'You\'re the one tying up the moon? Untie it!' },
        { who: 'itoha', text: 'I don\'t tie, I weave. A client up the mountain wanted a net strong enough to hold the sky still, and paid well for it.' },
        { who: A, text: 'Who even asks for something like that?!' },
        { who: 'itoha', text: 'Desperate people, usually. I never ask what things are for. It\'s bad for business.' },
        { who: A, text: 'Well, I\'m asking. And I\'m cutting through.' },
        { who: 'itoha', text: 'Then let\'s see if a lantern burns silk faster than I can spin it.' },
      ],
      post: [
        { who: 'itoha', text: 'Hm. My lace is singed. Rude, but admirably direct.' },
        { who: A, text: 'Who\'s the client?' },
        { who: 'itoha', text: 'The stargazer at the Hoshimi Observatory, above the clouds. She hasn\'t slept since midsummer. Be gentle with her; she meant well.' },
        { who: A, text: 'Everyone up here means well. That\'s the whole problem.' },
      ],
    },
    5: {
      pre: [
        { who: A, text: 'Above the clouds... the stars are so close. And not one of them is moving.' },
        { who: 'seira', text: 'Please don\'t touch the armillary. It\'s very delicately reversed.', title: true, music: true },
        { who: A, text: 'You stopped the sky? You? You\'re a human!' },
        { who: 'seira', text: 'Someone had to. The night flower on the summit is old. I checked my figures three times: this is very likely her last bloom.' },
        { who: 'seira', text: 'When dawn comes she\'ll wilt, and this time she may not come back. So I asked the sky to wait.' },
        { who: A, text: 'And everyone else just has to wait too? The spirits, the festival, my grandpa?' },
        { who: 'seira', text: '...I know. I know what I\'ve done. I only wanted one more night for her.' },
        { who: A, text: 'Then you should have asked her what she wanted, not the sky!' },
      ],
      post: [
        { who: 'seira', text: 'The rings are slipping... the sky will start turning again soon.' },
        { who: A, text: 'Good. Where is she?' },
        { who: 'seira', text: 'The summit garden. Please... whatever happens, let her say goodbye properly.' },
        { who: A, text: 'That\'s the whole idea.' },
      ],
    },
    6: {
      pre: [
        { who: A, text: 'The summit. A whole garden of white flowers, and in the middle of it...' },
        { who: 'yoruka', text: 'Welcome, lantern child. It has been a very long night, hasn\'t it?', title: true },
        { who: A, text: 'You\'re the night flower. The one everybody\'s been protecting.' },
        { who: 'yoruka', text: 'I asked for one more night. Then one more. It is so hard to stop asking.' },
        { who: 'yoruka', text: 'I have bloomed since before your town was built, and I have never seen a morning. Each dawn I fall asleep and wake a year later, in the dark.' },
        { who: 'yoruka', text: 'This year I feel it in my roots. If I close tonight, I will not open again.' },
        { who: A, text: '...My grandpa said something like that, his last summer. He still lit the lanterns. He said a light that never goes out isn\'t a light, it\'s just a lamp.' },
        { who: 'yoruka', text: 'A wise man. But I am not ready to be wise.' },
        { who: A, text: 'Then I\'ll help you get ready. Bloom as bright as you like, and then let the morning come!', music: true },
        { who: 'yoruka', text: 'Then show me, little lantern. Show me a night worth ending.' },
      ],
      post: [
        { who: 'yoruka', text: 'Ah... the sky is turning. I can feel light at the edge of the world.' },
        { who: A, text: 'Does it hurt?' },
        { who: 'yoruka', text: 'No. It\'s warm. I never knew it would be warm.' },
      ],
    },
  },
  shizuku: {
    1: {
      pre: [
        { who: S, text: 'The festival street is still crowded. No one seems to notice that the moon has not moved since midnight.' },
        { who: S, text: 'My passengers are waiting at the shore, and the ferry cannot leave a lake that reflects a stopped sky.' },
        { who: 'tomoe', text: 'A ferry girl! At my fair! Do you want a goldfish? A mask? A hozuki?', title: true, music: true },
        { who: S, text: 'No, thank you. I would like the night to end, please.' },
        { who: 'tomoe', text: 'Eeh? That\'s the one thing I can\'t sell you! If the night ends, the fair ends!' },
        { who: S, text: 'Fairs end. That is why people come back to them.' },
        { who: 'tomoe', text: 'Boring! Play a game with me and maybe I\'ll think about it!' },
        { who: S, text: 'Very well. One game.' },
      ],
      post: [
        { who: 'tomoe', text: 'Waaah, you\'re scary for someone so quiet...' },
        { who: S, text: 'I apologise. Do you know who stopped the moon?' },
        { who: 'tomoe', text: 'Nope! But all the floating lanterns drift out over the lake. Ask the lily girl on the water. She sees everything that floats.' },
        { who: S, text: 'Thank you. Enjoy what is left of the fair.' },
      ],
    },
    2: {
      pre: [
        { who: S, text: 'Lake Kagami. My lake. The lanterns pile up in the middle like leaves in a drain.' },
        { who: 'minamo', text: 'Shizuku... you\'re out on the water late. Even for you.', title: true, music: true },
        { who: S, text: 'Minamo. You know why I am here.' },
        { who: 'minamo', text: 'The ferry can\'t cross while the moon is stuck. I know... but look how pretty the lilies are, all open at once.' },
        { who: S, text: 'They are beautiful. They are also meant to close.' },
        { who: 'minamo', text: 'You always say that. Everything is "meant to" with you.' },
        { who: S, text: 'Because my passengers cannot go home until it does. I am sorry, Minamo. I have to cross.' },
      ],
      post: [
        { who: 'minamo', text: 'Mmh... you always win when you\'re serious.' },
        { who: S, text: 'Where do the lanterns go?' },
        { who: 'minamo', text: 'Into the meadow past the far shore. Someone is gathering them there. Be careful... she gets excited around light.' },
        { who: S, text: 'Thank you. I will row you home at dawn.' },
      ],
    },
    3: {
      pre: [
        { who: S, text: 'So this is where the lanterns go. A meadow full of moths, circling them like a crown.' },
        { who: 'kohaku', text: 'D-don\'t take them! I collected them all by myself!', title: true, music: true },
        { who: S, text: 'Those lanterns belong to spirits waiting to go home. One of them is a little boy who has waited since before I was born.' },
        { who: 'kohaku', text: '...B-but it\'s so dark when they\'re gone...' },
        { who: S, text: 'The dark comes back every evening. So do the primroses. So do you.' },
        { who: 'kohaku', text: 'That\'s easy for you to say! You can see in the daytime!' },
        { who: S, text: 'That is fair. Then let us settle it the way spirits do.' },
      ],
      post: [
        { who: 'kohaku', text: 'Fine... take them... but they\'re really pretty, okay? Tell them that.' },
        { who: S, text: 'I will. Did someone ask you to keep them here?' },
        { who: 'kohaku', text: 'No... but the weaver on the cedar steps is spinning silk all the way up into the sky. I think she\'s tying something down.' },
        { who: S, text: 'Tying down the sky. That would explain the moon.' },
      ],
    },
    4: {
      pre: [
        { who: S, text: 'Silk across the steps, silk across the trees, and one long thread climbing all the way to the moon.' },
        { who: 'itoha', text: 'Ferry girl. You\'re a long way from your water.', title: true, music: true },
        { who: S, text: 'Someone has moored the moon. I believe you made the rope.' },
        { who: 'itoha', text: 'A net, technically. Snake gourd lace; it only shows itself at night, like all the best things.' },
        { who: S, text: 'Who asked you for it?' },
        { who: 'itoha', text: 'A client. Clients get discretion. If you want answers, you\'ll have to unpick them from me.' },
        { who: S, text: 'Then I will untie it one knot at a time.' },
      ],
      post: [
        { who: 'itoha', text: 'Neat work. You\'d make a decent weaver.' },
        { who: S, text: 'The client, please.' },
        { who: 'itoha', text: 'The astronomer at the observatory above the clouds. She has her reasons. Most of them are good ones.' },
        { who: S, text: 'I have noticed that about tonight.' },
      ],
    },
    5: {
      pre: [
        { who: S, text: 'An observatory above the clouds, and a sky as still as a painting.' },
        { who: 'seira', text: 'A ferry keeper. I wondered when someone from the lake would come.', title: true, music: true },
        { who: S, text: 'The spirits cannot cross. Please let the sky move.' },
        { who: 'seira', text: 'If it moves, dawn comes. If dawn comes, the night flower wilts, and she may never bloom again. I\'ve watched her every summer since I was six.' },
        { who: S, text: 'I understand. I have carried many people across the lake who did not want to go.' },
        { who: 'seira', text: 'Then you understand why I can\'t let go.' },
        { who: S, text: 'I understand that I cannot let you hold on. I am sorry.' },
      ],
      post: [
        { who: 'seira', text: '...The rings are turning again. You\'re stronger than you look.' },
        { who: S, text: 'Where is she?' },
        { who: 'seira', text: 'The summit garden, under the moon. Please be kind to her.' },
        { who: S, text: 'I always am, to those about to cross.' },
      ],
    },
    6: {
      pre: [
        { who: S, text: 'The summit garden. So many flowers, and every one of them facing the moon.' },
        { who: 'yoruka', text: 'The ferry keeper of Lake Kagami. Your grandmother came here once, a long time ago.', title: true },
        { who: S, text: 'She told me about you. She said you were the most beautiful thing on the mountain, and the saddest.' },
        { who: 'yoruka', text: 'I bloom for one night. Every year I watch the lanterns go home, and every year I stay behind.' },
        { who: 'yoruka', text: 'This time I asked the night to stay with me instead. Is that so terrible?' },
        { who: S, text: 'No. But my passengers are still waiting at the shore. A little boy. An old lantern maker. A woman who wants to see her daughter once more before she goes.' },
        { who: S, text: 'They cannot leave until you let go.' },
        { who: 'yoruka', text: '...You speak like someone who has carried many goodbyes.' },
        { who: S, text: 'I have. They are lighter than they look.', music: true },
        { who: 'yoruka', text: 'Then carry mine, ferry keeper, if you can lift it.' },
      ],
      post: [
        { who: 'yoruka', text: 'The moon is moving. The stars are turning again...' },
        { who: S, text: 'It is almost dawn.' },
        { who: 'yoruka', text: 'Will you row me across? Only to the middle of the lake. I would like to see the sunrise from the water.' },
        { who: S, text: 'It would be an honour.' },
      ],
    },
  },
};

export function dialogue(char, stage, key) {
  const c = DIALOGUE[char];
  return c && c[stage] && c[stage][key];
}

export const ENDINGS = {
  'akari/good': {
    no: 1,
    title: 'A Light That Goes Out',
    tint: '#ff9a5a',
    pages: [
      'The sky began to turn. Far below, the festival drums finally fell silent, and the lanterns rose from the lake, the meadow and the stone steps, drifting over the summit and on into the paling sky.',
      'Akari watched for one lantern in particular: lopsided, a little too red, with a crooked crane painted on its side. She had made it herself. It climbed higher than all the others, and then it was gone.',
      '"See you next summer, Grandpa."',
      'When the sun touched the summit, the night flower folded her petals with a sigh that sounded almost like laughter. Among her roots, Akari found a single new bud, green and tightly closed.',
      'The Hinomiya lantern shop opened late that morning. On the counter sat a flowerpot with a small green shoot, and beside it a brand new lantern with moths painted on it, waiting for someone who would come by at dusk.',
    ],
  },
  'akari/bad': {
    no: 2,
    title: 'Morning, Somehow',
    tint: '#9a8a7a',
    pages: [
      'The sky turned at last, but Akari never saw it. Somewhere on the summit path, between one step and the next, the long night caught up with her.',
      'She woke behind the counter of the lantern shop with the sun high and the festival long over. Her lanterns were gone. Every last one of them.',
      'Had she climbed the mountain at all? Had there really been a flower? She could not quite remember.',
      'Somewhere far above, a door had closed gently while she slept.',
    ],
    hint: 'Try to reach the summit without continuing.',
  },
  'shizuku/good': {
    no: 3,
    title: 'The Last Passenger of the Night',
    tint: '#7fc8ff',
    pages: [
      'The ferry slid out onto Lake Kagami just as the stars began to move. In the stern sat the queen of the night, her long petals trailing in the water.',
      'One by one the waiting spirits stepped aboard: a little boy with a paper windmill, an old man smelling of glue and lamp oil, a woman who held Shizuku\'s hand for far longer than she needed to.',
      'At the centre of the lake the sky turned pink, and the night flower watched her first sunrise with wide, astonished eyes. Then she was only petals on the water, drifting toward the far shore.',
      'On the bank, Seira was waiting with a notebook full of crossed-out figures and a small green bud wrapped in her scarf.',
      '"Next summer," said Shizuku. "We will both be here."',
    ],
  },
  'shizuku/bad': {
    no: 4,
    title: 'An Empty Crossing',
    tint: '#7a8a9a',
    pages: [
      'Dawn came, and Shizuku found herself in her own ferry, oars shipped, drifting alone in the middle of the lake.',
      'The waiting spirits were gone. Whether someone else had taken them across, she could not say.',
      'She rowed back to the shore in silence, unsure whether she had done her duty or simply slept through it.',
      'The lake reflected an ordinary morning sky, moving exactly as it should.',
    ],
    hint: 'Try to reach the summit without continuing.',
  },
};

export const CREDITS = [
  ['Yoru no Hana', '夜の花'],
  ['A bullet hell for ArozOS', ''],
  ['Characters', 'Akari · Shizuku · Tomoe · Minamo · Kohaku · Itoha · Seira · Yoruka'],
  ['© 2026', 'Released under the AGPL license'],
  ['', ''],
  ['Thank you for playing', 'See you next summer'],
];
