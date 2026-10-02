package email

import (
	"bytes"
	"strings"
	"testing"

	"github.com/emersion/go-imap/v2"
	gomessage "github.com/emersion/go-message"
)

func TestDecodeTransfer(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		encoding string
		partial  bool
		want     string
	}{
		{"base64", "SGVsbG8gV29ybGQ=", "base64", false, "Hello World"},
		{"base64 with line breaks", "SGVs\r\nbG8g\r\nV29y\r\nbGQ=", "BASE64", false, "Hello World"},
		{"base64 truncated preview", "SGVsbG8gV29yb", "base64", true, "Hello Wor"},
		{"quoted printable", "caf=C3=A9 =\r\nsoft", "quoted-printable", false, "café soft"},
		{"plain passes through", "as is", "7bit", false, "as is"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := string(decodeTransfer([]byte(test.input), test.encoding, test.partial)); got != test.want {
				t.Errorf("decodeTransfer = %q, want %q", got, test.want)
			}
		})
	}
}

func TestDecodeCharset(t *testing.T) {
	tests := []struct {
		name    string
		input   []byte
		charset string
		want    string
	}{
		{"utf-8", []byte("中文"), "UTF-8", "中文"},
		{"gb2312", []byte{0xd6, 0xd0, 0xce, 0xc4}, "gb2312", "中文"},
		{"big5", []byte{0xa4, 0xa4, 0xa4, 0xe5}, "big5", "中文"},
		{"latin1", []byte{0x63, 0x61, 0x66, 0xe9}, "iso-8859-1", "café"},
		{"unknown charset is kept", []byte("plain"), "x-unknown", "plain"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := decodeCharset(test.input, test.charset); got != test.want {
				t.Errorf("decodeCharset = %q, want %q", got, test.want)
			}
		})
	}
}

func TestRFC2231Filenames(t *testing.T) {
	tests := []struct {
		name   string
		params map[string]string
		want   string
	}{
		{"plain", map[string]string{"filename": "a.pdf"}, "a.pdf"},
		{"extended", map[string]string{"filename*": "utf-8''%E5%A0%B1%E5%91%8A.pdf"}, "報告.pdf"},
		{"continuations", map[string]string{"filename*0*": "utf-8''%E5%A0%B1", "filename*1*": "%E5%91%8A", "filename*2": ".pdf"}, "報告.pdf"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := rfc2231Param(test.params, "filename"); got != test.want {
				t.Errorf("rfc2231Param = %q, want %q", got, test.want)
			}
		})
	}
}

