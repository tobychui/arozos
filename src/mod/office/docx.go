package office

/*
	docx.go - shared types for the Word (.docx) converters used by the
	Docs webapp (src/web/Office/docs). The JSON model mirrors the Docs
	body schema documented in docs.js:

	    { "html": "<p>...</p>", "page": { "size": "A4", "orientation":
	      "portrait", "margins": {top,right,bottom,left} },  // mm
	      "header": "text", "footer": "text", "pageNumbers": false }

	Legacy binary .doc (Word 97) is intentionally not supported.
*/

import (
	"encoding/json"
	"errors"
)

// Document is the Docs document body
type Document struct {
	HTML        string    `json:"html"`
	Page        *PageConf `json:"page,omitempty"`
	Header      string    `json:"header,omitempty"`
	Footer      string    `json:"footer,omitempty"`
	PageNumbers bool      `json:"pageNumbers,omitempty"`
}

// PageConf holds page geometry (margins in millimetres)
type PageConf struct {
	Size        string     `json:"size,omitempty"`        // A4 | Letter | Legal
	Orientation string     `json:"orientation,omitempty"` // portrait | landscape
	Margins     *MarginsMM `json:"margins,omitempty"`
	Columns     int        `json:"columns,omitempty"` // text columns (0/1 = single)
	ColGap      float64    `json:"colGap,omitempty"`  // gap between columns, mm
}

// MarginsMM holds page margins in millimetres
type MarginsMM struct {
	Top    float64 `json:"top"`
	Right  float64 `json:"right"`
	Bottom float64 `json:"bottom"`
	Left   float64 `json:"left"`
}

// ParseDocumentJSON decodes the Docs body JSON into a Document
func ParseDocumentJSON(jsonStr string) (*Document, error) {
	d := Document{}
	if err := json.Unmarshal([]byte(jsonStr), &d); err != nil {
		return nil, errors.New("invalid document JSON: " + err.Error())
	}
	return &d, nil
}

// DocumentToJSON serializes a Document back to the Docs body JSON
func DocumentToJSON(d *Document) (string, error) {
	if d == nil {
		return "", errors.New("nil document")
	}
	out, err := json.Marshal(d)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

/* ---------- unit helpers ---------- */

// twips (twentieths of a point): 1 mm = 56.6929 twips
func mmToTwips(mm float64) int { return int(mm * 1440.0 / 25.4) }
func twipsToMm(tw int) float64 { return float64(tw) * 25.4 / 1440.0 }

// page sizes in twips (portrait)
var pageSizesTwips = map[string][2]int{
	"A4":     {11906, 16838},
	"Letter": {12240, 15840},
	"Legal":  {12240, 20160},
}

// px (96dpi) -> half-points for w:sz
func pxToHalfPoints(px float64) int { return int(px * 0.75 * 2) }
func halfPointsToPx(hp float64) float64 {
	return hp / 2.0 / 0.75
}
