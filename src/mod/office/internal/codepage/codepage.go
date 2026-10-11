/*
Package codepage decodes the 8-bit text of pre-Unicode Office files. Excel
5/95 workbooks and Word 6/95 documents store strings in the Windows code
page they were saved with (named by a CODEPAGE record or the font charset);
the Office 97 formats mostly store UTF-16, falling back to Latin-1 or
cp1252 for "compressed" text, which is code page 1252 here too.
*/
package codepage

import (
	"unicode/utf16"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/korean"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
)

// Decoder turns bytes in one code page into text
type Decoder struct {
	enc encoding.Encoding
}

// For returns the decoder of a Windows code page number; an unknown code
// page decodes as cp1252
func For(cp int) Decoder {
	var e encoding.Encoding
	switch cp {
	case 874:
		e = charmap.Windows874
	case 932:
		e = japanese.ShiftJIS
	case 936:
		e = simplifiedchinese.GBK
	case 949:
		e = korean.EUCKR
	case 950:
		e = traditionalchinese.Big5
	case 1250:
		e = charmap.Windows1250
	case 1251:
		e = charmap.Windows1251
	case 1253:
		e = charmap.Windows1253
	case 1254:
		e = charmap.Windows1254
	case 1255:
		e = charmap.Windows1255
	case 1256:
		e = charmap.Windows1256
	case 1257:
		e = charmap.Windows1257
	case 1258:
		e = charmap.Windows1258
	case 10000, 32768:
		e = charmap.Macintosh
	case 437:
		e = charmap.CodePage437
	case 850:
		e = charmap.CodePage850
	case 28591:
		e = charmap.ISO8859_1
	default:
		e = charmap.Windows1252
	}
	return Decoder{enc: e}
}

// ForCharset maps a font charset (LOGFONT lfCharSet) to its code page
func ForCharset(charset int) Decoder {
	switch charset {
	case 128:
		return For(932)
	case 129:
		return For(949)
	case 134:
		return For(936)
	case 136:
		return For(950)
	case 161:
		return For(1253)
	case 162:
		return For(1254)
	case 177:
		return For(1255)
	case 178:
		return For(1256)
	case 186:
		return For(1257)
	case 204:
		return For(1251)
	case 222:
		return For(874)
	case 238:
		return For(1250)
	case 163:
		return For(1258)
	}
	return For(1252)
}

// Decode converts b; undecodable bytes become U+FFFD
func (d Decoder) Decode(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	enc := d.enc
	if enc == nil {
		enc = charmap.Windows1252
	}
	out, err := enc.NewDecoder().Bytes(b)
	if err != nil {
		return Latin1(b)
	}
	return string(out)
}

// Latin1 maps each byte to the code point of the same value (the
// "compressed" strings of Excel 97 and PowerPoint 97)
func Latin1(b []byte) string {
	u := make([]uint16, len(b))
	for i, c := range b {
		u[i] = uint16(c)
	}
	return string(utf16.Decode(u))
}

// cp1252High is cp1252 between 0x80 and 0x9F; the rest of the code page
// is Latin-1
var cp1252High = [32]rune{
	0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
	0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
	0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
	0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178,
}

// Rune1252 maps one cp1252 byte to its character (Word 97's compressed
// text)
func Rune1252(c byte) rune {
	if c >= 0x80 && c <= 0x9F {
		return cp1252High[c-0x80]
	}
	return rune(c)
}
