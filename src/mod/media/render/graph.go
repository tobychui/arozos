package render

/*
	graph.go

	Turns a Project into an ffmpeg command line: one input per clip and a
	single -filter_complex graph that composites every picture layer onto a
	black canvas and mixes every audio clip onto silence.

	The graph mirrors the browser compositor (Cine Studio player.js) step by
	step so a server render looks like the preview:

	  source -> trim / speed / fps -> crop -> pixelate -> fit / fill / stretch
	         -> flips -> colour (exposure, contrast, saturation, preset,
	            filter effects) -> opacity -> fade in / out -> rotate
	         -> placed on a transparent project-size canvas   (= a "layer")

	Layers linked by a transition are folded into one stream with xfade (the
	outgoing clip frozen on its last frame for the transition length, as the
	preview does), then every layer is overlaid on the canvas in paint order.
	Blend modes other than normal go through the blend filter with the layer
	flattened onto that mode's neutral colour. Vignette and grain are drawn
	over the whole frame after their clip, again like the preview.

	Nothing in here runs ffmpeg or touches the file system; BuildArgs is a
	pure function, which keeps it testable everywhere.
*/

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Encoder is the video encoder to use for the final stream. The zero value
// means libx264. A hardware profile fills Codec / PreInput / FinalFilter /
// Args from the transcoder's probe.
type Encoder struct {
	Codec       string   // ffmpeg -c:v value
	PreInput    []string // global args placed before the inputs (device init)
	FinalFilter string   // filter appended to the video chain (e.g. "format=nv12,hwupload")
	Args        []string // encoder-specific args replacing the software preset / crf
}

// Result is what BuildArgs produces: ffmpeg arguments *without* the output
// file (the runner appends progress reporting and the output path), plus
// the total output length the runner needs for progress percentages.
type Result struct {
	Args       []string
	DurationMs int64
}

type builder struct {
	p       *Project
	inputs  []string // per-input argument groups, flattened later
	nInputs int
	chains  []string
	labelN  int
	fps     string
	w, h    int
}

func (b *builder) label(prefix string) string {
	b.labelN++
	return fmt.Sprintf("%s%d", prefix, b.labelN)
}

func (b *builder) addInput(args ...string) int {
	b.inputs = append(b.inputs, args...)
	idx := b.nInputs
	b.nInputs++
	return idx
}

func (b *builder) chain(s string) {
	b.chains = append(b.chains, s)
}

// f formats a float for use inside a filter graph: fixed precision, no
// exponent, and never a locale-dependent separator.
func f(v float64) string {
	s := strconv.FormatFloat(v, 'f', 4, 64)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	if s == "" || s == "-" || s == "-0" {
		return "0"
	}
	return s
}

// BuildArgs converts a validated project into ffmpeg arguments. enc selects
// the video encoder (nil = software libx264).
func BuildArgs(p *Project, enc *Encoder) (*Result, error) {
	if err := p.Validate(); err != nil {
		return nil, err
	}
	b := &builder{
		p:   p,
		fps: f(p.FPS),
		w:   p.Width,
		h:   p.Height,
	}

	audioOnly := p.Format == FormatM4A
	videoOnly := p.Format == FormatGIF

	var videoOut, audioOut string
	if !audioOnly {
		videoOut = b.buildVideo(enc)
	}
	if !videoOnly {
		audioOut = b.buildAudio()
	}

	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin"}
	if enc != nil && !audioOnly {
		args = append(args, enc.PreInput...)
	}
	args = append(args, b.inputs...)
	args = append(args, "-filter_complex", strings.Join(b.chains, ";"))
	if videoOut != "" {
		args = append(args, "-map", "["+videoOut+"]")
	}
	if audioOut != "" {
		args = append(args, "-map", "["+audioOut+"]")
	}
	if videoOut == "" {
		args = append(args, "-vn")
	}
	if audioOut == "" {
		args = append(args, "-an")
	}
	args = append(args, encoderArgs(p, enc, videoOut != "", audioOut != "")...)
	args = append(args, "-t", f(p.Duration))

	return &Result{Args: args, DurationMs: int64(math.Round(p.Duration * 1000))}, nil
}

/* ---------- video ---------- */

