/*
    sprites.js

    The Games module's sprite sheet, stored as pixel grids instead of a PNG so
    the art stays diff-able, scales to any size and needs no binary asset.

    Each sprite is { p: <palette>, rows: [ "...." ] } where every character in
    a row maps to a palette entry ('.' is always transparent). arcade.js turns
    a grid into an <svg> of merged <rect> runs, so a sprite can be dropped at
    any size with crisp edges.

    Naming: "ui/<id>" for interface glyphs and "art/<id>" for the decorative
    pieces. Game characters are not here -- those are pre-cropped PNGs under
    img/sprites/, sliced once from the sheet in img/sprite2.png.
*/

/* Shared colour keys used by most sprites. */
var PX_INK = {
    K: '#0b0716',   /* outline / hard shadow */
    W: '#ffffff',
    S: '#c8c2dd',   /* silver */
    y: '#ffc61a',   /* gold base */
    Y: '#ffe98a',   /* gold light */
    o: '#a77400',   /* gold dark */
    r: '#ff4152',
    R: '#ff8a95',
    q: '#b3202f',
    g: '#3fd16b',
    G: '#7dffa8',
    h: '#23884a',
    b: '#4da3ff',
    B: '#9bd0ff',
    d: '#2b6fc9',
    p: '#a76bff',
    P: '#d0b0ff',
    u: '#6a3fb5',
    c: '#33d6d6',
    n: '#ff8a3d',
    m: '#3a2f5c',
    M: '#584a85',
    e: '#241b42'
};

var AROZ_SPRITES = {










    /* --------------------------------------------------------- ui glyphs */

    'ui/back': {
        p: PX_INK,
        rows: [
            '........',
            '.....KK.',
            '....KK..',
            '...KK...',
            '..KK....',
            '...KK...',
            '....KK..',
            '.....KK.'
        ]
    },

    /* A reload arrow: an open circle with an arrowhead. */
    'ui/reset': {
        p: PX_INK,
        rows: [
            '..KKK.KK',
            '.K...KKK',
            'K.....KK',
            'K.......',
            'K.......',
            'K......K',
            '.K....K.',
            '..KKKK..'
        ]
    },

    /* A toothed gear with a hollow centre. */
    'ui/gear': {
        p: PX_INK,
        rows: [
            '.K.KK.K.',
            '.KKKKKK.',
            'KKK..KKK',
            'KK....KK',
            'KK....KK',
            'KKK..KKK',
            '.KKKKKK.',
            '.K.KK.K.'
        ]
    },

    /* A five point star. */
    'ui/star': {
        p: PX_INK,
        rows: [
            '....Y....',
            '...YYY...',
            '...YYY...',
            'YYYYYYYYY',
            '.YYYYYYY.',
            '..YYYYY..',
            '.YYY.YYY.',
            '.YY...YY.'
        ]
    },

    'ui/trophy': {
        p: PX_INK,
        rows: [
            'y.yyyyy.y',
            'y.yyyyy.y',
            'yyyyyyyyy',
            '.yyyyyyy.',
            '..yyyyy..',
            '...yyy...',
            '..yyyyy..',
            '.yyyyyyy.'
        ]
    },







    'ui/left': {
        p: PX_INK,
        rows: [
            '....KK..',
            '...KKK..',
            '..KKKK..',
            '.KKKKK..',
            '.KKKKK..',
            '..KKKK..',
            '...KKK..',
            '....KK..'
        ]
    },

    'ui/right': {
        p: PX_INK,
        rows: [
            '..KK....',
            '..KKK...',
            '..KKKK..',
            '..KKKKK.',
            '..KKKKK.',
            '..KKKK..',
            '..KKK...',
            '..KK....'
        ]
    },

    'ui/up': {
        p: PX_INK,
        rows: [
            '...KK...',
            '..KKKK..',
            '.KKKKKK.',
            'KKKKKKKK',
            '..KKKK..',
            '..KKKK..',
            '..KKKK..',
            '........'
        ]
    },

    'ui/fire': {
        p: PX_INK,
        rows: [
            '...KK...',
            '...KK...',
            '..KKKK..',
            '..KKKK..',
            '.KKKKKK.',
            '.K.KK.K.',
            'K..KK..K',
            '...KK...'
        ]
    },

    'ui/jump': {
        p: PX_INK,
        rows: [
            '...KK...',
            '..KKKK..',
            '.KKKKKK.',
            'KKKKKKKK',
            '...KK...',
            '...KK...',
            'KKKKKKKK',
            '........'
        ]
    },

    /* ------------------------------------------------------- decorations */

    /* The module's robot mascot, used as the header badge. */
    'art/robot': {
        p: PX_INK,
        rows: [
            '..y......y..',
            '..y......y..',
            '..yyyyyyyy..',
            '.yyyyyyyyyy.',
            '.yyyyyyyyyy.',
            '.yyKKyyKKyy.',
            '.yyKKyyKKyy.',
            '.yyyyyyyyyy.',
            '.yyyKKKKyyy.',
            '.yyyyyyyyyy.',
            '..yyyyyyyy..',
            '...y....y...'
        ]
    },

    'art/rocket': {
        p: PX_INK,
        rows: [
            '.....WW.....',
            '....WSSW....',
            '...WSbbSW...',
            '...WSbbSW...',
            '...WSSSSW...',
            '..WWSSSSWW..',
            '.rWWSSSSWWr.',
            'rrrWSSSSWrrr',
            '...r.nn.r...',
            '.....nn.....',
            '.....yy.....',
            '............'
        ]
    },

    'art/planet': {
        p: PX_INK,
        rows: [
            '....pppp....',
            '..pppppppp..',
            '.pppPPppppp.',
            '.ppPPPppppp.',
            'uuuuuuuuuuuu',
            'uuuuuuuuuuuu',
            '.ppppppPppp.',
            '.pppppPPPpp.',
            '..pppppppp..',
            '....pppp....',
            '............',
            '............'
        ]
    },

    'art/astronaut': {
        p: PX_INK,
        rows: [
            '...WWWW...',
            '..WKKKKW..',
            '..WKKKKW..',
            '...WWWW...',
            '.S.WWWW.S.',
            '.SWWWWWWS.',
            '.S.WWWW.S.',
            '...WWWW...',
            '...WW.WW..',
            '...WW.WW..'
        ]
    }
};
