package pptx

import (
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/internal/officetest"
)

/* ---------------- import integration ---------------- */

func TestPptxWmfPictureIsRendered(t *testing.T) {
	wmf := officetest.BuildWmf([4]int{0, 0, 8, 8}, 96,
		officetest.WmfRec(0x0B41, []int{0x0020, 0x00CC, 8, 8, 0, 0, 8, 8, 0, 0}, officetest.Dib24(8, 8, officetest.Quadrants(8, 8))))
	pic := `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 5"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
		`<p:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
		`<p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic>`
	objs := parseOneSlide(t, pptxParts{
		slides:    []string{pic},
		slideRels: map[string]string{"rId9": "../media/image2.wmf"},
		media:     map[string][]byte{"ppt/media/image2.wmf": wmf},
	})
	if len(objs) != 1 || objs[0].Type != "image" {
		t.Fatalf("objects = %+v, want one image", objs)
	}
	if src := objs[0].Props.Src; !strings.HasPrefix(src, "data:image/jpeg;base64,") {
		t.Errorf("src = %.40s..., want a JPEG data URL", src)
	}
}
