package office

/*
	pptx_writer.go - Build a PowerPoint (.pptx) file from a Presentation.

	The generated package contains the minimum part set PowerPoint and
	LibreOffice require: [Content_Types].xml, root rels, presentation.xml,
	one slide master + layout + theme, and one slide part per slide.

	Mapping notes:
	  - The Slides coordinate space (960x540 px @96dpi) is written as a
	    9144000 x 5143500 EMU custom slide size (10.0" x 5.625", 16:9).
	  - text/shape rich HTML is flattened to plain-text paragraph runs with
	    object-level bold/italic/underline/color/size formatting.
	  - chart objects must carry a client-rendered PNG in props.png; they are
	    exported as pictures (native pptx charts are out of scope).
	  - images must be data URLs (the webapp inlines them before export).
*/

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"sort"
	"strings"
)

const nsDecl = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`

// shapeKindToPrst carries the three names the editor used before its shape
// catalogue existed. A .ppta written back then still says them, and export
// has to keep working; everything else is its own preset name already, and
// shapeKindPrst falls through to that.
var shapeKindToPrst = map[string]string{
	"round": "roundRect",
	"arrow": "rightArrow",
	"star":  "star5",
}

// shapeKindPrst is the preset to write for an editor shape kind, and
// "rect" for one this package has never heard of.
func shapeKindPrst(kind string) string {
	if p, ok := shapeKindToPrst[kind]; ok {
		return p
	}
	if _, ok := prstToShapeKind[kind]; ok {
		return kind
	}
	return "rect"
}

// BuildPptx serializes a Presentation without a media resolver (video /
// audio objects render as poster pictures; media?file= sources cannot be
// collected into a sidecar without a resolver)
func BuildPptx(p *Presentation) ([]byte, error) {
	data, _, err := BuildPptxMedia(p, nil)
	return data, err
}

// BuildPptxMedia serializes a Presentation. Video/audio objects are drawn
// as poster pictures (the client-captured frame in props.png, or a
// generated placeholder) - embedded pptx media proved unreliable across
// players, so instead the media files themselves are returned as a zip
// (second return value, nil when the deck has none) for the caller to
// save next to the .pptx. readVpath (optional) resolves media?file= links.
func BuildPptxMedia(p *Presentation, readVpath func(string) ([]byte, error)) ([]byte, []byte, error) {
	if p == nil || len(p.Slides) == 0 {
		return nil, nil, errors.New("presentation has no slides")
	}

	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	addFile := func(name, content string) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write([]byte(content))
		return err
	}
	addBinFile := func(name string, content []byte) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write(content)
		return err
	}

	// ---- static package parts ----
	if err := addFile("_rels/.rels", pptxRootRels); err != nil {
		return nil, nil, err
	}
	if err := addFile("docProps/core.xml", pptxCoreProps); err != nil {
		return nil, nil, err
	}
	if err := addFile("docProps/app.xml", pptxAppProps); err != nil {
		return nil, nil, err
	}
	if err := addFile("ppt/theme/theme1.xml", pptxTheme); err != nil {
		return nil, nil, err
	}
	if err := addFile("ppt/slideMasters/slideMaster1.xml", pptxSlideMaster); err != nil {
		return nil, nil, err
	}
	if err := addFile("ppt/slideMasters/_rels/slideMaster1.xml.rels", pptxSlideMasterRels); err != nil {
		return nil, nil, err
	}
	if err := addFile("ppt/slideLayouts/slideLayout1.xml", pptxSlideLayout); err != nil {
		return nil, nil, err
	}
	if err := addFile("ppt/slideLayouts/_rels/slideLayout1.xml.rels", pptxSlideLayoutRels); err != nil {
		return nil, nil, err
	}

	// ---- presentation.xml + its rels ----
	var sldIds, presRels strings.Builder
	presRels.WriteString(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`)
	for i := range p.Slides {
		rid := fmt.Sprintf("rId%d", i+2)
		sldIds.WriteString(fmt.Sprintf(`<p:sldId id="%d" r:id="%s"/>`, 256+i, rid))
		presRels.WriteString(fmt.Sprintf(`<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%d.xml"/>`, rid, i+1))
	}
	presentation := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<p:presentation ` + nsDecl + `>` +
		`<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
		`<p:sldIdLst>` + sldIds.String() + `</p:sldIdLst>` +
		fmt.Sprintf(`<p:sldSz cx="%d" cy="%d"/>`, pxToEmu(slidePxW), pxToEmu(slidePxH)) +
		`<p:notesSz cx="6858000" cy="9144000"/>` +
		`</p:presentation>`
	if err := addFile("ppt/presentation.xml", presentation); err != nil {
		return nil, nil, err
	}
	if err := addFile("ppt/_rels/presentation.xml.rels",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+"\n"+
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
			presRels.String()+`</Relationships>`); err != nil {
		return nil, nil, err
	}

	// ---- slides + media ----
	mediaCount := 0
	var mediaExts []string
	var sidecar []sidecarFile
	for i, slide := range p.Slides {
		slideXML, slideRels, media, slideSidecar, err := buildSlideXML(p, slide, &mediaCount, readVpath)
		if err != nil {
			return nil, nil, err
		}
		sidecar = append(sidecar, slideSidecar...)
		if err := addFile(fmt.Sprintf("ppt/slides/slide%d.xml", i+1), slideXML); err != nil {
			return nil, nil, err
		}
		if err := addFile(fmt.Sprintf("ppt/slides/_rels/slide%d.xml.rels", i+1), slideRels); err != nil {
			return nil, nil, err
		}
		for _, m := range media {
			if err := addBinFile(fmt.Sprintf("ppt/media/image%d.%s", m.index, m.ext), m.data); err != nil {
				return nil, nil, err
			}
			mediaExts = append(mediaExts, m.ext)
		}
	}

	// ---- content types (needs the media extension list) ----
	if err := addFile("[Content_Types].xml", buildContentTypes(len(p.Slides), mediaExts)); err != nil {
		return nil, nil, err
	}

	if err := zw.Close(); err != nil {
		return nil, nil, err
	}
	sidecarZip, err := buildSidecarZip(sidecar)
	if err != nil {
		return nil, nil, err
	}
	return buf.Bytes(), sidecarZip, nil
}

