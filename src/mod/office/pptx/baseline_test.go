package pptx

import (
	"strings"
	"testing"
)

func TestPptxRunBaselines(t *testing.T) {
	cases := []struct {
		name, html string
		want       []string // in the slide XML
		wantCSS    string   // in the text read back
	}{
		{
			"tags from the editor",
			`<div>E = mc<sup>2</sup> and H<sub>2</sub>O</div>`,
			[]string{`baseline="30000"`, `baseline="-25000"`},
			"vertical-align:super",
		},
		{
			// what the reader wrote for a raised run: the size goes back
			// at full size, PowerPoint shrinks it itself
			"a run the reader drew",
			`<div><span style="font-size:24px;">x</span><span style="vertical-align:super;font-size:15.6px;">2</span></div>`,
			[]string{`baseline="30000"`},
			"vertical-align:super",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			slide, back := writeOneObject(t, textObj(c.html, nil))
			for _, w := range c.want {
				if !strings.Contains(slide, w) {
					t.Errorf("slide XML lacks %s:\n%s", w, slide)
				}
			}
			if strings.Count(slide, `sz="1800"`) < 2 {
				t.Errorf("a raised run lost its size (want sz=1800 on both runs):\n%s", slide)
			}
			if !strings.Contains(back.Props.HTML, c.wantCSS) {
				t.Errorf("read back without %s: %s", c.wantCSS, back.Props.HTML)
			}
		})
	}
}
