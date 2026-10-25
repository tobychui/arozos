package pdfrender

import (
	"errors"
	"strconv"
)

/*
	object.go

	The PDF object model and a tolerant lexer / parser for it. The same lexer
	reads indirect objects from the file and the operators of content
	streams, so it also returns bare keywords (operators) as values.
*/

// Name is a PDF name object, without the leading slash
type Name string

// String is a PDF string object (literal or hex), as raw bytes
type String string

// Array is a PDF array
type Array []Object

// Dict is a PDF dictionary
type Dict map[Name]Object

// Ref is an indirect reference
type Ref struct {
	Num int
	Gen int
}

// Stream is a stream object. The data is read from the file on demand.
type Stream struct {
	Dict   Dict
	ref    Ref
	offset int64  //Absolute offset of the data in the file, -1 when data is set
	length int64  //Raw data length
	data   []byte //Raw data of streams held in memory (inline images)
}

// keyword is an unquoted token: an operator or one of the object keywords
type keyword string

// Object is any PDF value: nil, bool, int, float64, Name, String, Array,
// Dict, Ref, *Stream or keyword
type Object interface{}

var errSyntax = errors.New("pdf syntax error")

// maxNesting bounds array / dictionary nesting so crafted input cannot
// exhaust the stack
const maxNesting = 128

func isWhite(c byte) bool {
	return c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\f' || c == 0
}

func isDelim(c byte) bool {
	switch c {
	case '(', ')', '<', '>', '[', ']', '{', '}', '/', '%':
		return true
	}
	return false
}

// tokenKind of a lexed token
type tokenKind int

const (
	tokEOF tokenKind = iota
	tokInt
	tokReal
	tokName
	tokString
	tokArrayOpen
	tokArrayClose
	tokDictOpen
	tokDictClose
	tokBraceOpen
	tokBraceClose
	tokKeyword
)

type token struct {
	kind tokenKind
	i    int
	f    float64
	s    string
}

// lexer reads tokens from a byte slice. truncated is set when a token ran
// into the end of the buffer, so callers reading a window of a file know to
// retry with a larger window.
type lexer struct {
	buf       []byte
	pos       int
	truncated bool
}

func (l *lexer) skipWhite() {
	for l.pos < len(l.buf) {
		c := l.buf[l.pos]
		if isWhite(c) {
			l.pos++
		} else if c == '%' {
			for l.pos < len(l.buf) && l.buf[l.pos] != '\n' && l.buf[l.pos] != '\r' {
				l.pos++
			}
		} else {
			return
		}
	}
}

func (l *lexer) next() token {
	l.skipWhite()
	if l.pos >= len(l.buf) {
		l.truncated = true
		return token{kind: tokEOF}
	}
	c := l.buf[l.pos]
	switch c {
	case '[':
		l.pos++
		return token{kind: tokArrayOpen}
	case ']':
		l.pos++
		return token{kind: tokArrayClose}
	case '{':
		l.pos++
		return token{kind: tokBraceOpen}
	case '}':
		l.pos++
		return token{kind: tokBraceClose}
	case '<':
		if l.pos+1 < len(l.buf) && l.buf[l.pos+1] == '<' {
			l.pos += 2
			return token{kind: tokDictOpen}
		}
		return l.hexString()
	case '>':
		l.pos++
		if l.pos < len(l.buf) && l.buf[l.pos] == '>' {
			l.pos++
			return token{kind: tokDictClose}
		}
		//A stray '>' is skipped
		return l.next()
	case '(':
		return l.literalString()
	case ')':
		l.pos++
		return l.next()
	case '/':
		return l.name()
	}
	if c == '+' || c == '-' || c == '.' || (c >= '0' && c <= '9') {
		return l.number()
	}
	start := l.pos
	for l.pos < len(l.buf) && !isWhite(l.buf[l.pos]) && !isDelim(l.buf[l.pos]) {
		l.pos++
	}
	if l.pos >= len(l.buf) {
		l.truncated = true
	}
	return token{kind: tokKeyword, s: string(l.buf[start:l.pos])}
}

func unhex(c byte) int {
	switch {
	case c >= '0' && c <= '9':
		return int(c - '0')
	case c >= 'a' && c <= 'f':
		return int(c-'a') + 10
	case c >= 'A' && c <= 'F':
		return int(c-'A') + 10
	}
	return -1
}

