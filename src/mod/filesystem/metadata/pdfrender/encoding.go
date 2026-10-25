package pdfrender

import (
	"strconv"
	"strings"

	"golang.org/x/text/encoding/charmap"
)

/*
	encoding.go

	Glyph names and the standard simple font encodings: StandardEncoding,
	WinAnsiEncoding, MacRomanEncoding and the built-in Symbol encoding,
	the glyph name to Unicode map they need (a subset of the Adobe Glyph
	List covering Latin, Greek and the usual symbols), the CFF standard
	strings and the Macintosh glyph order used by TrueType 'post' tables.
*/

// glyphUnicode lists glyph names with their Unicode value. The first name
// listed for a code point is its preferred name.
var glyphUnicode = []struct {
	name string
	r    rune
}{
	{"space", 0x20}, {"exclam", 0x21}, {"quotedbl", 0x22}, {"numbersign", 0x23}, {"dollar", 0x24},
	{"percent", 0x25}, {"ampersand", 0x26}, {"quotesingle", 0x27}, {"parenleft", 0x28}, {"parenright", 0x29},
	{"asterisk", 0x2A}, {"plus", 0x2B}, {"comma", 0x2C}, {"hyphen", 0x2D}, {"period", 0x2E}, {"slash", 0x2F},
	{"zero", 0x30}, {"one", 0x31}, {"two", 0x32}, {"three", 0x33}, {"four", 0x34}, {"five", 0x35},
	{"six", 0x36}, {"seven", 0x37}, {"eight", 0x38}, {"nine", 0x39}, {"colon", 0x3A}, {"semicolon", 0x3B},
	{"less", 0x3C}, {"equal", 0x3D}, {"greater", 0x3E}, {"question", 0x3F}, {"at", 0x40},
	{"bracketleft", 0x5B}, {"backslash", 0x5C}, {"bracketright", 0x5D}, {"asciicircum", 0x5E},
	{"underscore", 0x5F}, {"grave", 0x60}, {"braceleft", 0x7B}, {"bar", 0x7C}, {"braceright", 0x7D},
	{"asciitilde", 0x7E}, {"nbspace", 0xA0}, {"exclamdown", 0xA1}, {"cent", 0xA2}, {"sterling", 0xA3},
	{"currency", 0xA4}, {"yen", 0xA5}, {"brokenbar", 0xA6}, {"section", 0xA7}, {"dieresis", 0xA8},
	{"copyright", 0xA9}, {"ordfeminine", 0xAA}, {"guillemotleft", 0xAB}, {"logicalnot", 0xAC},
	{"sfthyphen", 0xAD}, {"registered", 0xAE}, {"macron", 0xAF}, {"degree", 0xB0}, {"plusminus", 0xB1},
	{"twosuperior", 0xB2}, {"threesuperior", 0xB3}, {"acute", 0xB4}, {"mu", 0xB5}, {"paragraph", 0xB6},
	{"periodcentered", 0xB7}, {"cedilla", 0xB8}, {"onesuperior", 0xB9}, {"ordmasculine", 0xBA},
	{"guillemotright", 0xBB}, {"onequarter", 0xBC}, {"onehalf", 0xBD}, {"threequarters", 0xBE},
	{"questiondown", 0xBF}, {"Agrave", 0xC0}, {"Aacute", 0xC1}, {"Acircumflex", 0xC2}, {"Atilde", 0xC3},
	{"Adieresis", 0xC4}, {"Aring", 0xC5}, {"AE", 0xC6}, {"Ccedilla", 0xC7}, {"Egrave", 0xC8},
	{"Eacute", 0xC9}, {"Ecircumflex", 0xCA}, {"Edieresis", 0xCB}, {"Igrave", 0xCC}, {"Iacute", 0xCD},
	{"Icircumflex", 0xCE}, {"Idieresis", 0xCF}, {"Eth", 0xD0}, {"Ntilde", 0xD1}, {"Ograve", 0xD2},
	{"Oacute", 0xD3}, {"Ocircumflex", 0xD4}, {"Otilde", 0xD5}, {"Odieresis", 0xD6}, {"multiply", 0xD7},
	{"Oslash", 0xD8}, {"Ugrave", 0xD9}, {"Uacute", 0xDA}, {"Ucircumflex", 0xDB}, {"Udieresis", 0xDC},
	{"Yacute", 0xDD}, {"Thorn", 0xDE}, {"germandbls", 0xDF}, {"agrave", 0xE0}, {"aacute", 0xE1},
	{"acircumflex", 0xE2}, {"atilde", 0xE3}, {"adieresis", 0xE4}, {"aring", 0xE5}, {"ae", 0xE6},
	{"ccedilla", 0xE7}, {"egrave", 0xE8}, {"eacute", 0xE9}, {"ecircumflex", 0xEA}, {"edieresis", 0xEB},
	{"igrave", 0xEC}, {"iacute", 0xED}, {"icircumflex", 0xEE}, {"idieresis", 0xEF}, {"eth", 0xF0},
	{"ntilde", 0xF1}, {"ograve", 0xF2}, {"oacute", 0xF3}, {"ocircumflex", 0xF4}, {"otilde", 0xF5},
	{"odieresis", 0xF6}, {"divide", 0xF7}, {"oslash", 0xF8}, {"ugrave", 0xF9}, {"uacute", 0xFA},
	{"ucircumflex", 0xFB}, {"udieresis", 0xFC}, {"yacute", 0xFD}, {"thorn", 0xFE}, {"ydieresis", 0xFF},
	{"Abreve", 0x102}, {"abreve", 0x103}, {"Aogonek", 0x104}, {"aogonek", 0x105}, {"Cacute", 0x106},
	{"cacute", 0x107}, {"Ccaron", 0x10C}, {"ccaron", 0x10D}, {"Dcaron", 0x10E}, {"dcaron", 0x10F},
	{"Dcroat", 0x110}, {"dcroat", 0x111}, {"Eogonek", 0x118}, {"eogonek", 0x119}, {"Ecaron", 0x11A},
	{"ecaron", 0x11B}, {"Gbreve", 0x11E}, {"gbreve", 0x11F}, {"Idotaccent", 0x130}, {"dotlessi", 0x131},
	{"Lacute", 0x139}, {"lacute", 0x13A}, {"Lcaron", 0x13D}, {"lcaron", 0x13E}, {"Lslash", 0x141},
	{"lslash", 0x142}, {"Nacute", 0x143}, {"nacute", 0x144}, {"Ncaron", 0x147}, {"ncaron", 0x148},
	{"Ohungarumlaut", 0x150}, {"ohungarumlaut", 0x151}, {"OE", 0x152}, {"oe", 0x153}, {"Racute", 0x154},
	{"racute", 0x155}, {"Rcaron", 0x158}, {"rcaron", 0x159}, {"Sacute", 0x15A}, {"sacute", 0x15B},
	{"Scedilla", 0x15E}, {"scedilla", 0x15F}, {"Scaron", 0x160}, {"scaron", 0x161}, {"Tcaron", 0x164},
	{"tcaron", 0x165}, {"Uring", 0x16E}, {"uring", 0x16F}, {"Uhungarumlaut", 0x170}, {"uhungarumlaut", 0x171},
	{"Ydieresis", 0x178}, {"Zacute", 0x179}, {"zacute", 0x17A}, {"Zdotaccent", 0x17B}, {"zdotaccent", 0x17C},
	{"Zcaron", 0x17D}, {"zcaron", 0x17E}, {"florin", 0x192}, {"circumflex", 0x2C6}, {"caron", 0x2C7},
	{"breve", 0x2D8}, {"dotaccent", 0x2D9}, {"ring", 0x2DA}, {"ogonek", 0x2DB}, {"tilde", 0x2DC},
	{"hungarumlaut", 0x2DD}, {"Alpha", 0x391}, {"Beta", 0x392}, {"Gamma", 0x393}, {"Delta", 0x394}, {"Epsilon", 0x395},
	{"Zeta", 0x396}, {"Eta", 0x397}, {"Theta", 0x398}, {"Iota", 0x399}, {"Kappa", 0x39A}, {"Lambda", 0x39B},
	{"Mu", 0x39C}, {"Nu", 0x39D}, {"Xi", 0x39E}, {"Omicron", 0x39F}, {"Pi", 0x3A0}, {"Rho", 0x3A1},
	{"Sigma", 0x3A3}, {"Tau", 0x3A4}, {"Upsilon", 0x3A5}, {"Phi", 0x3A6}, {"Chi", 0x3A7}, {"Psi", 0x3A8},
	{"Omega", 0x3A9},
	{"alpha", 0x3B1}, {"beta", 0x3B2}, {"gamma", 0x3B3}, {"delta", 0x3B4}, {"epsilon", 0x3B5},
	{"zeta", 0x3B6}, {"eta", 0x3B7}, {"theta", 0x3B8}, {"iota", 0x3B9}, {"kappa", 0x3BA}, {"lambda", 0x3BB},
	{"nu", 0x3BD}, {"xi", 0x3BE}, {"omicron", 0x3BF}, {"pi", 0x3C0}, {"rho", 0x3C1}, {"sigma1", 0x3C2},
	{"sigma", 0x3C3}, {"tau", 0x3C4}, {"upsilon", 0x3C5}, {"phi", 0x3C6}, {"chi", 0x3C7}, {"psi", 0x3C8},
	{"omega", 0x3C9}, {"theta1", 0x3D1}, {"Upsilon1", 0x3D2}, {"phi1", 0x3D5}, {"omega1", 0x3D6},
	{"endash", 0x2013}, {"emdash", 0x2014}, {"quoteleft", 0x2018}, {"quoteright", 0x2019},
	{"quotesinglbase", 0x201A}, {"quotedblleft", 0x201C}, {"quotedblright", 0x201D}, {"quotedblbase", 0x201E},
	{"dagger", 0x2020}, {"daggerdbl", 0x2021}, {"bullet", 0x2022}, {"ellipsis", 0x2026},
	{"perthousand", 0x2030}, {"minute", 0x2032}, {"second", 0x2033}, {"guilsinglleft", 0x2039},
	{"guilsinglright", 0x203A}, {"fraction", 0x2044}, {"Euro", 0x20AC}, {"franc", 0x20A3},
	{"trademark", 0x2122}, {"Omega", 0x2126}, {"aleph", 0x2135}, {"arrowleft", 0x2190}, {"arrowup", 0x2191},
	{"arrowright", 0x2192}, {"arrowdown", 0x2193}, {"arrowboth", 0x2194}, {"arrowupdn", 0x2195},
	{"arrowdblleft", 0x21D0}, {"arrowdblup", 0x21D1}, {"arrowdblright", 0x21D2}, {"arrowdbldown", 0x21D3},
	{"arrowdblboth", 0x21D4}, {"universal", 0x2200}, {"partialdiff", 0x2202}, {"existential", 0x2203},
	{"emptyset", 0x2205}, {"Delta", 0x2206}, {"gradient", 0x2207}, {"element", 0x2208},
	{"notelement", 0x2209}, {"suchthat", 0x220B}, {"product", 0x220F}, {"summation", 0x2211},
	{"minus", 0x2212}, {"asteriskmath", 0x2217}, {"radical", 0x221A}, {"proportional", 0x221D},
	{"infinity", 0x221E}, {"angle", 0x2220}, {"logicaland", 0x2227}, {"logicalor", 0x2228},
	{"intersection", 0x2229}, {"union", 0x222A}, {"integral", 0x222B}, {"therefore", 0x2234},
	{"similar", 0x223C}, {"congruent", 0x2245}, {"approxequal", 0x2248}, {"notequal", 0x2260},
	{"equivalence", 0x2261}, {"lessequal", 0x2264}, {"greaterequal", 0x2265}, {"propersubset", 0x2282},
	{"propersuperset", 0x2283}, {"notsubset", 0x2284}, {"reflexsubset", 0x2286}, {"reflexsuperset", 0x2287},
	{"circleplus", 0x2295}, {"circlemultiply", 0x2297}, {"perpendicular", 0x22A5}, {"dotmath", 0x22C5},
	{"lozenge", 0x25CA}, {"spade", 0x2660}, {"club", 0x2663}, {"heart", 0x2665}, {"diamond", 0x2666},
	{"ff", 0xFB00}, {"fi", 0xFB01}, {"fl", 0xFB02}, {"ffi", 0xFB03}, {"ffl", 0xFB04},
	{"nonbreakingspace", 0xA0}, {"middot", 0xB7}, {"overscore", 0xAF}, {"Ohm", 0x2126},
	{"apple", 0xF8FF}, {"periodcentered", 0x2219},
}