type mediaEntry struct {
	index int
	ext   string
	data  []byte
}

// sidecarFile is one video/audio file collected for the sidecar zip
// written next to the exported .pptx
type sidecarFile struct {
	name string
	data []byte
}

// buildSlideXML renders one slide part plus its .rels, media payloads and
// the video/audio files destined for the sidecar zip
func buildSlideXML(p *Presentation, slide *Slide, mediaCount *int, readVpath func(string) ([]byte, error)) (string, string, []mediaEntry, []sidecarFile, error) {
	var sb strings.Builder
	var rels strings.Builder
	var media []mediaEntry
	var sidecar []sidecarFile

	rels.WriteString(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`)
	relIdx := 2

	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	sb.WriteString(`<p:sld ` + nsDecl + `><p:cSld>`)

	// slide background: explicit color, else theme approximation
	bg := slide.Bg
	if bg == "" {
		bg = "#" + themeBgColor(p.Theme)
	}
	sb.WriteString(`<p:bg><p:bgPr><a:solidFill><a:srgbClr val="` + hexColor(bg, "FFFFFF") + `"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`)

	sb.WriteString(`<p:spTree>` +
		`<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
		`<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`)

	// render objects in z / array order
	objs := make([]*Object, len(slide.Objects))
	copy(objs, slide.Objects)
	sort.SliceStable(objs, func(a, b int) bool { return objs[a].Z < objs[b].Z })

	shapeID := 2
	for _, o := range objs {
		if o == nil {
			continue
		}
		switch o.Type {
		case "text":
			sb.WriteString(buildTextSp(shapeID, o, p.Theme))
		case "shape":
			sb.WriteString(buildShapeSp(shapeID, o))
		case "line":
			sb.WriteString(buildLineSp(shapeID, o))
		case "table":
			sb.WriteString(buildTableFrame(shapeID, o))
		case "image", "chart":
			durl := o.Props.Src
			if o.Type == "chart" {
				durl = o.Props.Png
			}
			data, ext, ok := decodeDataURL(durl)
			if !ok {
				// image not inlined (remote URL etc.) - skip it silently
				continue
			}
			*mediaCount++
			rid := fmt.Sprintf("rId%d", relIdx)
			relIdx++
			rels.WriteString(fmt.Sprintf(`<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image%d.%s"/>`, rid, *mediaCount, ext))
			media = append(media, mediaEntry{index: *mediaCount, ext: ext, data: data})
			sb.WriteString(buildPicSp(shapeID, o, rid))
		case "video", "audio":
			// media is NOT embedded in the pptx (playback support across
			// PowerPoint / Google Slides proved unreliable): the slide
			// shows a poster picture - the client-captured video frame
			// (props.png) or a generated placeholder - and the media file
			// itself goes into the sidecar zip saved next to the .pptx
			posterData, posterExt := mediaPosterPNG(), "png"
			if pd, pe, pok := decodeDataURL(o.Props.Png); pok && (pe == "png" || pe == "jpeg") {
				posterData, posterExt = pd, pe
			}
			*mediaCount++
			rid := fmt.Sprintf("rId%d", relIdx)
			relIdx++
			rels.WriteString(fmt.Sprintf(`<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image%d.%s"/>`, rid, *mediaCount, posterExt))
			media = append(media, mediaEntry{index: *mediaCount, ext: posterExt, data: posterData})
			sb.WriteString(buildPicSp(shapeID, o, rid))
			if data, ext, ok := mediaSrcBytes(o.Props.Src, o.Type, readVpath); ok {
				sidecar = append(sidecar,
					sidecarFile{name: sidecarName(o.Props.Src, len(sidecar)+1, ext), data: data})
			}
		default:
			continue
		}
		shapeID++
	}

	sb.WriteString(`</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)

	relXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		rels.String() + `</Relationships>`
	return sb.String(), relXML, media, sidecar, nil
}

/* ---------- video / audio (sidecar) ---------- */

// pathBaseOf returns the last element of a virtual path
func pathBaseOf(p string) string {
	p = strings.TrimRight(p, "/")
	if i := strings.LastIndexAny(p, "/\\"); i >= 0 {
		return p[i+1:]
	}
	return p
}

// sidecarName picks the filename a media file gets inside the sidecar
// zip: the original basename for media?file= links, media<N>.<ext> for
// data-URL sources
func sidecarName(src string, n int, ext string) string {
	if vp := mediaLinkVpath(src); vp != "" {
		if base := pathBaseOf(vp); base != "" {
			return base
		}
	}
	return fmt.Sprintf("media%d.%s", n, ext)
}

// buildSidecarZip packs the collected media files into a zip; returns
// nil when there is nothing to pack
func buildSidecarZip(files []sidecarFile) ([]byte, error) {
	if len(files) == 0 {
		return nil, nil
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	seen := map[string]bool{}
	for i, f := range files {
		name := f.name
		if seen[name] {
			name = fmt.Sprintf("%d_%s", i+1, name)
		}
		seen[name] = true
		w, err := zw.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(f.data); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// subtype -> file extension for media data URLs
var mediaExtBySubtype = map[string]string{
	"mp4": "mp4", "webm": "webm", "ogg": "ogg", "quicktime": "mov",
	"mpeg": "mp3", "mp3": "mp3", "wav": "wav", "x-wav": "wav",
	"x-m4a": "m4a", "mp4a-latm": "m4a", "aac": "aac",
}

// mediaSrcBytes resolves a video/audio object's src: either a
// data:video|audio;base64 URL or an in-app media?file= link (through the
// caller-supplied vpath reader)
func mediaSrcBytes(src, kind string, readVpath func(string) ([]byte, error)) ([]byte, string, bool) {
	if strings.HasPrefix(src, "data:video/") || strings.HasPrefix(src, "data:audio/") {
		comma := strings.Index(src, ",")
		if comma < 0 || !strings.Contains(src[:comma], ";base64") {
			return nil, "", false
		}
		sub := src[len("data:"):comma]
		sub = sub[strings.Index(sub, "/")+1:]
		if i := strings.IndexAny(sub, ";+"); i >= 0 {
			sub = sub[:i]
		}
		ext, ok := mediaExtBySubtype[strings.ToLower(sub)]
		if !ok {
			if kind == "audio" {
				ext = "mp3"
			} else {
				ext = "mp4"
			}
		}
		raw, err := base64.StdEncoding.DecodeString(src[comma+1:])
		if err != nil {
			return nil, "", false
		}
		return raw, ext, true
	}
	if vp := mediaLinkVpath(src); vp != "" && readVpath != nil {
		data, err := readVpath(vp)
		if err != nil || len(data) == 0 {
			return nil, "", false
		}
		ext := strings.TrimPrefix(strings.ToLower(pathExtOf(vp)), ".")
		if _, ok := mediaExtBySubtype[ext]; !ok && ext != "mp4" && ext != "webm" &&
			ext != "m4a" && ext != "mov" {
			if kind == "audio" {
				ext = "mp3"
			} else {
				ext = "mp4"
			}
		}
		return data, ext, true
	}
	return nil, "", false
}

var mediaPosterCache []byte

// mediaPosterPNG draws the dark poster frame (with a play triangle) shown
// where an embedded video/audio sits before playback
func mediaPosterPNG() []byte {
	if mediaPosterCache != nil {
		return mediaPosterCache
	}
	const w, h = 480, 270
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	bg := color.RGBA{32, 33, 36, 255}
	tri := color.RGBA{232, 234, 237, 255}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, bg)
		}
	}
	// centered play triangle
	cx, cy, size := w/2, h/2, 40
	for dx := -size / 2; dx <= size/2; dx++ {
		half := (size/2 - dx) * size / (size + 2) / 2
		for dy := -half; dy <= half; dy++ {
			img.Set(cx+dx, cy+dy, tri)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return []byte{}
	}
	mediaPosterCache = buf.Bytes()
	return mediaPosterCache
}

func themeBgColor(theme string) string {
	if c, ok := themeBg[theme]; ok {
		return c
	}
	return "FFFFFF"
}

func themeTextColor(theme string) string {
	if c, ok := themeText[theme]; ok {
		return c
	}
	return "202124"
}

// xfrm builds the transform block; rot is in degrees
func xfrm(x, y, w, h, rot float64, flipH, flipV bool) string {
	attrs := ""
	if rot != 0 {
		attrs += fmt.Sprintf(` rot="%d"`, int64(rot*60000))
	}
	if flipH {
		attrs += ` flipH="1"`
	}
	if flipV {
		attrs += ` flipV="1"`
	}
	return fmt.Sprintf(`<a:xfrm%s><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>`,
		attrs, pxToEmu(x), pxToEmu(y), pxToEmu(maxF(1, w)), pxToEmu(maxF(1, h)))
}

func maxF(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// fontSizeToSz converts a CSS px font size to pptx hundredths of a point
func fontSizeToSz(px float64) int {
	if px <= 0 {
		px = 24
	}
	return int(px * 0.75 * 100)
}

func alignToAlgn(align string) string {
	switch align {
	case "center":
		return "ctr"
	case "right":
		return "r"
	case "justify":
		return "just"
	}
	return "l"
}

// buildRuns renders paragraph runs for flattened text lines. Kept for the
// callers that genuinely have plain text (shape captions written in the
// editor, table cells) - rich HTML goes through buildRichBody instead.
func buildRuns(lines []string, fontSizePx float64, color string, bold, italic, underline bool, align string) string {
	var sb strings.Builder
	rpr := fmt.Sprintf(`<a:rPr lang="en-US" sz="%d"`, fontSizeToSz(fontSizePx))
	if bold {
		rpr += ` b="1"`
	}
	if italic {
		rpr += ` i="1"`
	}
	if underline {
		rpr += ` u="sng"`
	}
	rpr += ` dirty="0"><a:solidFill><a:srgbClr val="` + hexColor(color, "202124") + `"/></a:solidFill></a:rPr>`
	ppr := ""
	if a := alignToAlgn(align); a != "l" {
		ppr = `<a:pPr algn="` + a + `"/>`
	}
	for _, line := range lines {
		sb.WriteString(`<a:p>` + ppr)
		if line != "" {
			sb.WriteString(`<a:r>` + rpr + `<a:t>` + xmlEscape(line) + `</a:t></a:r>`)
		}
		sb.WriteString(`</a:p>`)
	}
	return sb.String()
}

// pxToEmuRound converts CSS pixels to EMU
func pxToEmuRound(px float64) int64 { return int64(px*emuPerPx + 0.5) }

// buildRichBody renders the editor's storage HTML as PresentationML
// paragraphs, keeping per-run font, size, weight, colour and highlight and
// per-paragraph alignment, spacing, indents and bullets.
func buildRichBody(o *Object, fallbackColor string) string {
	p := o.Props
	base := inlineStyle{
		sizePx: p.FontSize,
		font:   firstFontFamily(p.FontFamily),
		bold:   p.Bold, italic: p.Italic, underline: p.Underline,
		color: p.Color,
	}
	if base.color == "" {
		base.color = p.TextColor
	}
	if base.color == "" {
		base.color = fallbackColor
	}
	if base.sizePx <= 0 {
		base.sizePx = 24
	}
	paras := parseStorageHTML(p.HTML, base)

	var sb strings.Builder
	for _, para := range paras {
		align := para.Align
		if align == "" {
			align = p.Align
		}
		sb.WriteString(`<a:p><a:pPr`)
		if a := alignToAlgn(align); a != "l" {
			sb.WriteString(` algn="` + a + `"`)
		}
		if para.PadLeft != 0 {
			sb.WriteString(fmt.Sprintf(` marL="%d"`, pxToEmuRound(para.PadLeft)))
		}
		if para.Indent != 0 {
			sb.WriteString(fmt.Sprintf(` indent="%d"`, pxToEmuRound(para.Indent)))
		}
		sb.WriteString(`>`)
		lh := para.LineHeight
		if lh <= 0 {
			lh = p.LineHeight
		}
		if lh > 0 {
			// the reader turns a pptx percentage into a CSS multiplier by
			// multiplying with the font's line height; undo that here
			sb.WriteString(fmt.Sprintf(`<a:lnSpc><a:spcPct val="%d"/></a:lnSpc>`,
				int(lh/pptxLineHeightFactor*100000)))
		}
		if para.MarginTop > 0 {
			sb.WriteString(fmt.Sprintf(`<a:spcBef><a:spcPts val="%d"/></a:spcBef>`,
				int(para.MarginTop*0.75*100)))
		}
		if para.MarginBot > 0 {
			sb.WriteString(fmt.Sprintf(`<a:spcAft><a:spcPts val="%d"/></a:spcAft>`,
				int(para.MarginBot*0.75*100)))
		}
		if para.Bullet != "" {
			sb.WriteString(`<a:buChar char="` + xmlEscape(para.Bullet) + `"/>`)
		} else {
			sb.WriteString(`<a:buNone/>`)
		}
		sb.WriteString(`</a:pPr>`)
		for _, r := range para.Runs {
			if r.Break {
				sb.WriteString(`<a:br>` + runRPr(r, base) + `</a:br>`)
				continue
			}
			if r.Text == "" {
				continue
			}
			sb.WriteString(`<a:r>` + runRPr(r, base) + `<a:t>` + xmlEscape(r.Text) + `</a:t></a:r>`)
		}
		sb.WriteString(`</a:p>`)
	}
	return sb.String()
}

// runRPr renders one run's <a:rPr>
func runRPr(r htmlRun, base inlineStyle) string {
	size := r.SizePx
	if size <= 0 {
		size = base.sizePx
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`<a:rPr lang="en-US" sz="%d"`, fontSizeToSz(size)))
	sb.WriteString(` b="` + boolAttr(r.Bold) + `" i="` + boolAttr(r.Italic) + `"`)
	if r.Underline {
		sb.WriteString(` u="sng"`)
	}
	if r.Strike {
		sb.WriteString(` strike="sngStrike"`)
	}
	sb.WriteString(` dirty="0">`)
	color := r.Color
	if color == "" {
		color = base.color
	}
	sb.WriteString(`<a:solidFill><a:srgbClr val="` + hexColor(color, "202124") + `"/></a:solidFill>`)
	if r.Highlight != "" {
		if h := hexColor(r.Highlight, ""); h != "" {
			sb.WriteString(`<a:highlight><a:srgbClr val="` + h + `"/></a:highlight>`)
		}
	}
	font := r.Font
	if font == "" {
		font = base.font
	}
	if font != "" {
		f := xmlEscape(font)
		sb.WriteString(`<a:latin typeface="` + f + `"/><a:ea typeface="` + f +
			`"/><a:cs typeface="` + f + `"/>`)
	}
	sb.WriteString(`</a:rPr>`)
	return sb.String()
}

