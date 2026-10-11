package htmlutil

import (
	"strconv"
	"strings"

	"golang.org/x/net/html"
	"imuslab.com/arozos/mod/office/internal/media"
)

// ImageSizePx mirrors the docx sizing rules (attrs/style, natural
// aspect fallback, text-width cap)
func ImageSizePx(n *html.Node, data []byte) (float64, float64) {
	natW, natH := 0, 0
	if cfg, _, err := media.ImageConfig(data); err == nil {
		natW, natH = cfg.Width, cfg.Height
	}
	px := func(name string) float64 {
		if a := Attr(n, name); a != "" {
			if v, err := strconv.ParseFloat(strings.TrimSuffix(a, "px"), 64); err == nil && v > 0 {
				return v
			}
		}
		if s := StyleProp(Attr(n, "style"), name); strings.HasSuffix(s, "px") {
			if v, err := strconv.ParseFloat(strings.TrimSuffix(s, "px"), 64); err == nil && v > 0 {
				return v
			}
		}
		return 0
	}
	w, h := px("width"), px("height")
	switch {
	case w > 0 && h <= 0:
		if natW > 0 && natH > 0 {
			h = w * float64(natH) / float64(natW)
		} else {
			h = w * 3 / 4
		}
	case h > 0 && w <= 0:
		if natW > 0 && natH > 0 {
			w = h * float64(natW) / float64(natH)
		} else {
			w = h * 4 / 3
		}
	case w <= 0 && h <= 0:
		if natW > 0 && natH > 0 {
			w, h = float64(natW), float64(natH)
		} else {
			w, h = 400, 300
		}
	}
	if w > 620 {
		h = h * 620 / w
		w = 620
	}
	return w, h
}