var (
	nameToRune = map[string]rune{}
	runeToName = map[rune]string{}
)

func init() {
	for c := 'A'; c <= 'Z'; c++ {
		nameToRune[string(c)] = c
		runeToName[c] = string(c)
	}
	for c := 'a'; c <= 'z'; c++ {
		nameToRune[string(c)] = c
		runeToName[c] = string(c)
	}
	for _, g := range glyphUnicode {
		if _, ok := nameToRune[g.name]; !ok {
			nameToRune[g.name] = g.r
		}
		if _, ok := runeToName[g.r]; !ok {
			runeToName[g.r] = g.name
		}
	}
	buildEncodings()
}

// glyphNameToRune maps a glyph name to Unicode, including the uniXXXX,
// uXXXX and suffixed (a.sc, f_i) forms
func glyphNameToRune(name string) (rune, bool) {
	if r, ok := nameToRune[name]; ok {
		return r, true
	}
	if i := strings.IndexByte(name, '.'); i > 0 {
		return glyphNameToRune(name[:i])
	}
	if strings.HasPrefix(name, "uni") && len(name) >= 7 {
		if v, err := strconv.ParseUint(name[3:7], 16, 32); err == nil {
			return rune(v), true
		}
	}
	if strings.HasPrefix(name, "u") && len(name) >= 5 && len(name) <= 7 {
		if v, err := strconv.ParseUint(name[1:], 16, 32); err == nil && v <= 0x10FFFF {
			return rune(v), true
		}
	}
	return 0, false
}

