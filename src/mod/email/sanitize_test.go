package email

import (
	"strings"
	"testing"
)

func TestSanitizeHTML(t *testing.T) {
	cid := map[string]string{"logo@x": "data:image/png;base64,AAAA"}
	tests := []struct {
		name        string
		input       string
		allowRemote bool
		contains    []string
		absent      []string
		remote      bool
	}{
		{
			name:   "script and handlers removed",
			input:  `<p onclick="x()" onmouseover='y()'>Hi</p><script>alert(1)</script><noscript>n</noscript>`,
			absent: []string{"onclick", "onmouseover", "<script", "alert(1)", "<noscript"},
		},
		{
			name:     "dangerous links dropped, safe links get a new tab",
			input:    `<a href="javascript:alert(1)">a</a><a href="  JaVa&#10;script:alert(2)">b</a><a href="https://ok.test/">c</a><a href="/system/x">d</a><a href="mailto:a@b.c">e</a>`,
			contains: []string{`href="https://ok.test/"`, `target="_blank"`, `rel="noopener noreferrer nofollow"`, `href="mailto:a@b.c"`},
			absent:   []string{"javascript", "/system/x"},
		},
		{
			name:     "remote image blocked by default",
			input:    `<img src="https://t.test/p.gif" width="1">`,
			contains: []string{`data-remote-src="https://t.test/p.gif"`},
			absent:   []string{` src="https://t.test/p.gif"`},
			remote:   true,
		},
		{
			name:        "remote image allowed",
			input:       `<img src="https://t.test/p.gif">`,
			allowRemote: true,
			contains:    []string{`src="https://t.test/p.gif"`},
			remote:      true,
		},
		{
			name:     "cid image resolved",
			input:    `<img src="cid:LOGO@x">`,
			contains: []string{`src="data:image/png;base64,AAAA"`},
		},
		{
			name:     "style urls and imports blocked",
			input:    `<style>@import url("https://evil.test/a.css"); .a{background:url(https://t.test/bg.png)}</style><div style="background-image:url('https://t.test/x.png');color:red">x</div>`,
			contains: []string{"color:red", "background:none", "background-image:none"},
			absent:   []string{"@import", "t.test", "evil.test"},
			remote:   true,
		},
		{
			name:   "frames, forms and meta removed",
			input:  `<meta http-equiv="refresh" content="0;url=https://x.test"><iframe src="https://x.test"></iframe><form action="https://x.test"><input name="p"><button>Go</button></form><base href="https://x.test/">`,
			absent: []string{"<iframe", "<meta", "<input", "<form", "action=", "<base", "x.test"},
		},
		{
			name:     "form contents are kept",
			input:    `<form><p>Inside</p><button>Label</button></form>`,
			contains: []string{"<p>Inside</p>", "Label"},
		},
		{
			name:   "svg and comments removed",
			input:  `<svg onload="x()"><script>1</script></svg><!--[if mso]><table></table><![endif]-->ok`,
			absent: []string{"<svg", "onload", "[if mso]"},
		},
		{
			name:   "style element cannot be closed early",
			input:  `<style>p{color:red}</style><p>x</p>`,
			absent: []string{"behavior"},
		},
		{
			name:     "legacy css expressions neutralised",
			input:    `<div style="width:expression(alert(1));behavior:url(x.htc)">x</div>`,
			absent:   []string{"expression(", "behavior:"},
			contains: []string{"blocked-"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := sanitizeHTML(test.input, sanitizeOptions{allowRemote: test.allowRemote, cid: cid})
			for _, want := range test.contains {
				if !strings.Contains(result.html, want) {
					t.Errorf("missing %q in %s", want, result.html)
				}
			}
			for _, unwanted := range test.absent {
				if strings.Contains(result.html, unwanted) {
					t.Errorf("unexpected %q in %s", unwanted, result.html)
				}
			}
			if result.hasRemote != test.remote {
				t.Errorf("hasRemote = %v, want %v", result.hasRemote, test.remote)
			}
		})
	}
}

func TestHTMLToText(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		withLinks bool
		want      string
	}{
		{"paragraphs", "<p>Hello</p><p>World</p>", false, "Hello\n\nWorld"},
		{"line breaks and entities", "Tom &amp; Jerry<br>next&nbsp;line", false, "Tom & Jerry\nnext line"},
		{"head and style skipped", "<html><head><title>T</title><style>p{}</style></head><body>Body</body></html>", false, "Body"},
		{"lists", "<ul><li>One</li><li>Two</li></ul>", false, "- One\n- Two"},
		{"links appended", `<a href="https://a.test/x">Click</a>`, true, "Click (https://a.test/x)"},
		{"bare link not duplicated", `<a href="https://a.test/">https://a.test/</a>`, true, "https://a.test/"},
		{"preformatted", "<pre>a  b\n c</pre>", false, "a  b\n c"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := htmlToText(test.input, test.withLinks); got != test.want {
				t.Errorf("htmlToText = %q, want %q", got, test.want)
			}
		})
	}
}

func TestPreviewText(t *testing.T) {
	text := "Thanks!\n> quoted line\n> another\nSee you"
	if got := previewText(text, 100); got != "Thanks! See you" {
		t.Errorf("previewText = %q", got)
	}
	if got := previewText(strings.Repeat("a", 50), 10); got != strings.Repeat("a", 10)+"…" {
		t.Errorf("truncation = %q", got)
	}
}

func TestUnflowText(t *testing.T) {
	flowed := "This is a long \r\nline that wraps.\r\n Stuffed\r\n-- \r\nSig"
	want := "This is a long line that wraps.\nStuffed\n-- \nSig"
	if got := unflowText(flowed, false); got != want {
		t.Errorf("unflowText = %q, want %q", got, want)
	}
	if got := unflowText("ab \r\ncd", true); got != "abcd" {
		t.Errorf("delsp unflow = %q", got)
	}
}