// buildVideo composites all layers and returns the label of the final video
// stream.
func (b *builder) buildVideo(enc *Encoder) string {
	p := b.p
	size := fmt.Sprintf("%dx%d", b.w, b.h)

	base := b.label("base")
	b.chain(fmt.Sprintf("color=c=black:s=%s:r=%s:d=%s,format=rgba[%s]", size, b.fps, f(p.Duration), base))

	byID := map[string]int{}
	for i := range p.Layers {
		byID[p.Layers[i].ID] = i
	}

	// Walk the layers, folding transition-linked runs into one stream each
	i := 0
	for i < len(p.Layers) {
		first := &p.Layers[i]
		if first.Kind == LayerAdjust {
			base = b.adjust(base, first)
			base = b.frameEffects(base, first)
			i++
			continue
		}
		stream := b.layerStream(first)
		chainStart := first.Start
		chainLen := first.Duration
		members := []*Layer{first}

		// A layer transitioning from nothing blends in from a transparent
		// stretch of the same length, which xfade then consumes.
		if first.Transition != nil && first.PrevID == "" {
			stream = b.xfadeFrom(b.blankStream(first.Transition.Duration), stream, first.Transition, 0)
		}

		j := i + 1
		for j < len(p.Layers) {
			next := &p.Layers[j]
			if next.Transition == nil || next.PrevID != p.Layers[j-1].ID || next.Kind == LayerAdjust {
				break
			}
			// Hold the outgoing picture for the transition, then cross into
			// the incoming layer: the chain keeps its overall length.
			d := next.Transition.Duration
			held := b.label("hold")
			b.chain(fmt.Sprintf("[%s]tpad=stop_mode=clone:stop_duration=%s[%s]", stream, f(d), held))
			stream = b.xfadeFrom(held, b.layerStream(next), next.Transition, chainLen)
			chainLen += next.Duration
			members = append(members, next)
			j++
		}

		base = b.compose(base, stream, first, chainStart, chainLen)
		for _, m := range members {
			base = b.frameEffects(base, m)
		}
		i = j
	}

	// Final frame: optional downscale, always even dimensions for the
	// encoders, then the pixel format the chosen encoder wants.
	out := b.label("vout")
	var final []string
	ow := int(math.Round(float64(b.w) * p.Scale))
	oh := int(math.Round(float64(b.h) * p.Scale))
	ow -= ow % 2
	oh -= oh % 2
	if ow < 2 {
		ow = 2
	}
	if oh < 2 {
		oh = 2
	}
	if ow != b.w || oh != b.h {
		final = append(final, fmt.Sprintf("scale=%d:%d:flags=lanczos", ow, oh))
	}
	if p.Format == FormatGIF {
		// Palette-based GIF: split the stream so the palette is learnt from
		// the very frames it is then applied to.
		g1 := b.label("g")
		g2 := b.label("g")
		pal := b.label("pal")
		final = append(final, "format=rgb24")
		b.chain(fmt.Sprintf("[%s]%s,split[%s][%s]", base, strings.Join(final, ","), g1, g2))
		b.chain(fmt.Sprintf("[%s]palettegen=stats_mode=diff[%s]", g1, pal))
		b.chain(fmt.Sprintf("[%s][%s]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle[%s]", g2, pal, out))
		return out
	}
	if enc != nil && enc.FinalFilter != "" {
		final = append(final, enc.FinalFilter)
	} else {
		final = append(final, "format=yuv420p")
	}
	b.chain(fmt.Sprintf("[%s]%s[%s]", base, strings.Join(final, ","), out))
	return out
}

// blankStream is a fully transparent project-size stream of the given length.
func (b *builder) blankStream(duration float64) string {
	lbl := b.label("blank")
	b.chain(fmt.Sprintf("color=c=black@0:s=%dx%d:r=%s:d=%s,format=rgba[%s]", b.w, b.h, b.fps, f(duration), lbl))
	return lbl
}

// xfadeFrom blends "from" into "to" over the transition, starting the
// transition at offset seconds into "from". Both must be project-size
// streams at the project frame rate.
func (b *builder) xfadeFrom(from, to string, tr *Transition, offset float64) string {
	kind := xfadeTransitions[tr.Type]
	if kind == "" {
		kind = "fade"
	}
	fa := b.label("xa")
	fb := b.label("xb")
	out := b.label("xf")
	// gbrap keeps the alpha plane through the transition, so a wipe or
	// dissolve reveals the tracks underneath rather than black
	b.chain(fmt.Sprintf("[%s]format=gbrap[%s]", from, fa))
	b.chain(fmt.Sprintf("[%s]format=gbrap[%s]", to, fb))
	b.chain(fmt.Sprintf("[%s][%s]xfade=transition=%s:duration=%s:offset=%s,format=rgba[%s]",
		fa, fb, kind, f(tr.Duration), f(offset), out))
	return out
}