var asciiNames = []string{
	"space", "exclam", "quotedbl", "numbersign", "dollar", "percent", "ampersand", "quotesingle",
	"parenleft", "parenright", "asterisk", "plus", "comma", "hyphen", "period", "slash",
	"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
	"colon", "semicolon", "less", "equal", "greater", "question", "at",
	"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
	"U", "V", "W", "X", "Y", "Z",
	"bracketleft", "backslash", "bracketright", "asciicircum", "underscore", "grave",
	"a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t",
	"u", "v", "w", "x", "y", "z",
	"braceleft", "bar", "braceright", "asciitilde",
}

var (
	standardEncoding [256]string
	winAnsiEncoding  [256]string
	macRomanEncoding [256]string
	symbolEncoding   [256]string
)

func buildEncodings() {
	for i, n := range asciiNames {
		standardEncoding[32+i] = n
		winAnsiEncoding[32+i] = n
		macRomanEncoding[32+i] = n
	}
	standardEncoding[39] = "quoteright"
	standardEncoding[96] = "quoteleft"
	stdUpper := map[int]string{
		161: "exclamdown", 162: "cent", 163: "sterling", 164: "fraction", 165: "yen", 166: "florin",
		167: "section", 168: "currency", 169: "quotesingle", 170: "quotedblleft", 171: "guillemotleft",
		172: "guilsinglleft", 173: "guilsinglright", 174: "fi", 175: "fl", 177: "endash", 178: "dagger",
		179: "daggerdbl", 180: "periodcentered", 182: "paragraph", 183: "bullet", 184: "quotesinglbase",
		185: "quotedblbase", 186: "quotedblright", 187: "guillemotright", 188: "ellipsis", 189: "perthousand",
		191: "questiondown", 193: "grave", 194: "acute", 195: "circumflex", 196: "tilde", 197: "macron",
		198: "breve", 199: "dotaccent", 200: "dieresis", 202: "ring", 203: "cedilla", 205: "hungarumlaut",
		206: "ogonek", 207: "caron", 208: "emdash", 225: "AE", 227: "ordfeminine", 232: "Lslash",
		233: "Oslash", 234: "OE", 235: "ordmasculine", 241: "ae", 245: "dotlessi", 248: "lslash",
		249: "oslash", 250: "oe", 251: "germandbls",
	}
	for c, n := range stdUpper {
		standardEncoding[c] = n
	}
	//WinAnsi: the upper half follows code page 1252
	dec := charmap.Windows1252
	for c := 128; c < 256; c++ {
		r := dec.DecodeByte(byte(c))
		if n, ok := runeToName[r]; ok && r != 0xFFFD {
			winAnsiEncoding[c] = n
		} else {
			winAnsiEncoding[c] = "bullet"
		}
	}
	winAnsiEncoding[160] = "space"
	winAnsiEncoding[173] = "hyphen"
	winAnsiEncoding[127] = "bullet"
	//MacRoman: the upper half is the Macintosh glyph order from Adieresis
	for c := 128; c < 256; c++ {
		macRomanEncoding[c] = macGlyphNames[98+c-128]
	}
	macRomanEncoding[0xCA] = "space"
	macRomanEncoding[0xDB] = "currency"

	//The Symbol font's built-in encoding: Greek on the Latin letters
	greek := "Alpha Beta Chi Delta Epsilon Phi Gamma Eta Iota theta1 Kappa Lambda Mu Nu Omicron Pi Theta Rho Sigma Tau Upsilon sigma1 Omega Xi Psi Zeta"
	for i, n := range strings.Fields(greek) {
		symbolEncoding['A'+i] = n
		symbolEncoding['a'+i] = strings.ToLower(n[:1]) + n[1:]
	}
	symbolEncoding['J'] = "theta1"
	symbolEncoding['j'] = "phi1"
	symbolEncoding['V'] = "sigma1"
	symbolEncoding['v'] = "omega1"
	for c := 32; c < 64; c++ {
		symbolEncoding[c] = asciiNames[c-32]
	}
	symbolEncoding['"'] = "universal"
	symbolEncoding['$'] = "existential"
	symbolEncoding['\''] = "suchthat"
	symbolEncoding['*'] = "asteriskmath"
	symbolEncoding['-'] = "minus"
	symbolEncoding['@'] = "congruent"
	symbolEncoding['\\'] = "therefore"
	symbolEncoding['^'] = "perpendicular"
	symbolEncoding['_'] = "underscore"
	symbolEncoding['['] = "bracketleft"
	symbolEncoding[']'] = "bracketright"
	symbolEncoding['{'] = "braceleft"
	symbolEncoding['|'] = "bar"
	symbolEncoding['}'] = "braceright"
	symbolEncoding['~'] = "similar"
	symUpper := map[int]string{
		0xA1: "Upsilon1", 0xA2: "minute", 0xA3: "lessequal", 0xA4: "fraction", 0xA5: "infinity",
		0xA6: "florin", 0xA7: "club", 0xA8: "diamond", 0xA9: "heart", 0xAA: "spade", 0xAB: "arrowboth",
		0xAC: "arrowleft", 0xAD: "arrowup", 0xAE: "arrowright", 0xAF: "arrowdown", 0xB0: "degree",
		0xB1: "plusminus", 0xB2: "second", 0xB3: "greaterequal", 0xB4: "multiply", 0xB5: "proportional",
		0xB6: "partialdiff", 0xB7: "bullet", 0xB8: "divide", 0xB9: "notequal", 0xBA: "equivalence",
		0xBB: "approxequal", 0xBC: "ellipsis", 0xC0: "aleph", 0xC4: "circlemultiply", 0xC5: "circleplus",
		0xC6: "emptyset", 0xC7: "intersection", 0xC8: "union", 0xC9: "propersuperset", 0xCA: "reflexsuperset",
		0xCB: "notsubset", 0xCC: "propersubset", 0xCD: "reflexsubset", 0xCE: "element", 0xCF: "notelement",
		0xD0: "angle", 0xD1: "gradient", 0xD2: "registered", 0xD3: "copyright", 0xD4: "trademark",
		0xD5: "product", 0xD6: "radical", 0xD7: "dotmath", 0xD8: "logicalnot", 0xD9: "logicaland",
		0xDA: "logicalor", 0xDB: "arrowdblboth", 0xDC: "arrowdblleft", 0xDD: "arrowdblup",
		0xDE: "arrowdblright", 0xDF: "arrowdbldown", 0xE0: "lozenge", 0xE5: "summation", 0xF2: "integral",
	}
	for c, n := range symUpper {
		symbolEncoding[c] = n
	}
}

