package email

/*
	htmltext.go

	Converts HTML to readable plain text: list previews, the text/plain
	alternative of outgoing mail and full-text quoting.
*/

import (
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

var (
	blankLinesPattern = regexp.MustCompile(`\n{3,}`)
	spacesPattern     = regexp.MustCompile(`[ \t\f\r\x{00a0}]+`)
)

var skippedTextElements = map[string]bool{
	"head": true, "style": true, "script": true, "title": true, "noscript": true,
	"template": true, "svg": true, "xml": true,
}

var blockTextElements = map[string]bool{
	"p": true, "div": true, "tr": true, "table": true, "h1": true, "h2": true,
	"h3": true, "h4": true, "h5": true, "h6": true, "ul": true, "ol": true,
	"blockquote": true, "pre": true, "section": true, "article": true,
	"header": true, "footer": true, "address": true, "center": true, "dl": true,
	"dt": true, "dd": true, "tbody": true, "thead": true, "nav": true,
}

// htmlToText renders HTML as text. withLinks appends link targets that differ
// from their text, which is useful in a plain-text alternative.
func htmlToText(source string, withLinks bool) string {
	tokenizer := html.NewTokenizer(strings.NewReader(source))
	var builder strings.Builder
	skipDepth := 0
	preDepth := 0
	var linkStack []string
	var linkText []int

	newline := func() {
		text := builder.String()
		if len(text) > 0 && !strings.HasSuffix(text, "\n") {
			builder.WriteString("\n")
		}
	}

	for {
		tokenType := tokenizer.Next()
		switch tokenType {
		case html.ErrorToken:
			return finishText(builder.String())
		case html.TextToken:
			if skipDepth > 0 {
				continue
			}
			text := string(tokenizer.Text())
			if preDepth == 0 {
				text = spacesPattern.ReplaceAllString(strings.ReplaceAll(text, "\n", " "), " ")
				if strings.HasSuffix(builder.String(), "\n") || builder.Len() == 0 {
					text = strings.TrimLeft(text, " ")
				}
			}
			builder.WriteString(text)
		case html.StartTagToken, html.SelfClosingTagToken:
			nameBytes, hasAttr := tokenizer.TagName()
			name := string(nameBytes)
			if skippedTextElements[name] {
				if tokenType == html.StartTagToken {
					skipDepth++
				}
				continue
			}
			if skipDepth > 0 {
				continue
			}
			switch {
			case name == "br":
				builder.WriteString("\n")
			case name == "hr":
				newline()
				builder.WriteString("----------\n")
			case name == "li":
				newline()
				builder.WriteString("- ")
			case name == "td" || name == "th":
				if !strings.HasSuffix(builder.String(), "\n") && builder.Len() > 0 {
					builder.WriteString(" ")
				}
			case name == "pre":
				newline()
				preDepth++
			case name == "img" && withLinks:
				alt := attributeValue(tokenizer, hasAttr, "alt")
				if strings.TrimSpace(alt) != "" {
					builder.WriteString("[" + strings.TrimSpace(alt) + "]")
				}
			case name == "a" && withLinks && tokenType == html.StartTagToken:
				linkStack = append(linkStack, attributeValue(tokenizer, hasAttr, "href"))
				linkText = append(linkText, builder.Len())
			case blockTextElements[name]:
				newline()
			}
		case html.EndTagToken:
			nameBytes, _ := tokenizer.TagName()
			name := string(nameBytes)
			if skippedTextElements[name] {
				if skipDepth > 0 {
					skipDepth--
				}
				continue
			}
			if skipDepth > 0 {
				continue
			}
			switch {
			case name == "pre":
				if preDepth > 0 {
					preDepth--
				}
				newline()
			case name == "a" && withLinks && len(linkStack) > 0:
				href := linkStack[len(linkStack)-1]
				start := linkText[len(linkText)-1]
				linkStack = linkStack[:len(linkStack)-1]
				linkText = linkText[:len(linkText)-1]
				current := builder.String()
				label := ""
				if start <= len(current) {
					label = strings.TrimSpace(current[start:])
				}
				lowerHref := strings.ToLower(href)
				if (strings.HasPrefix(lowerHref, "http://") || strings.HasPrefix(lowerHref, "https://")) && label != href && label != "" {
					builder.WriteString(" (" + href + ")")
				}
			case name == "p" || name == "h1" || name == "h2" || name == "h3" || name == "blockquote" || name == "table":
				newline()
				builder.WriteString("\n")
			case blockTextElements[name]:
				newline()
			}
		}
	}
}

func attributeValue(tokenizer *html.Tokenizer, hasAttr bool, wanted string) string {
	for hasAttr {
		var key, value []byte
		key, value, hasAttr = tokenizer.TagAttr()
		if string(key) == wanted {
			return string(value)
		}
	}
	return ""
}

func finishText(text string) string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimRight(line, " \t")
	}
	text = strings.Join(lines, "\n")
	text = blankLinesPattern.ReplaceAllString(text, "\n\n")
	return strings.TrimSpace(text)
}

// previewText builds the one-line snippet shown under a subject.
func previewText(text string, max int) string {
	//Quoted reply lines would make every message of a thread look the same
	lines := strings.Split(text, "\n")
	kept := lines[:0]
	for _, line := range lines {
		if !strings.HasPrefix(strings.TrimSpace(line), ">") {
			kept = append(kept, line)
		}
	}
	text = strings.Join(strings.Fields(strings.Join(kept, " ")), " ")
	if len([]rune(text)) > max {
		runes := []rune(text)
		text = strings.TrimSpace(string(runes[:max])) + "…"
	}
	return text
}