// bodyPrFor renders the <a:bodyPr> for an object, honouring the vertical
// anchor and the text insets an imported deck carries
func bodyPrFor(p Props, defaultAnchor string) string {
	anchor := defaultAnchor
	switch p.VAlign {
	case "middle":
		anchor = "ctr"
	case "bottom":
		anchor = "b"
	case "top":
		anchor = "t"
	}
	ins := `lIns="0" tIns="0" rIns="0" bIns="0"`
	if len(p.Pad) == 4 {
		ins = fmt.Sprintf(`tIns="%d" rIns="%d" bIns="%d" lIns="%d"`,
			pxToEmuRound(p.Pad[0]), pxToEmuRound(p.Pad[1]),
			pxToEmuRound(p.Pad[2]), pxToEmuRound(p.Pad[3]))
	}
	return `<a:bodyPr wrap="square" anchor="` + anchor + `" anchorCtr="0" ` + ins + `><a:noAutofit/></a:bodyPr>`
}

func buildTextSp(id int, o *Object, theme string) string {
	p := o.Props
	color := p.Color
	if color == "" {
		color = "#" + themeTextColor(theme)
	}
	return fmt.Sprintf(
		`<p:sp><p:nvSpPr><p:cNvPr id="%d" name="TextBox %d"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`+
			`<p:spPr>%s<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`+
			`<p:txBody>%s<a:lstStyle/>%s</p:txBody></p:sp>`,
		id, id,
		xfrm(o.X, o.Y, o.W, o.H, o.Rot, false, false),
		bodyPrFor(p, "t"),
		buildRichBody(o, color))
}