func encodingByName(n Name) *[256]string {
	switch n {
	case "StandardEncoding":
		return &standardEncoding
	case "WinAnsiEncoding":
		return &winAnsiEncoding
	case "MacRomanEncoding":
		return &macRomanEncoding
	}
	return nil
}

// macGlyphNames is the standard Macintosh glyph order (258 names)
var macGlyphNames = strings.Fields(`.notdef .null nonmarkingreturn space exclam quotedbl numbersign
dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash
zero one two three four five six seven eight nine colon semicolon less equal greater question at
A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum
underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright
asciitilde Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex
adieresis atilde aring ccedilla eacute egrave ecircumflex edieresis iacute igrave icircumflex
idieresis ntilde oacute ograve ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis
dagger degree cent sterling section bullet paragraph germandbls registered copyright trademark
acute dieresis notequal AE Oslash infinity plusminus lessequal greaterequal yen mu partialdiff
summation product pi integral ordfeminine ordmasculine Omega ae oslash questiondown exclamdown
logicalnot radical florin approxequal Delta guillemotleft guillemotright ellipsis nonbreakingspace
Agrave Atilde Otilde OE oe endash emdash quotedblleft quotedblright quoteleft quoteright divide
lozenge ydieresis Ydieresis fraction currency guilsinglleft guilsinglright fi fl daggerdbl
periodcentered quotesinglbase quotedblbase perthousand Acircumflex Ecircumflex Aacute Edieresis
Egrave Iacute Icircumflex Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute Ucircumflex
Ugrave dotlessi circumflex tilde macron breve dotaccent ring cedilla hungarumlaut ogonek caron
Lslash lslash Scaron scaron Zcaron zcaron brokenbar Eth eth Yacute yacute Thorn thorn minus
multiply onesuperior twosuperior threesuperior onehalf onequarter threequarters franc Gbreve
gbreve Idotaccent Scedilla scedilla Cacute cacute Ccaron ccaron dcroat`)