func (l *lexer) name() token {
	l.pos++ //the slash
	out := make([]byte, 0, 16)
	for l.pos < len(l.buf) {
		c := l.buf[l.pos]
		if isWhite(c) || isDelim(c) {
			break
		}
		if c == '#' && l.pos+2 < len(l.buf) && unhex(l.buf[l.pos+1]) >= 0 && unhex(l.buf[l.pos+2]) >= 0 {
			out = append(out, byte(unhex(l.buf[l.pos+1])<<4|unhex(l.buf[l.pos+2])))
			l.pos += 3
			continue
		}
		out = append(out, c)
		l.pos++
	}
	if l.pos >= len(l.buf) {
		l.truncated = true
	}
	return token{kind: tokName, s: string(out)}
}

func (l *lexer) number() token {
	start := l.pos
	l.pos++
	for l.pos < len(l.buf) {
		c := l.buf[l.pos]
		if (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E' {
			l.pos++
			continue
		}
		break
	}
	if l.pos >= len(l.buf) {
		l.truncated = true
	}
	return parseNumberToken(l.buf[start:l.pos])
}

// parseNumberToken accepts the malformed numbers real files contain, like
// "--5", "4.-3" or a lone "-"
func parseNumberToken(b []byte) token {
	isInt := true
	clean := make([]byte, 0, len(b))
	seenDigit, seenDot := false, false
	for i, c := range b {
		switch {
		case c >= '0' && c <= '9':
			seenDigit = true
			clean = append(clean, c)
		case c == '.':
			if !seenDot {
				seenDot = true
				isInt = false
				clean = append(clean, c)
			}
		case c == '-' || c == '+':
			if seenDigit || seenDot {
				//A sign after the digits ends the number ("4.-3" reads 4.)
				goto done
			}
			if len(clean) == 0 && i == 0 {
				clean = append(clean, c)
			} else if len(clean) == 0 {
				clean = append(clean, '-')
			}
		}
	}
done:
	if !seenDigit {
		return token{kind: tokInt, i: 0}
	}
	if isInt {
		if v, err := strconv.ParseInt(string(clean), 10, 64); err == nil && v >= -1<<31 && v < 1<<31 {
			return token{kind: tokInt, i: int(v)}
		}
	}
	f, _ := strconv.ParseFloat(string(clean), 64)
	return token{kind: tokReal, f: f}
}

func (l *lexer) literalString() token {
	l.pos++ //the parenthesis
	out := make([]byte, 0, 32)
	depth := 1
	for l.pos < len(l.buf) {
		c := l.buf[l.pos]
		l.pos++
		switch c {
		case '(':
			depth++
			out = append(out, c)
		case ')':
			depth--
			if depth == 0 {
				return token{kind: tokString, s: string(out)}
			}
			out = append(out, c)
		case '\r':
			//EOL markers inside a string all read as \n
			if l.pos < len(l.buf) && l.buf[l.pos] == '\n' {
				l.pos++
			}
			out = append(out, '\n')
		case '\\':
			if l.pos >= len(l.buf) {
				break
			}
			e := l.buf[l.pos]
			l.pos++
			switch e {
			case 'n':
				out = append(out, '\n')
			case 'r':
				out = append(out, '\r')
			case 't':
				out = append(out, '\t')
			case 'b':
				out = append(out, '\b')
			case 'f':
				out = append(out, '\f')
			case '\r':
				if l.pos < len(l.buf) && l.buf[l.pos] == '\n' {
					l.pos++
				}
			case '\n':
			default:
				if e >= '0' && e <= '7' {
					v := int(e - '0')
					for k := 0; k < 2 && l.pos < len(l.buf) && l.buf[l.pos] >= '0' && l.buf[l.pos] <= '7'; k++ {
						v = v*8 + int(l.buf[l.pos]-'0')
						l.pos++
					}
					out = append(out, byte(v))
				} else {
					out = append(out, e)
				}
			}
		default:
			out = append(out, c)
		}
	}
	l.truncated = true
	return token{kind: tokString, s: string(out)}
}

