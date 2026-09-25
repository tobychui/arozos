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
		{"plain ascii", "HelloWorld.docx", "HelloWorld.docx"},
		{"spaces", "Q3 Report.xlsx", "Q3 Report.xlsx"},
		{"quotes", `say "hi".pptx`, `say "hi".pptx`},
		{"non ascii", "報告書.docx", "報告書.docx"},
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