func buildShapeSp(id int, o *Object) string {
	p := o.Props
	prst := shapeKindPrst(p.Kind)
	geom := `<a:prstGeom prst="` + prst + `"><a:avLst/></a:prstGeom>`
	if prst == "roundRect" && p.Radius > 0 && o.W > 0 && o.H > 0 {
		adj := int(p.Radius / minF(o.W, o.H) * 100000)
		if adj > 0 && adj <= 50000 {
			geom = fmt.Sprintf(
				`<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val %d"/></a:avLst></a:prstGeom>`, adj)
		}
	}
	ln := `<a:ln><a:noFill/></a:ln>`
	if p.StrokeW > 0 && p.Stroke != "" && p.Stroke != "none" {
		ln = fmt.Sprintf(`<a:ln w="%d"><a:solidFill><a:srgbClr val="%s"/></a:solidFill>`,
			pxToEmu(p.StrokeW), hexColor(p.Stroke, "333333"))
		if p.Dash {
			ln += `<a:prstDash val="dash"/>`
		}
		ln += `</a:ln>`
	}
	fill := `<a:noFill/>`
	if p.Fill != "" && p.Fill != "none" {
		fill = `<a:solidFill><a:srgbClr val="` + hexColor(p.Fill, "E07B1F") + `"/></a:solidFill>`
	} else if p.Fill == "" {
		fill = `<a:solidFill><a:srgbClr val="E07B1F"/></a:solidFill>`
	}

	tx := `<p:txBody>` + bodyPrFor(p, "ctr") + `<a:lstStyle/><a:p/></p:txBody>`
	if p.HTML != "" {
		tc := p.TextColor
		if tc == "" {
			tc = "#FFFFFF"
		}
		tx = `<p:txBody>` + bodyPrFor(p, "ctr") + `<a:lstStyle/>` +
			buildRichBody(o, tc) + `</p:txBody>`
	} else if strings.TrimSpace(p.Text) != "" {
		tc := p.TextColor
		if tc == "" {
			tc = "#FFFFFF"
		}
		fs := p.FontSize
		if fs <= 0 {
			fs = 18
		}
		align := p.Align
		if align == "" {
			align = "center"
		}
		tx = `<p:txBody>` + bodyPrFor(p, "ctr") + `<a:lstStyle/>` +
			buildRuns(strings.Split(p.Text, "\n"), fs, tc, p.Bold, false, false, align) +
			`</p:txBody>`
	}
	return fmt.Sprintf(
		`<p:sp><p:nvSpPr><p:cNvPr id="%d" name="Shape %d"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`+
			`<p:spPr>%s%s%s%s</p:spPr>%s</p:sp>`,
		id, id,
		xfrm(o.X, o.Y, o.W, o.H, o.Rot, false, false),
		geom, fill, ln, tx)
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func buildLineSp(id int, o *Object) string {
	p := o.Props
	if len(p.Points) > 2 {
		return buildPolylineSp(id, o)
	}
	// bounding box with flips encoding the line direction
	x, y, w, h := o.X, o.Y, o.W, o.H
	flipH, flipV := false, false
	if w < 0 {
		x += w
		w = -w
		flipH = true
	}
	if h < 0 {
		y += h
		h = -h
		flipV = true
	}
	return fmt.Sprintf(
		`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="%d" name="Line %d"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>`+
			`<p:spPr>%s<a:prstGeom prst="line"><a:avLst/></a:prstGeom>%s</p:spPr></p:cxnSp>`,
		id, id,
		xfrm(x, y, w, h, 0, flipH, flipV), lineLn(p))
}

// lineLn renders the <a:ln> of a line object, with its dash and arrow heads
func lineLn(p Props) string {
	sw := p.StrokeW
	if sw <= 0 {
		sw = 2
	}
	ln := fmt.Sprintf(`<a:ln w="%d"><a:solidFill><a:srgbClr val="%s"/></a:solidFill>`,
		pxToEmu(sw), hexColor(p.Stroke, "202124"))
	if p.Dash {
		ln += `<a:prstDash val="dash"/>`
	}
	if p.ArrowStart {
		ln += `<a:headEnd type="triangle"/>`
	}
	if p.ArrowEnd {
		ln += `<a:tailEnd type="triangle"/>`
	}
	return ln + `</a:ln>`
}

// buildPolylineSp exports a bent connector as a freeform shape. Rebuilding
// the original bentConnector preset would mean re-deriving its rotation and
// flips from the path; a custGeom states the very path the editor draws, so
// nothing can drift.
func buildPolylineSp(id int, o *Object) string {
	pts := o.Props.Points
	minX, minY := pts[0][0], pts[0][1]
	maxX, maxY := minX, minY
	for _, pt := range pts {
		minX, maxX = minF(minX, pt[0]), maxF(maxX, pt[0])
		minY, maxY = minF(minY, pt[1]), maxF(maxY, pt[1])
	}
	w, h := maxX-minX, maxY-minY
	var path strings.Builder
	for i, pt := range pts {
		x := pxToEmu(pt[0] - minX)
		y := pxToEmu(pt[1] - minY)
		if i == 0 {
			path.WriteString(fmt.Sprintf(`<a:moveTo><a:pt x="%d" y="%d"/></a:moveTo>`, x, y))
			continue
		}
		path.WriteString(fmt.Sprintf(`<a:lnTo><a:pt x="%d" y="%d"/></a:lnTo>`, x, y))
	}
	return fmt.Sprintf(
		`<p:sp><p:nvSpPr><p:cNvPr id="%d" name="Connector %d"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`+
			`<p:spPr>%s<a:custGeom><a:avLst/><a:gdLst/><a:rect l="0" t="0" r="r" b="b"/>`+
			`<a:pathLst><a:path w="%d" h="%d">%s</a:path></a:pathLst></a:custGeom>`+
			`<a:noFill/>%s</p:spPr>`+
			`<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`,
		id, id,
		xfrm(o.X+minX, o.Y+minY, maxF(w, 1), maxF(h, 1), 0, false, false),
		pxToEmu(maxF(w, 1)), pxToEmu(maxF(h, 1)), path.String(), lineLn(o.Props))
}

func buildPicSp(id int, o *Object, rid string) string {
	p := o.Props
	srcRect := ""
	if len(p.Crop) == 4 {
		srcRect = fmt.Sprintf(`<a:srcRect l="%d" t="%d" r="%d" b="%d"/>`,
			int(p.Crop[0]*100000), int(p.Crop[1]*100000),
			int(p.Crop[2]*100000), int(p.Crop[3]*100000))
	}
	// a shaped crop is a preset geometry on the picture itself
	prst := shapeKindPrst(p.Mask)
	geom := `<a:prstGeom prst="` + prst + `"><a:avLst/></a:prstGeom>`
	if (prst == "roundRect" || p.Mask == "" || p.Mask == "rect") &&
		p.Radius > 0 && o.W > 0 && o.H > 0 {
		adj := int(p.Radius / minF(o.W, o.H) * 100000)
		if adj > 0 && adj <= 50000 {
			geom = fmt.Sprintf(
				`<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val %d"/></a:avLst></a:prstGeom>`, adj)
		}
	}
	blip := `<a:blip r:embed="` + rid + `">` + pictureEffects(p) + `</a:blip>`
	return fmt.Sprintf(
		`<p:pic><p:nvPicPr><p:cNvPr id="%d" name="Picture %d"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`+
			`<p:blipFill>%s%s<a:stretch><a:fillRect/></a:stretch></p:blipFill>`+
			`<p:spPr>%s%s</p:spPr></p:pic>`,
		id, id, blip, srcRect,
		xfrm(o.X, o.Y, o.W, o.H, o.Rot, p.FlipH, p.FlipV), geom)
}

// pictureEffects renders the colour effects a picture carries as the
// DrawingML children of its <a:blip>: transparency, a greyscale wash or a
// duotone tint for the re-colour preset, and the luminance pair for the
// brightness / contrast adjustments.
func pictureEffects(p Props) string {
	var sb strings.Builder
	if p.Opacity > 0 && p.Opacity < 1 {
		sb.WriteString(fmt.Sprintf(`<a:alphaModFix amt="%d"/>`, int(p.Opacity*100000)))
	}
	switch p.Recolor {
	case "":
		// nothing
	case "gray":
		sb.WriteString(`<a:grayscl/>`)
	case "black-white":
		sb.WriteString(`<a:biLevel thresh="50000"/>`)
	case "negative":
		// DrawingML has no image inversion; the nearest honest thing is to
		// leave the picture alone rather than write something else
	default:
		if tint, ok := recolorTints[p.Recolor]; ok {
			sb.WriteString(`<a:duotone><a:prstClr val="black"/><a:srgbClr val="` +
				hexColor(tint, "808080") + `"/></a:duotone>`)
		}
	}
	if p.Bright != 0 || p.Contrast != 0 {
		lum := `<a:lum`
		if p.Bright != 0 {
			lum += fmt.Sprintf(` bright="%d"`, int(p.Bright*100000))
		}
		if p.Contrast != 0 {
			lum += fmt.Sprintf(` contrast="%d"`, int(p.Contrast*100000))
		}
		sb.WriteString(lum + `/>`)
	}
	return sb.String()
}

func buildTableFrame(id int, o *Object) string {
	p := o.Props
	rows := p.Rows
	if len(rows) == 0 {
		rows = [][]string{{""}}
	}
	cols := len(rows[0])
	if cols == 0 {
		cols = 1
	}
	fs := p.FontSize
	if fs <= 0 {
		fs = 16
	}
	color := p.Color
	if color == "" {
		color = "#202124"
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(
		`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="%d" name="Table %d"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>`,
		id, id))
	sb.WriteString(fmt.Sprintf(`<p:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></p:xfrm>`,
		pxToEmu(o.X), pxToEmu(o.Y), pxToEmu(maxF(1, o.W)), pxToEmu(maxF(1, o.H))))
	sb.WriteString(`<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="` +
		boolAttr(p.HeaderRow) + `" bandRow="0"/><a:tblGrid>`)
	totalW := pxToEmu(maxF(1, o.W))
	for c := 0; c < cols; c++ {
		w := totalW / int64(cols)
		if c < len(p.ColW) && p.ColW[c] > 0 {
			w = int64(float64(totalW) * p.ColW[c] / 100.0)
		}
		sb.WriteString(fmt.Sprintf(`<a:gridCol w="%d"/>`, w))
	}
	sb.WriteString(`</a:tblGrid>`)
	totalH := pxToEmu(maxF(1, o.H))
	for ri, row := range rows {
		h := totalH / int64(len(rows))
		if ri < len(p.RowH) && p.RowH[ri] > 0 {
			h = int64(float64(totalH) * p.RowH[ri] / 100.0)
		}
		sb.WriteString(fmt.Sprintf(`<a:tr h="%d">`, h))
		for c := 0; c < cols; c++ {
			cell := ""
			if c < len(row) {
				cell = row[c]
			}
			// cells hold the same limited HTML the text objects do, so
			// per-cell bold / colour / font survive the round trip
			base := inlineStyle{
				sizePx: fs, color: color,
				bold: p.HeaderRow && ri == 0,
			}
			var paras strings.Builder
			for _, para := range parseStorageHTML(cell, base) {
				paras.WriteString(`<a:p>`)
				if a := alignToAlgn(para.Align); a != "l" {
					paras.WriteString(`<a:pPr algn="` + a + `"/>`)
				}
				for _, r := range para.Runs {
					if r.Break {
						paras.WriteString(`<a:br/>`)
						continue
					}
					if r.Text == "" {
						continue
					}
					paras.WriteString(`<a:r>` + runRPr(r, base) + `<a:t>` +
						xmlEscape(r.Text) + `</a:t></a:r>`)
				}
				paras.WriteString(`</a:p>`)
			}
			ins := ""
			if len(p.CellPad) == 4 {
				ins = fmt.Sprintf(` marT="%d" marR="%d" marB="%d" marL="%d"`,
					pxToEmuRound(p.CellPad[0]), pxToEmuRound(p.CellPad[1]),
					pxToEmuRound(p.CellPad[2]), pxToEmuRound(p.CellPad[3]))
			}
			tcPr := `<a:tcPr` + ins + `/>`
			if ri < len(p.CellFill) && c < len(p.CellFill[ri]) && p.CellFill[ri][c] != "" {
				tcPr = `<a:tcPr` + ins + `><a:solidFill><a:srgbClr val="` +
					hexColor(p.CellFill[ri][c], "FFFFFF") + `"/></a:solidFill></a:tcPr>`
			}
			sb.WriteString(`<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>` + paras.String() +
				`</a:txBody>` + tcPr + `</a:tc>`)
		}
		sb.WriteString(`</a:tr>`)
	}
	sb.WriteString(`</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`)
	return sb.String()
}

func boolAttr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func buildContentTypes(slideCount int, mediaExts []string) string {
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	sb.WriteString(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`)
	sb.WriteString(`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`)
	sb.WriteString(`<Default Extension="xml" ContentType="application/xml"/>`)
	seen := map[string]bool{}
	for _, ext := range mediaExts {
		if seen[ext] {
			continue
		}
		seen[ext] = true
		mime := "image/png"
		switch ext {
		case "jpeg":
			mime = "image/jpeg"
		case "gif":
			mime = "image/gif"
		case "mp4":
			mime = "video/mp4"
		case "webm":
			mime = "video/webm"
		case "mov":
			mime = "video/quicktime"
		case "ogg":
			mime = "video/ogg"
		case "mp3":
			mime = "audio/mpeg"
		case "m4a":
			mime = "audio/mp4"
		case "wav":
			mime = "audio/wav"
		case "aac":
			mime = "audio/aac"
		}
		sb.WriteString(`<Default Extension="` + ext + `" ContentType="` + mime + `"/>`)
	}
	sb.WriteString(`<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`)
	sb.WriteString(`<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`)
	sb.WriteString(`<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`)
	sb.WriteString(`<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`)
	for i := 1; i <= slideCount; i++ {
		sb.WriteString(fmt.Sprintf(`<Override PartName="/ppt/slides/slide%d.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`, i))
	}
	sb.WriteString(`<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`)
	sb.WriteString(`<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`)
	sb.WriteString(`</Types>`)
	return sb.String()
}

/* ---------- static package parts ---------- */

const pptxRootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`

const pptxCoreProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Presentation</dc:title><dc:creator>ArozOS Office</dc:creator><cp:lastModifiedBy>ArozOS Office</cp:lastModifiedBy></cp:coreProperties>`

const pptxAppProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ArozOS Office Slides</Application></Properties>`

const pptxSlideMaster = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`

const pptxSlideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`

const pptxSlideLayout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`

const pptxSlideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`

const pptxTheme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="ArozOS"><a:themeElements><a:clrScheme name="ArozOS"><a:dk1><a:srgbClr val="202124"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="E07B1F"/></a:accent1><a:accent2><a:srgbClr val="4C9BE8"/></a:accent2><a:accent3><a:srgbClr val="4CC06A"/></a:accent3><a:accent4><a:srgbClr val="B06AE8"/></a:accent4><a:accent5><a:srgbClr val="E8B84C"/></a:accent5><a:accent6><a:srgbClr val="4CC9C0"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="ArozOS"><a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="ArozOS"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