// layerStream renders one clip into a transparent project-size stream that
// starts at t=0 and lasts the clip's timeline duration.
func (b *builder) layerStream(l *Layer) string {
	pr := &l.Props

	var idx int
	var steps []string
	switch {
	case l.Kind == LayerVideo:
		idx = b.addInput("-ss", f(l.In), "-t", f(l.Duration*l.Speed), "-i", l.Src)
		if l.Reverse {
			steps = append(steps, "reverse")
		}
		steps = append(steps, fmt.Sprintf("setpts=(PTS-STARTPTS)/%s", f(l.Speed)))
	case strings.EqualFold(filepathExt(l.Src), ".gif"):
		// The gif demuxer loops on its own; -loop belongs to image2 only
		idx = b.addInput("-t", f(l.Duration), "-i", l.Src)
	default:
		idx = b.addInput("-loop", "1", "-framerate", b.fps, "-t", f(l.Duration), "-i", l.Src)
	}
	steps = append(steps, "fps="+b.fps, "format=rgba")

	// Per-edge crop, in source pixels. iw/ih keep this independent of the
	// actual media size, which the server never has to probe.
	if pr.CropTop > 0 || pr.CropBottom > 0 || pr.CropLeft > 0 || pr.CropRight > 0 {
		steps = append(steps, fmt.Sprintf("crop=w='max(2,iw-%s)':h='max(2,ih-%s)':x='min(%s,iw-2)':y='min(%s,ih-2)'",
			f(pr.CropLeft+pr.CropRight), f(pr.CropTop+pr.CropBottom), f(pr.CropLeft), f(pr.CropTop)))
	}

	fx := analyzeEffects(pr.Effects)

	// Chroma key on the source pixels, before any scaling blurs the edges
	if fx.chroma != "" {
		steps = append(steps, fx.chroma, "format=rgba")
	}

	// Pixelate: shrink by the block size, then enlarge without smoothing
	scaleFlags := ""
	if fx.pixelate > 1 {
		steps = append(steps, fmt.Sprintf("scale=w='max(1,iw/%s)':h='max(1,ih/%s)':flags=area", f(fx.pixelate), f(fx.pixelate)))
		scaleFlags = ":flags=neighbor"
	}

	// Fit / fill / stretch into the project frame, then the user scale. An
	// animated scale becomes a per-frame expression of the layer time.
	kf := pr.Keyframes
	aspect := ":force_original_aspect_ratio=decrease"
	if pr.Crop == "fill" {
		aspect = ":force_original_aspect_ratio=increase"
	} else if pr.Crop == "stretch" {
		aspect = ""
	}
	if len(kf["scale"]) > 0 {
		expr := "max(0.01," + kfExpr(kf["scale"], "t") + "/100)"
		steps = append(steps, fmt.Sprintf("scale=w='max(2,trunc(%d*%s))':h='max(2,trunc(%d*%s))'%s:eval=frame%s",
			b.w, expr, b.h, expr, aspect, scaleFlags))
	} else {
		user := pr.Scale / 100
		if user < 0.01 {
			user = 0.01
		}
		bw := int(math.Max(1, math.Round(float64(b.w)*user)))
		bh := int(math.Max(1, math.Round(float64(b.h)*user)))
		steps = append(steps, fmt.Sprintf("scale=%d:%d%s%s", bw, bh, aspect, scaleFlags))
	}

	if pr.FlipH != fx.mirror {
		steps = append(steps, "hflip")
	}
	if pr.FlipV {
		steps = append(steps, "vflip")
	}

	steps = append(steps, colourSteps(pr, fx)...)

	// Opacity and fades act on the alpha plane only
	if len(kf["opacity"]) > 0 {
		steps = append(steps, opacityAnimation(kfExpr(kf["opacity"], "T"))...)
	} else if opacity := pr.Opacity / 100; opacity < 1 {
		steps = append(steps, fmt.Sprintf("colorchannelmixer=aa=%s", f(opacity)))
	}
	if fx.fadeIn > 0 {
		steps = append(steps, fmt.Sprintf("fade=t=in:st=0:d=%s:alpha=1", f(math.Min(fx.fadeIn, l.Duration))))
	}
	if fx.fadeOut > 0 {
		d := math.Min(fx.fadeOut, l.Duration)
		steps = append(steps, fmt.Sprintf("fade=t=out:st=%s:d=%s:alpha=1", f(l.Duration-d), f(d)))
	}

	if len(kf["rotation"]) > 0 {
		steps = append(steps, fmt.Sprintf("rotate=a='(%s)*PI/180':ow='hypot(iw,ih)':oh=ow:c=black@0", kfExpr(kf["rotation"], "t")))
	} else if pr.Rotation != 0 {
		steps = append(steps, fmt.Sprintf("rotate=%s*PI/180:ow='hypot(iw,ih)':oh=ow:c=black@0", f(pr.Rotation)))
	}

	clip := b.label("clip")
	b.chain(fmt.Sprintf("[%d:v]%s[%s]", idx, strings.Join(steps, ","), clip))

	// Place the transformed picture centred (plus offset) on a transparent
	// canvas the size of the frame. The canvas is endless; shortest=1 ends
	// the layer with the clip.
	x := f(pr.X)
	if len(kf["x"]) > 0 {
		x = "(" + kfExpr(kf["x"], "t") + ")"
	}
	y := f(pr.Y)
	if len(kf["y"]) > 0 {
		y = "(" + kfExpr(kf["y"], "t") + ")"
	}
	canvas := b.label("cv")
	layer := b.label("layer")
	b.chain(fmt.Sprintf("color=c=black@0:s=%dx%d:r=%s,format=rgba[%s]", b.w, b.h, b.fps, canvas))
	b.chain(fmt.Sprintf("[%s][%s]overlay=x='(main_w-overlay_w)/2+%s':y='(main_h-overlay_h)/2+%s':shortest=1:format=rgb:eval=frame[%s]",
		canvas, clip, x, y, layer))
	return layer
}

