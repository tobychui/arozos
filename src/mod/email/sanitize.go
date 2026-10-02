package email

/*
	sanitize.go

	Cleans HTML mail before it reaches the reading pane.

	The Mail app renders message HTML inside a sandboxed iframe (no scripts, no
	forms, no top navigation) with a Content-Security-Policy, which is the real
	security boundary. This pass is the second layer and the privacy layer:

	  - removes scripts, frames, plug-ins, forms, meta refreshes, <base> and
	    event handler attributes, and javascript:/data: links;
	  - resolves cid: references to the message's own inline images;
	  - blocks remote images, backgrounds and style sheets unless the user
	    allowed them (tracking pixels are the main reason mail clients do
	    this), reporting hasRemote so the UI can offer "Load images";
	  - drops relative URLs, which would otherwise resolve against ArozOS.
*/

import (
	"bytes"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

type sanitizeOptions struct {
	allowRemote bool
	cid         map[string]string //Lower-case Content-ID -> data: URI
}

type sanitizeResult struct {
	html      string
	hasRemote bool
}

// Elements removed together with everything inside them.
var droppedElements = map[string]bool{
	"script": true, "noscript": true, "iframe": true, "frame": true, "frameset": true,
	"object": true, "embed": true, "applet": true, "param": true, "base": true,
	"meta": true, "link": true, "title": true, "template": true, "svg": true,
	"math": true, "input": true, "select": true, "textarea": true, "option": true,
	"video": true, "audio": true, "source": true, "track": true, "canvas": true,
	"portal": true, "dialog": true, "xml": true, "xss": true,
}

// Elements replaced by their children.
var unwrappedElements = map[string]bool{
	"form": true, "button": true, "label": true, "fieldset": true, "legend": true,
}

// Attributes removed wherever they appear.
var droppedAttributes = map[string]bool{
	"formaction": true, "action": true, "srcdoc": true, "ping": true,
	"http-equiv": true, "dynsrc": true, "lowsrc": true, "integrity": true,
	"nonce": true, "autofocus": true, "contenteditable": true, "draggable": true,
	"accesskey": true, "tabindex": true, "manifest": true,
}

var (
	cssURLPattern    = regexp.MustCompile(`(?i)url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)`)
	cssImportPattern = regexp.MustCompile(`(?i)@import\s+[^;]*;?`)
	cssDangerPattern = regexp.MustCompile(`(?i)(expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:|vbscript\s*:)`)
)

// sanitizeHTML cleans an HTML document. The result is a complete document
// (html/head/body) ready to be placed in an iframe's srcdoc.
func sanitizeHTML(input string, options sanitizeOptions) sanitizeResult {
	result := sanitizeResult{}
	document, err := html.Parse(strings.NewReader(input))
	if err != nil {
		//html.Parse only fails on reader errors; fall back to escaped text
		return sanitizeResult{html: "<pre>" + html.EscapeString(input) + "</pre>"}
	}

	var clean func(node *html.Node)
	clean = func(node *html.Node) {
		for child := node.FirstChild; child != nil; {
			next := child.NextSibling
			switch child.Type {
			case html.CommentNode, html.DoctypeNode:
				//Comments carry Outlook conditional markup only Outlook renders
				node.RemoveChild(child)
			case html.ElementNode:
				name := strings.ToLower(child.Data)
				if child.Namespace != "" && child.Namespace != "html" {
					node.RemoveChild(child)
				} else if droppedElements[name] {
					node.RemoveChild(child)
				} else if unwrappedElements[name] {
					clean(child)
					for grandchild := child.FirstChild; grandchild != nil; {
						nextGrandchild := grandchild.NextSibling
						child.RemoveChild(grandchild)
						node.InsertBefore(grandchild, child)
						grandchild = nextGrandchild
					}
					node.RemoveChild(child)
				} else {
					sanitizeAttributes(child, options, &result)
					if name == "style" {
						sanitizeStyleElement(child, options, &result)
					} else {
						clean(child)
					}
				}
			}
			child = next
		}
	}
	clean(document)

	var buffer bytes.Buffer
	if err := html.Render(&buffer, document); err != nil {
		return sanitizeResult{html: "<pre>" + html.EscapeString(input) + "</pre>"}
	}
	result.html = buffer.String()
	return result
}

func sanitizeAttributes(node *html.Node, options sanitizeOptions, result *sanitizeResult) {
	name := strings.ToLower(node.Data)
	kept := node.Attr[:0]
	for _, attribute := range node.Attr {
		key := strings.ToLower(attribute.Key)
		value := attribute.Val
		if attribute.Namespace != "" || strings.HasPrefix(key, "on") || droppedAttributes[key] || strings.Contains(key, ":") {
			continue
		}

		switch key {
		case "href":
			safe, ok := safeLinkURL(value)
			if !ok {
				continue
			}
			value = safe
		case "src":
			resolved, remote, ok := resolveImageURL(value, options)
			if remote {
				result.hasRemote = true
				if !options.allowRemote {
					kept = append(kept, html.Attribute{Key: "data-remote-src", Val: value})
					continue
				}
			}
			if !ok {
				continue
			}
			value = resolved
		case "srcset":
			if !options.allowRemote {
				if strings.Contains(strings.ToLower(value), "http") {
					result.hasRemote = true
				}
				continue
			}
		case "background", "poster":
			resolved, remote, ok := resolveImageURL(value, options)
			if remote {
				result.hasRemote = true
				if !options.allowRemote {
					continue
				}
			}
			if !ok {
				continue
			}
			value = resolved
		case "style":
			value = sanitizeCSS(value, options, result)
		case "target", "rel":
			//Replaced below for links
			if name == "a" || name == "area" {
				continue
			}
		}
		kept = append(kept, html.Attribute{Key: key, Val: value})
	}
	node.Attr = kept

	if name == "a" || name == "area" {
		node.Attr = append(node.Attr,
			html.Attribute{Key: "target", Val: "_blank"},
			html.Attribute{Key: "rel", Val: "noopener noreferrer nofollow"})
	}
}

func sanitizeStyleElement(node *html.Node, options sanitizeOptions, result *sanitizeResult) {
	var css strings.Builder
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == html.TextNode {
			css.WriteString(child.Data)
		}
	}
	for child := node.FirstChild; child != nil; {
		next := child.NextSibling
		node.RemoveChild(child)
		child = next
	}
	cleaned := sanitizeCSS(css.String(), options, result)
	//A literal "</style" inside the text would end the element early
	cleaned = strings.ReplaceAll(cleaned, "</", "<\\/")
	node.AppendChild(&html.Node{Type: html.TextNode, Data: cleaned})
}

