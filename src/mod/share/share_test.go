package share

import (
	"mime"
	"testing"
)

func TestPreviewDisposition(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		want     string // expected filename after parsing the header back; "" = no header
	}{
		{"plain ascii", "HelloWorld.doca", "HelloWorld.doca"},
		{"spaces", "Q3 Report.xlsa", "Q3 Report.xlsa"},
		{"quotes", `say "hi".ppta`, `say "hi".ppta`},
		{"non ascii", "報告書.doca", "報告書.doca"},
		{"empty", "", ""},
		{"dot", ".", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			header := previewDisposition(tc.filename)
			if tc.want == "" {
				if header != "" {
					t.Errorf("previewDisposition(%q) = %q, want no header", tc.filename, header)
				}
				return
			}
			disposition, params, err := mime.ParseMediaType(header)
			if err != nil {
				t.Fatalf("previewDisposition(%q) = %q, which does not parse: %v", tc.filename, header, err)
			}
			if disposition != "inline" {
				t.Errorf("disposition = %q, want inline", disposition)
			}
			if params["filename"] != tc.want {
				t.Errorf("filename = %q, want %q (header %q)", params["filename"], tc.want, header)
			}
		})
	}
}