// opacityAnimation scales the alpha plane by a time expression (in T, the
// blend filter's clock). blend needs two inputs, so the stream is split
// and blended with itself; the colour planes pass through unchanged.
func opacityAnimation(expr string) []string {
	return []string{
		"format=gbrap",
		"split[__oa][__ob];[__oa][__ob]blend=all_mode=normal:c3_expr='B*clip(" + expr + ",0,100)/100'",
		"format=rgba",
	}
}

// kfExpr renders a keyframe list as an ffmpeg expression of the variable
// v (t for most filters, T for blend), reproducing keyframes.js
// interpolate(): constant before the first and after the last keyframe,
// linear, smoothstep (ease) or held segments in between.
func kfExpr(kfs []Keyframe, v string) string {
	if len(kfs) == 0 {
		return "0"
	}
	expr := f(kfs[len(kfs)-1].V)
	for i := len(kfs) - 2; i >= 0; i-- {
		a, c := kfs[i], kfs[i+1]
		var seg string
		span := c.T - a.T
		switch {
		case span <= 0 || a.Ease == "hold":
			seg = f(a.V)
		default:
			k := fmt.Sprintf("clip((%s-%s)/%s,0,1)", v, f(a.T), f(span))
			if a.Ease == "ease" || c.Ease == "ease" {
				k = fmt.Sprintf("(%s)*(%s)*(3-2*(%s))", k, k, k)
			}
			seg = fmt.Sprintf("%s+(%s)*%s", f(a.V), f(c.V-a.V), k)
		}
		expr = fmt.Sprintf("if(lt(%s,%s),%s,%s)", v, f(c.T), seg, expr)
	}
	return fmt.Sprintf("if(lt(%s,%s),%s,%s)", v, f(kfs[0].T), f(kfs[0].V), expr)
}