// sanitizeCSS neutralises legacy script hooks and controls url() loads.
func sanitizeCSS(css string, options sanitizeOptions, result *sanitizeResult) string {
	css = cssDangerPattern.ReplaceAllString(css, "blocked-")
	if cssImportPattern.MatchString(css) {
		result.hasRemote = true
		css = cssImportPattern.ReplaceAllString(css, "")
	}
	return cssURLPattern.ReplaceAllStringFunc(css, func(match string) string {
		groups := cssURLPattern.FindStringSubmatch(match)
		raw := ""
		for _, group := range groups[1:] {
			if group != "" {
				raw = group
				break
			}
		}
		resolved, remote, ok := resolveImageURL(raw, options)
		if remote {
			result.hasRemote = true
			if !options.allowRemote {
				return "none"
			}
		}
		if !ok {
			return "none"
		}
		return `url("` + strings.ReplaceAll(resolved, `"`, "%22") + `")`
	})
}

// safeLinkURL accepts absolute web, mail and phone links and in-page anchors.
func safeLinkURL(raw string) (string, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", false
	}
	if strings.HasPrefix(value, "#") {
		return value, true
	}
	lower := strings.ToLower(stripControlChars(value))
	for _, scheme := range []string{"http://", "https://", "mailto:", "tel:", "sms:", "ftp://"} {
		if strings.HasPrefix(lower, scheme) {
			return value, true
		}
	}
	//Protocol-relative links default to https
	if strings.HasPrefix(lower, "//") {
		return "https:" + value, true
	}
	return "", false
}

// resolveImageURL decides what an image reference becomes. remote reports a
// network fetch; ok reports whether the (possibly rewritten) value may stay.
func resolveImageURL(raw string, options sanitizeOptions) (resolved string, remote bool, ok bool) {
	value := strings.TrimSpace(raw)
	lower := strings.ToLower(stripControlChars(value))
	switch {
	case value == "":
		return "", false, false
	case strings.HasPrefix(lower, "cid:"):
		id := strings.ToLower(strings.Trim(strings.TrimSpace(value[4:]), "<>"))
		if data, found := options.cid[id]; found {
			return data, false, true
		}
		return "", false, false
	case strings.HasPrefix(lower, "data:image/"):
		return value, false, true
	case strings.HasPrefix(lower, "http://"), strings.HasPrefix(lower, "https://"):
		return value, true, true
	case strings.HasPrefix(lower, "//"):
		return "https:" + value, true, true
	}
	return "", false, false
}

func stripControlChars(value string) string {
	return strings.Map(func(r rune) rune {
		if r <= 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, value)
}