func (l *lexer) hexString() token {
	l.pos++ //the angle bracket
	out := make([]byte, 0, 32)
	hi := -1
	for l.pos < len(l.buf) {
		c := l.buf[l.pos]
		l.pos++
		if c == '>' {
			if hi >= 0 {
				out = append(out, byte(hi<<4))
			}
			return token{kind: tokString, s: string(out)}
		}
		v := unhex(c)
		if v < 0 {
			continue
		}
		if hi < 0 {
			hi = v
		} else {
			out = append(out, byte(hi<<4|v))
			hi = -1
		}
	}
	l.truncated = true
	return token{kind: tokString, s: string(out)}
}

// parser builds objects from tokens with a two token lookahead for "n g R"
type parser struct {
	lex  *lexer
	peek []token
}

func newParser(b []byte) *parser {
	return &parser{lex: &lexer{buf: b}}
}

func (p *parser) nextToken() token {
	if len(p.peek) > 0 {
		t := p.peek[0]
		p.peek = p.peek[1:]
		return t
	}
	return p.lex.next()
}

func (p *parser) peekToken(n int) token {
	for len(p.peek) <= n {
		p.peek = append(p.peek, p.lex.next())
	}
	return p.peek[n]
}

// parseObject reads one object. Keywords come back as keyword values.
func (p *parser) parseObject(depth int) (Object, error) {
	if depth > maxNesting {
		return nil, errSyntax
	}
	t := p.nextToken()
	switch t.kind {
	case tokEOF:
		return nil, errSyntax
	case tokInt:
		//Could be the start of an indirect reference
		t1 := p.peekToken(0)
		if t1.kind == tokInt && t.i >= 0 && t1.i >= 0 {
			t2 := p.peekToken(1)
			if t2.kind == tokKeyword && t2.s == "R" {
				p.nextToken()
				p.nextToken()
				return Ref{Num: t.i, Gen: t1.i}, nil
			}
		}
		return t.i, nil
	case tokReal:
		return t.f, nil
	case tokName:
		return Name(t.s), nil
	case tokString:
		return String(t.s), nil
	case tokArrayOpen:
		arr := Array{}
		for {
			nt := p.peekToken(0)
			if nt.kind == tokArrayClose {
				p.nextToken()
				return arr, nil
			}
			if nt.kind == tokEOF {
				return arr, errSyntax
			}
			if nt.kind == tokDictClose {
				//Unbalanced, give up on this array
				return arr, nil
			}
			v, err := p.parseObject(depth + 1)
			if err != nil {
				return arr, err
			}
			arr = append(arr, v)
		}
	case tokDictOpen:
		d := Dict{}
		for {
			nt := p.nextToken()
			if nt.kind == tokDictClose {
				return d, nil
			}
			if nt.kind == tokEOF {
				return d, errSyntax
			}
			if nt.kind != tokName {
				//Skip junk keys
				if nt.kind == tokKeyword && (nt.s == "endobj" || nt.s == "stream") {
					p.peek = append([]token{nt}, p.peek...)
					return d, nil
				}
				continue
			}
			vt := p.peekToken(0)
			if vt.kind == tokDictClose {
				d[Name(nt.s)] = nil
				continue
			}
			v, err := p.parseObject(depth + 1)
			if err != nil {
				return d, err
			}
			if kw, ok := v.(keyword); ok && kw == "null" {
				v = nil
			}
			d[Name(nt.s)] = v
		}
	case tokArrayClose, tokDictClose, tokBraceClose:
		return keyword(""), nil
	case tokBraceOpen:
		return keyword("{"), nil
	case tokKeyword:
		switch t.s {
		case "true":
			return true, nil
		case "false":
			return false, nil
		case "null":
			return nil, nil
		}
		return keyword(t.s), nil
	}
	return nil, errSyntax
}

/*
	Typed accessors. They take an already resolved object; the Document's
	methods with the same names resolve references first.
*/

func toFloat(o Object) (float64, bool) {
	switch v := o.(type) {
	case int:
		return float64(v), true
	case float64:
		return v, true
	}
	return 0, false
}

func toInt(o Object) (int, bool) {
	switch v := o.(type) {
	case int:
		return v, true
	case float64:
		if v > -1e9 && v < 1e9 {
			return int(v), true
		}
	}
	return 0, false
}