// adjust applies an adjustment layer: its colour controls and filter
// effects run over the composited frame for the layer's time span.
func (b *builder) adjust(base string, l *Layer) string {
	pr := &l.Props
	fx := analyzeEffects(pr.Effects)
	steps := colourSteps(pr, fx)
	if len(steps) == 0 {
		return base
	}
	enable := fmt.Sprintf(":enable='between(t,%s,%s)'", f(l.Start), f(l.Start+l.Duration))
	for i := range steps {
		steps[i] += enable
	}
	out := b.label("base")
	opacity := pr.Opacity / 100
	if opacity >= 1 {
		b.chain(fmt.Sprintf("[%s]%s[%s]", base, strings.Join(steps, ","), out))
		return out
	}
	// Partial opacity: mix the adjusted frame back towards the original
	b1 := b.label("aj")
	b2 := b.label("aj")
	adjusted := b.label("aj")
	b.chain(fmt.Sprintf("[%s]format=gbrp,split[%s][%s]", base, b1, b2))
	b.chain(fmt.Sprintf("[%s]%s[%s]", b2, strings.Join(steps, ","), adjusted))
	b.chain(fmt.Sprintf("[%s][%s]blend=all_mode=normal:all_opacity=%s,format=rgba[%s]", b1, adjusted, f(opacity), out))
	return out
}

// filepathExt is filepath.Ext without importing path/filepath into a file
// that otherwise never touches paths.
func filepathExt(name string) string {
	for i := len(name) - 1; i >= 0 && name[i] != '/' && name[i] != '\\'; i-- {
		if name[i] == '.' {
			return name[i:]
		}
	}
	return ""
}

// compose paints a layer stream (which starts at t=0) onto the base at the
// given timeline position and returns the new base label.
func (b *builder) compose(base, layer string, l *Layer, start, length float64) string {
	out := b.label("base")
	mode := blendModes[l.Props.Blend]
	if mode == "" {
		shifted := b.label("sh")
		b.chain(fmt.Sprintf("[%s]setpts=PTS+%s/TB[%s]", layer, f(start), shifted))
		b.chain(fmt.Sprintf("[%s][%s]overlay=x=0:y=0:eof_action=pass:format=rgb:enable='between(t,%s,%s)'[%s]",
			base, shifted, f(start), f(start+length), out))
		return out
	}

	// Blend modes: flatten the layer onto the mode's neutral colour (the
	// value that leaves the backdrop unchanged), pad it to the full timeline
	// with that colour, and blend. Opacity then mixes the result back
	// towards the backdrop, which is what globalAlpha does in the browser.
	neutral := map[string]string{
		"multiply":   "white",
		"screen":     "black",
		"addition":   "black",
		"difference": "black",
		"overlay":    "0x808080",
		"softlight":  "0x808080",
	}[mode]
	flat := b.label("flat")
	nc := b.label("nc")
	b.chain(fmt.Sprintf("color=c=%s:s=%dx%d:r=%s,format=rgba[%s]", neutral, b.w, b.h, b.fps, nc))
	padded := b.label("pad")
	tail := math.Max(0, b.p.Duration-start-length)
	b.chain(fmt.Sprintf("[%s][%s]overlay=x=0:y=0:shortest=1:format=rgb[%s]", nc, layer, flat))
	b.chain(fmt.Sprintf("[%s]tpad=start_mode=add:start_duration=%s:stop_mode=add:stop_duration=%s:color=%s,format=gbrp[%s]",
		flat, f(start), f(tail), neutral, padded))

	opacity := l.Props.Opacity / 100
	b1 := b.label("bb")
	b2 := b.label("bb")
	b.chain(fmt.Sprintf("[%s]format=gbrp,split[%s][%s]", base, b1, b2))
	blended := b.label("bl")
	// ffmpeg's soft light takes the branch-selecting operand from the first
	// input while overlay takes it from the second; the W3C formulas the
	// canvas uses select on the source and the backdrop respectively.
	if mode == "softlight" {
		b.chain(fmt.Sprintf("[%s][%s]blend=all_mode=softlight[%s]", padded, b1, blended))
	} else {
		b.chain(fmt.Sprintf("[%s][%s]blend=all_mode=%s[%s]", b1, padded, mode, blended))
	}
	if opacity < 1 {
		mixed := b.label("bl")
		b.chain(fmt.Sprintf("[%s][%s]blend=all_mode=normal:all_opacity=%s[%s]", b2, blended, f(opacity), mixed))
		blended = mixed
	} else {
		b.chain(fmt.Sprintf("[%s]nullsink", b2))
	}
	b.chain(fmt.Sprintf("[%s]format=rgba[%s]", blended, out))
	return out
}

