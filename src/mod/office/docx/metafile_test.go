package docx

import (
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/internal/officetest"
)

func TestDocxEmfPictureIsRendered(t *testing.T) {
	emf := officetest.BuildEmf(10, 10, append(officetest.EmfSolidBrush(1, officetest.MfBlue), officetest.EmfRecBytes(43, []int64{0, 0, 50, 50}, nil))...)
	rels := `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/p.emf"/></Relationships>`
	body := `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="508000" cy="508000"/>` +
		`<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill>` +
		`</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
	zipData := testDocx(t, body, map[string]string{"word/_rels/document.xml.rels": rels})
	doc := parseDocxWithMedia(t, zipData, "word/media/p.emf", emf)
	if !strings.Contains(doc.HTML, `<img src="data:image/png;base64,`) {
		t.Errorf("EMF picture not imported as PNG: %.300s", doc.HTML)
	}
}