// cffStandardStrings are the 391 predefined CFF string IDs
var cffStandardStrings = strings.Fields(`.notdef space exclam quotedbl numbersign dollar percent
ampersand quoteright parenleft parenright asterisk plus comma hyphen period slash zero one two
three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G
H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore
quoteleft a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde
exclamdown cent sterling fraction yen florin section currency quotesingle quotedblleft
guillemotleft guilsinglleft guilsinglright fi fl endash dagger daggerdbl periodcentered paragraph
bullet quotesinglbase quotedblbase quotedblright guillemotright ellipsis perthousand questiondown
grave acute circumflex tilde macron breve dotaccent dieresis ring cedilla hungarumlaut ogonek
caron emdash AE ordfeminine Lslash Oslash OE ordmasculine ae dotlessi lslash oslash oe germandbls
onesuperior logicalnot mu trademark Eth onehalf plusminus Thorn onequarter divide brokenbar degree
thorn threequarters twosuperior registered minus eth multiply threesuperior copyright Aacute
Acircumflex Adieresis Agrave Aring Atilde Ccedilla Eacute Ecircumflex Edieresis Egrave Iacute
Icircumflex Idieresis Igrave Ntilde Oacute Ocircumflex Odieresis Ograve Otilde Scaron Uacute
Ucircumflex Udieresis Ugrave Yacute Ydieresis Zcaron aacute acircumflex adieresis agrave aring
atilde ccedilla eacute ecircumflex edieresis egrave iacute icircumflex idieresis igrave ntilde
oacute ocircumflex odieresis ograve otilde scaron uacute ucircumflex udieresis ugrave yacute
ydieresis zcaron exclamsmall Hungarumlautsmall dollaroldstyle dollarsuperior ampersandsmall
Acutesmall parenleftsuperior parenrightsuperior twodotenleader onedotenleader zerooldstyle
oneoldstyle twooldstyle threeoldstyle fouroldstyle fiveoldstyle sixoldstyle sevenoldstyle
eightoldstyle nineoldstyle commasuperior threequartersemdash periodsuperior questionsmall
asuperior bsuperior centsuperior dsuperior esuperior isuperior lsuperior msuperior nsuperior
osuperior rsuperior ssuperior tsuperior ff ffi ffl parenleftinferior parenrightinferior
Circumflexsmall hyphensuperior Gravesmall Asmall Bsmall Csmall Dsmall Esmall Fsmall Gsmall Hsmall
Ismall Jsmall Ksmall Lsmall Msmall Nsmall Osmall Psmall Qsmall Rsmall Ssmall Tsmall Usmall Vsmall
Wsmall Xsmall Ysmall Zsmall colonmonetary onefitted rupiah Tildesmall exclamdownsmall
centoldstyle Lslashsmall Scaronsmall Zcaronsmall Dieresissmall Brevesmall Caronsmall
Dotaccentsmall Macronsmall figuredash hypheninferior Ogoneksmall Ringsmall Cedillasmall
questiondownsmall oneeighth threeeighths fiveeighths seveneighths onethird twothirds zerosuperior
foursuperior fivesuperior sixsuperior sevensuperior eightsuperior ninesuperior zeroinferior
oneinferior twoinferior threeinferior fourinferior fiveinferior sixinferior seveninferior
eightinferior nineinferior centinferior dollarinferior periodinferior commainferior Agravesmall
Aacutesmall Acircumflexsmall Atildesmall Adieresissmall Aringsmall AEsmall Ccedillasmall
Egravesmall Eacutesmall Ecircumflexsmall Edieresissmall Igravesmall Iacutesmall Icircumflexsmall
Idieresissmall Ethsmall Ntildesmall Ogravesmall Oacutesmall Ocircumflexsmall Otildesmall
Odieresissmall OEsmall Oslashsmall Ugravesmall Uacutesmall Ucircumflexsmall Udieresissmall
Yacutesmall Thornsmall Ydieresissmall 001.000 001.001 001.002 001.003 Black Bold Book Light
Medium Regular Roman Semibold`)