// frameEffects applies the full-frame overlays of a layer (vignette, grain)
// to the base for the layer's time range.
func (b *builder) frameEffects(base string, l *Layer) string {
	fx := analyzeEffects(l.Props.Effects)
	if fx.vignette <= 0 && fx.grain <= 0 {
		return base
	}
	start := f(l.Start)
	end := f(l.Start + l.Duration)
	if fx.vignette > 0 {
		// One radial-gradient frame matching the preview's gradient stops,
		// repeated by overlay for as long as it is enabled
		r0 := math.Min(float64(b.w), float64(b.h)) * 0.35
		r1 := math.Max(float64(b.w), float64(b.h)) * 0.72
		vig := b.label("vig")
		b.chain(fmt.Sprintf("color=c=black:s=%dx%d:r=1,format=gbrap,trim=end_frame=1,geq=r=0:g=0:b=0:a='255*%s*clip((hypot(X-%d/2,Y-%d/2)-%s)/%s,0,1)'[%s]",
			b.w, b.h, f(fx.vignette), b.w, b.h, f(r0), f(r1-r0), vig))
		out := b.label("base")
		b.chain(fmt.Sprintf("[%s][%s]overlay=x=0:y=0:format=rgb:enable='between(t,%s,%s)'[%s]", base, vig, start, end, out))
		base = out
	}
	if fx.grain > 0 {
		out := b.label("base")
		b.chain(fmt.Sprintf("[%s]noise=alls=%d:allf=t+u:enable='between(t,%s,%s)'[%s]",
			base, int(math.Round(40*fx.grain)), start, end, out))
		base = out
	}
	return base
}

/* ---------- colour ---------- */

type effectSummary struct {
	filters  []string
	mirror   bool
	pixelate float64
	vignette float64
	grain    float64
	fadeIn   float64
	fadeOut  float64
	chroma   string // chromakey filter, "" when not keyed
}

// analyzeEffects summarises an effect stack the way effects.js analyze()
// does, translating each CSS filter function into its ffmpeg equivalent.
func analyzeEffects(list []Effect) effectSummary {
	var s effectSummary
	for _, e := range list {
		a := e.Amount
		switch e.Type {
		case "bw":
			s.filters = append(s.filters, grayscaleFilter(clamp01(a/100)))
		case "sepia":
			s.filters = append(s.filters, sepiaFilter(clamp01(a/100)))
		case "invert":
			k := clamp01(a / 100)
			expr := fmt.Sprintf("'val*%s+%s*maxval'", f(1-2*k), f(k))
			s.filters = append(s.filters, fmt.Sprintf("lutrgb=r=%s:g=%s:b=%s", expr, expr, expr))
		case "hue":
			s.filters = append(s.filters, fmt.Sprintf("hue=h=%s", f(a)))
		case "blur":
			if a > 0 {
				s.filters = append(s.filters, fmt.Sprintf("gblur=sigma=%s", f(a)))
			}
		case "pixelate":
			if a > 1 {
				s.pixelate = a
			}
		case "mirror":
			s.mirror = true
		case "vignette":
			s.vignette = clamp01(a / 100)
		case "grain":
			s.grain = clamp01(a / 100)
		case "chromakey":
			colour := "0x" + strings.ToLower(strings.TrimPrefix(e.Color, "#"))
			if colour == "0x" {
				colour = "0x00ff00"
			}
			s.chroma = fmt.Sprintf("chromakey=color=%s:similarity=%s:blend=%s",
				colour, f(math.Max(0.01, clamp01(e.Similarity/100))), f(clamp01(e.Soft/100)))
		case "sharpen":
			if a > 0 {
				s.filters = append(s.filters, fmt.Sprintf("unsharp=5:5:%s", f(0.3+1.7*clamp01(a/100))))
			}
		case "fadein":
			s.fadeIn = math.Max(0.05, a)
		case "fadeout":
			s.fadeOut = math.Max(0.05, a)
		}
	}
	return s
}

// colourSteps reproduces player.js buildFilter (exposure, contrast,
// saturation, warm / cool presets) followed by the clip's filter effects.
func colourSteps(pr *Props, fx effectSummary) []string {
	var steps []string
	if pr.Exposure != 0 {
		k := f(math.Max(0, 1+pr.Exposure))
		steps = append(steps, fmt.Sprintf("colorchannelmixer=rr=%s:gg=%s:bb=%s", k, k, k))
	}
	if pr.Contrast != 0 {
		steps = append(steps, fmt.Sprintf("eq=contrast=%s", f(math.Max(0, 1+pr.Contrast/100))))
	}
	// Saturation is sent explicitly (0 = fully desaturated, 1 = unchanged)
	if pr.Saturation != 1 {
		steps = append(steps, fmt.Sprintf("eq=saturation=%s", f(math.Min(3, math.Max(0, pr.Saturation)))))
	}
	if pr.Preset == "warm" {
		steps = append(steps, sepiaFilter(0.28))
	} else if pr.Preset == "cool" {
		steps = append(steps, "hue=h=-18")
	}
	return append(steps, fx.filters...)
}