func TestSanitizeFilename(t *testing.T) {
	tests := map[string]string{
		"../../etc/passwd": "_.._etc_passwd",
		"a:b*c?.txt":       "a_b_c_.txt",
		"  .hidden  ":      "hidden",
		"":                 "attachment",
		"報告 (final).docx":  "報告 (final).docx",
	}
	for input, want := range tests {
		if got := sanitizeFilename(input); got != want {
			t.Errorf("sanitizeFilename(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSelectDisplayParts(t *testing.T) {
	raw := "Content-Type: multipart/signed; boundary=s; protocol=\"application/pkcs7-signature\"\r\n\r\n" +
		"--s\r\nContent-Type: multipart/alternative; boundary=a\r\n\r\n" +
		"--a\r\nContent-Type: text/plain\r\n\r\nplain\r\n" +
		"--a\r\nContent-Type: text/watch-html\r\n\r\nwatch\r\n" +
		"--a\r\nContent-Type: text/html\r\n\r\n<b>rich</b>\r\n" +
		"--a--\r\n" +
		"--s\r\nContent-Type: application/pkcs7-signature; name=smime.p7s\r\nContent-Disposition: attachment; filename=smime.p7s\r\n\r\nsig\r\n" +
		"--s--\r\n"
	entity, err := gomessage.Read(strings.NewReader(raw))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	parts := selectDisplayParts(treeFromEntity(entity))
	if parts.html == nil || !bytes.Contains(parts.html.body, []byte("rich")) {
		t.Errorf("html part not selected")
	}
	if parts.text == nil || !bytes.Contains(parts.text.body, []byte("plain")) {
		t.Errorf("text alternative not kept")
	}
	if !parts.signed {
		t.Errorf("signed message not detected")
	}
	if len(parts.attachments) != 0 {
		t.Errorf("signature should not be listed as an attachment: %+v", parts.attachments)
	}
}

func TestTreeFromBodyStructurePaths(t *testing.T) {
	structure := &imap.BodyStructureMultiPart{
		Subtype: "mixed",
		Children: []imap.BodyStructure{
			&imap.BodyStructureMultiPart{
				Subtype: "alternative",
				Children: []imap.BodyStructure{
					&imap.BodyStructureSinglePart{Type: "text", Subtype: "plain", Params: map[string]string{"charset": "utf-8"}},
					&imap.BodyStructureSinglePart{Type: "text", Subtype: "html"},
				},
			},
			&imap.BodyStructureSinglePart{
				Type: "application", Subtype: "pdf", Encoding: "base64", Size: 400,
				Extended: &imap.BodyStructureSinglePartExt{Disposition: &imap.BodyStructureDisposition{Value: "attachment", Params: map[string]string{"filename": "a.pdf"}}},
			},
		},
	}
	tree := treeFromBodyStructure(structure)
	parts := selectDisplayParts(tree)
	if parts.text == nil || parts.text.Path != "1.1" || parts.html == nil || parts.html.Path != "1.2" {
		t.Fatalf("unexpected display parts %+v", parts)
	}
	attachments := attachmentInfo(parts.attachments)
	if len(attachments) != 1 || attachments[0].ID != "2" || attachments[0].Size != 300 {
		t.Errorf("attachments = %+v", attachments)
	}
	if !hasRealAttachments(tree) {
		t.Errorf("hasRealAttachments = false")
	}

	single := treeFromBodyStructure(&imap.BodyStructureSinglePart{Type: "text", Subtype: "plain"})
	if single.Path != "1" {
		t.Errorf("single part path = %q, want 1", single.Path)
	}
}

func TestDuplicateAttachmentNames(t *testing.T) {
	parts := []*mimePart{
		{Path: "2", Type: "image", Subtype: "png", DispParams: map[string]string{"filename": "photo.png"}},
		{Path: "3", Type: "image", Subtype: "png", DispParams: map[string]string{"filename": "photo.png"}},
	}
	info := attachmentInfo(parts)
	if info[0].Filename != "photo.png" || info[1].Filename != "photo (2).png" {
		t.Errorf("names = %s, %s", info[0].Filename, info[1].Filename)
	}
}

func TestPriorityParsing(t *testing.T) {
	tests := []struct {
		xPriority, importance, priority string
		want                            int
	}{
		{"1 (Highest)", "", "", 1},
		{"2", "", "", 1},
		{"3 (Normal)", "", "", 3},
		{"5", "", "", 5},
		{"", "High", "", 1},
		{"", "low", "", 5},
		{"", "", "urgent", 1},
		{"", "", "", 3},
	}
	for _, test := range tests {
		if got := priorityFromFields(test.xPriority, test.importance, test.priority); got != test.want {
			t.Errorf("priority(%q,%q,%q) = %d, want %d", test.xPriority, test.importance, test.priority, got, test.want)
		}
	}
}

func TestParseAuthResults(t *testing.T) {
	results := parseAuthResults([]string{"mx.google.com; dkim=fail header.d=a; dkim=pass header.d=b; spf=softfail smtp.mailfrom=c; dmarc=fail (p=NONE)"})
	if results == nil || results.DKIM != "pass" || results.SPF != "softfail" || results.DMARC != "fail" {
		t.Errorf("parseAuthResults = %+v", results)
	}
	if parseAuthResults(nil) != nil {
		t.Errorf("no header should give nil")
	}
}

func TestBaseSubject(t *testing.T) {
	tests := map[string]string{
		"Re: Re: Hello":     "Hello",
		"FW: Fwd: Report":   "Report",
		"回复：会议":             "会议",
		"Re[2]: Status":     "Status",
		"Regarding budgets": "Regarding budgets",
	}
	for input, want := range tests {
		if got := baseSubject(input); got != want {
			t.Errorf("baseSubject(%q) = %q, want %q", input, got, want)
		}
	}
}