// grayscaleFilter interpolates between identity and the CSS grayscale
// luminance matrix.
func grayscaleFilter(a float64) string {
	r, g, bl := 0.2126*a, 0.7152*a, 0.0722*a
	return fmt.Sprintf("colorchannelmixer=rr=%s:rg=%s:rb=%s:gr=%s:gg=%s:gb=%s:br=%s:bg=%s:bb=%s",
		f(1-a+r), f(g), f(bl), f(r), f(1-a+g), f(bl), f(r), f(g), f(1-a+bl))
}

// sepiaFilter interpolates between identity and the CSS sepia matrix.
func sepiaFilter(a float64) string {
	return fmt.Sprintf("colorchannelmixer=rr=%s:rg=%s:rb=%s:gr=%s:gg=%s:gb=%s:br=%s:bg=%s:bb=%s",
		f(1-a+0.393*a), f(0.769*a), f(0.189*a),
		f(0.349*a), f(1-a+0.686*a), f(0.168*a),
		f(0.272*a), f(0.534*a), f(1-a+0.131*a))
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

/* ---------- audio ---------- */

const mixSampleRate = 48000

// buildAudio mixes every audio clip onto a silent bed spanning the whole
// timeline and returns the label of the mixed stream.
func (b *builder) buildAudio() string {
	p := b.p
	samples := int64(math.Ceil(p.Duration * mixSampleRate))

	bed := b.label("bed")
	b.chain(fmt.Sprintf("anullsrc=r=%d:cl=stereo,atrim=0:%s,asetpts=PTS-STARTPTS[%s]", mixSampleRate, f(p.Duration), bed))
	labels := []string{bed}

	for i := range p.Audio {
		a := &p.Audio[i]
		idx := b.addInput("-ss", f(a.In), "-t", f(a.Duration*a.Speed), "-i", a.Src)
		var steps []string
		if a.Reverse {
			steps = append(steps, "areverse")
		}
		steps = append(steps, "asetpts=PTS-STARTPTS")
		steps = append(steps, atempoChain(a.Speed)...)
		steps = append(steps, volumeExpr(a))
		steps = append(steps,
			fmt.Sprintf("aresample=%d", mixSampleRate),
			"aformat=sample_fmts=fltp:channel_layouts=stereo")
		if pan := panFilter(a); pan != "" {
			steps = append(steps, pan)
		}
		steps = append(steps,
			fmt.Sprintf("adelay=%d:all=1", int64(math.Round(a.Start*1000))),
			fmt.Sprintf("apad=whole_len=%d", samples),
			fmt.Sprintf("atrim=0:%s", f(p.Duration)),
		)
		lbl := b.label("a")
		b.chain(fmt.Sprintf("[%d:a]%s[%s]", idx, strings.Join(steps, ","), lbl))
		labels = append(labels, lbl)
	}

	out := b.label("aout")
	if len(labels) == 1 {
		b.chain(fmt.Sprintf("[%s]anull[%s]", bed, out))
		return out
	}
	// amix scales every input by 1/N while all are active; every input has
	// been padded to the full length, so the scaling is constant and can
	// be undone exactly. (The normalize option would do this, but only on
	// ffmpeg 4.4 and later.)
	n := len(labels)
	b.chain(fmt.Sprintf("%samix=inputs=%d:duration=first:dropout_transition=0,volume=%d[%s]",
		"["+strings.Join(labels, "][")+"]", n, n, out))
	return out
}

// atempoChain builds atempo filters for a playback rate. A single atempo
// only accepts 0.5..2 on older ffmpeg builds, so rates outside that range
// are reached in steps.
func atempoChain(speed float64) []string {
	if speed == 1 {
		return nil
	}
	var steps []string
	for speed < 0.5 {
		steps = append(steps, "atempo=0.5")
		speed /= 0.5
	}
	for speed > 2 {
		steps = append(steps, "atempo=2")
		speed /= 2
	}
	return append(steps, "atempo="+f(speed))
}

// volumeExpr shapes the clip volume over time: clip volume times the Fade
// To ramp times the fade in / out ramps, clamped to unity like the media
// element volume in the preview.
func volumeExpr(a *AudioClip) string {
	parts := []string{f(a.Volume)}
	if kf := a.Keyframes["volume"]; len(kf) > 0 {
		parts = append(parts, fmt.Sprintf("(clip(%s,0,400)/100)", kfExpr(kf, "t")))
	}
	if a.HasRamp {
		parts = append(parts, fmt.Sprintf("(%s+(%s)*min(1,max(0,t/%s)))",
			f(a.RampFrom), f(a.RampTo-a.RampFrom), f(math.Max(0.05, a.Duration))))
	}
	if a.FadeIn > 0 {
		k := fmt.Sprintf("min(1,max(0,t/%s))", f(math.Max(0.05, a.FadeIn)))
		if a.InCurve == "power" {
			k = "sin(" + k + "*PI/2)"
		}
		parts = append(parts, k)
	}
	if a.FadeOut > 0 {
		k := fmt.Sprintf("min(1,max(0,(%s-t)/%s))", f(a.Duration), f(math.Max(0.05, a.FadeOut)))
		if a.OutCurve == "power" {
			k = "sin(" + k + "*PI/2)"
		}
		parts = append(parts, k)
	}
	return fmt.Sprintf("volume=volume='min(1,%s)':eval=frame", strings.Join(parts, "*"))
}

// panFilter reproduces the Web Audio StereoPannerNode (equal-power panning
// of a stereo source) the preview uses. The pan filter cannot follow time,
// so an animated pan uses its first keyframe.
func panFilter(a *AudioClip) string {
	pan := a.Pan
	if kf := a.Keyframes["pan"]; len(kf) > 0 {
		pan = kf[0].V
	}
	p := math.Max(-1, math.Min(1, pan/100))
	if p == 0 {
		return ""
	}
	var x float64
	if p <= 0 {
		x = (p + 1) * math.Pi / 2
		// left = L + R*cos(x); right = R*sin(x)
		return fmt.Sprintf("pan=stereo|c0=c0+%s*c1|c1=%s*c1", f(math.Cos(x)), f(math.Sin(x)))
	}
	x = p * math.Pi / 2
	// left = L*cos(x); right = R + L*sin(x)
	return fmt.Sprintf("pan=stereo|c0=%s*c0|c1=c1+%s*c0", f(math.Cos(x)), f(math.Sin(x)))
}

/* ---------- encoders ---------- */

// encoderArgs picks codecs and rate control for the output container.
func encoderArgs(p *Project, enc *Encoder, hasVideo, hasAudio bool) []string {
	var args []string
	crf := map[string]string{QualityHigh: "18", QualityMedium: "23", QualityLow: "28"}[p.Quality]
	vp9crf := map[string]string{QualityHigh: "30", QualityMedium: "34", QualityLow: "38"}[p.Quality]
	vp9cpu := map[string]string{QualityHigh: "1", QualityMedium: "2", QualityLow: "4"}[p.Quality]
	abr := map[string]string{QualityHigh: "192k", QualityMedium: "160k", QualityLow: "128k"}[p.Quality]

	switch p.Format {
	case FormatMP4, FormatMOV, FormatMKV:
		if hasVideo {
			if enc != nil && enc.Codec != "" {
				args = append(args, "-c:v", enc.Codec)
				args = append(args, enc.Args...)
			} else {
				args = append(args, "-c:v", "libx264", "-preset", "medium", "-crf", crf, "-profile:v", "high")
			}
			args = append(args, "-r", f(p.FPS))
		}
		if hasAudio {
			args = append(args, "-c:a", "aac", "-b:a", abr)
		}
		if p.Format != FormatMKV {
			args = append(args, "-movflags", "+faststart")
		}
	case FormatWebM:
		if hasVideo {
			args = append(args, "-c:v", "libvpx-vp9", "-crf", vp9crf, "-b:v", "0", "-row-mt", "1",
				"-deadline", "good", "-cpu-used", vp9cpu, "-r", f(p.FPS))
		}
		if hasAudio {
			args = append(args, "-c:a", "libopus", "-b:a", abr)
		}
	case FormatGIF:
		args = append(args, "-loop", "0")
	case FormatM4A:
		args = append(args, "-c:a", "aac", "-b:a", abr, "-movflags", "+faststart")
	}
	return args
}
