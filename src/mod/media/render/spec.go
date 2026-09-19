package render

/*
	spec.go

	Timeline render specification.

	A Project is what a timeline editor (Cine Studio) sends to the server to
	have its edit rendered by ffmpeg instead of by recording the browser's
	preview in real time. It is deliberately a *flattened* description: the
	front end has already resolved which clips are visible, in which paint
	order, which audio is audible and which clip a transition blends from, so
	the graph builder only has to translate geometry, colour, effects and
	timing into ffmpeg filters.

	Times are in seconds on the output timeline unless stated otherwise.
*/

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
)

// Output containers the renderer knows how to encode.
const (
	FormatMP4  = "mp4"
	FormatMOV  = "mov"
	FormatMKV  = "mkv"
	FormatWebM = "webm"
	FormatGIF  = "gif"
	FormatM4A  = "m4a"
)

// Quality presets, mapped onto encoder rate-control settings per format.
const (
	QualityHigh   = "high"
	QualityMedium = "medium"
	QualityLow    = "low"
)

// Layer kinds. Generated clips (titles, colour boards) reach the renderer as
// pre-rendered PNG images, so they are plain image layers here. An
// adjustment layer has no picture of its own: its colour controls and
// effects are applied to everything painted below it.
const (
	LayerVideo  = "video"
	LayerImage  = "image"
	LayerAdjust = "adjust"
)

// Limits that keep a malformed or hostile spec from spawning an absurd
// ffmpeg invocation.
const (
	maxDimension = 8192
	maxLayers    = 512
	maxDuration  = 6 * 3600 // seconds
	maxFPS       = 120
	// ffmpeg's reverse filters hold the whole clip in memory
	maxReverseSeconds = 600
	maxKeyframes      = 2000
)

// Keyframe is one point of an animated property: value V at T seconds from
// the start of the clip, reached from the previous keyframe linearly, with
// an ease-in / ease-out curve, or held (a step) - the same rules the
// editor's keyframes.js applies.
type Keyframe struct {
	T    float64 `json:"t"`
	V    float64 `json:"v"`
	Ease string  `json:"ease"`
}

// Project is the complete description of one render.
type Project struct {
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	FPS      float64 `json:"fps"`
	Duration float64 `json:"duration"`

	// Scale shrinks the output frame (1 = project size, 0.5 = half, 0.25 =
	// quarter). Layers are still composited at project size so geometry is
	// identical to the preview; only the final frame is resized.
	Scale float64 `json:"scale"`

	Format  string `json:"format"`
	Quality string `json:"quality"`

	// Hardware asks for the host's hardware H.264 encoder when one is
	// available; the software encoder is used otherwise.
	Hardware bool `json:"hardware"`

	// Layers in paint order: the first is drawn at the bottom.
	Layers []Layer `json:"layers"`

	// Audio clips to mix. Video layers whose sound is audible appear here
	// again as audio clips, so every layer can be rendered picture-only.
	Audio []AudioClip `json:"audio"`
}

// Layer is one picture clip on the timeline.
type Layer struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`

	// Src is the media file. The front end sends a virtual path; the AGI
	// glue replaces it with a local real path before the graph is built.
	Src string `json:"src"`

	Start    float64 `json:"start"`    // timeline position
	Duration float64 `json:"duration"` // timeline length (after speed)
	In       float64 `json:"in"`       // source offset, video only
	Speed    float64 `json:"speed"`    // playback rate, video only; 0 = 1
	Reverse  bool    `json:"reverse"`  // play the source range backwards

	Props Props `json:"props"`

	// Transition plays over the first Transition.Duration seconds of this
	// layer, blending from PrevID (a layer on the same track that ends where
	// this one starts) or, when PrevID is empty, from nothing.
	Transition *Transition `json:"transition,omitempty"`
	PrevID     string      `json:"prevId"`
}

// Props mirrors the clip properties of the Cine Studio compositor
// (player.js drawClip) so the server renders what the preview shows.
type Props struct {
	X          float64  `json:"x"`
	Y          float64  `json:"y"`
	Scale      float64  `json:"scale"`    // percent, 100 = as fitted
	Rotation   float64  `json:"rotation"` // degrees, clockwise
	Opacity    float64  `json:"opacity"`  // percent
	Crop       string   `json:"crop"`     // fit | fill | stretch
	CropTop    float64  `json:"cropTop"`  // source pixels
	CropBottom float64  `json:"cropBottom"`
	CropLeft   float64  `json:"cropLeft"`
	CropRight  float64  `json:"cropRight"`
	Preset     string   `json:"preset"` // default | warm | cool
	Exposure   float64  `json:"exposure"`
	Contrast   float64  `json:"contrast"`
	Saturation float64  `json:"saturation"`
	Blend      string   `json:"blend"`
	FlipH      bool     `json:"flipH"`
	FlipV      bool     `json:"flipV"`
	Effects    []Effect `json:"effects"`

	// Keyframes animate x, y, scale, rotation and opacity; an animated
	// property ignores its static value above.
	Keyframes map[string][]Keyframe `json:"keyframes"`
}

// Effect is one entry of a clip's effect stack. Colour, Similarity and
// Soft belong to the chroma key; every other effect carries an Amount.
type Effect struct {
	Type       string  `json:"type"`
	Amount     float64 `json:"amount"`
	Color      string  `json:"color"`
	Similarity float64 `json:"similarity"`
	Soft       float64 `json:"soft"`
}

// Transition describes how a layer blends in.
type Transition struct {
	Type     string  `json:"type"` // dissolve | fade | wipe
	Duration float64 `json:"duration"`
}

// AudioClip is one audible clip. Volume shaping matches player.js
// syncElements: the clip volume times the fade ramps, clamped to unity.
type AudioClip struct {
	ID       string  `json:"id"`
	Src      string  `json:"src"`
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
	In       float64 `json:"in"`
	Speed    float64 `json:"speed"`
	Reverse  bool    `json:"reverse"`
	Volume   float64 `json:"volume"`   // 0..1
	Pan      float64 `json:"pan"`      // -100 (left) .. 100 (right)
	FadeIn   float64 `json:"fadeIn"`   // seconds, 0 = none
	FadeOut  float64 `json:"fadeOut"`  // seconds, 0 = none
	InCurve  string  `json:"inCurve"`  // linear (default) | power
	OutCurve string  `json:"outCurve"` // linear (default) | power
	HasRamp  bool    `json:"hasRamp"`  // Fade To effect present
	RampFrom float64 `json:"rampFrom"`
	RampTo   float64 `json:"rampTo"`

	// Keyframes animate the volume (percent) and the pan; animated volume
	// multiplies the static Volume like the editor does.
	Keyframes map[string][]Keyframe `json:"keyframes"`
}

// xfadeTransitions maps the editor's transition names onto ffmpeg xfade
// transitions. The map doubles as the list of accepted types.
var xfadeTransitions = map[string]string{
	"dissolve":  "fade",
	"fade":      "fadeblack",
	"dipwhite":  "fadewhite",
	"blur":      "hblur",
	"pixelate":  "pixelize",
	"wipe":      "wiperight",
	"wipeleft":  "wipeleft",
	"wipeup":    "wipeup",
	"wipedown":  "wipedown",
	"barndoors": "horzopen",
	"diagonal":  "diagtl",
	"radial":    "radial",
	"pushleft":  "slideleft",
	"pushright": "slideright",
	"pushup":    "slideup",
	"pushdown":  "slidedown",
	"iris":      "circleopen",
	"irisclose": "circleclose",
	"zoom":      "zoomin",
}

var (
	validFormats   = map[string]bool{FormatMP4: true, FormatMOV: true, FormatMKV: true, FormatWebM: true, FormatGIF: true, FormatM4A: true}
	validQualities = map[string]bool{QualityHigh: true, QualityMedium: true, QualityLow: true}
	validCrops     = map[string]bool{"": true, "fit": true, "fill": true, "stretch": true}
	validPresets   = map[string]bool{"": true, "default": true, "warm": true, "cool": true, "mono": true, "vivid": true}
	validEffects   = map[string]bool{"bw": true, "sepia": true, "invert": true, "hue": true, "blur": true, "pixelate": true, "mirror": true, "vignette": true, "grain": true, "chromakey": true, "sharpen": true, "fadein": true, "fadeout": true, "fadeto": true}
	validCurves    = map[string]bool{"": true, "linear": true, "power": true}
	validEases     = map[string]bool{"": true, "linear": true, "ease": true, "hold": true}
	layerKeyframes = map[string]bool{"x": true, "y": true, "scale": true, "rotation": true, "opacity": true}
	audioKeyframes = map[string]bool{"volume": true, "pan": true}

	// blendModes maps the compositor's globalCompositeOperation names onto
	// ffmpeg blend filter modes.
	blendModes = map[string]string{
		"":           "",
		"normal":     "",
		"multiply":   "multiply",
		"screen":     "screen",
		"overlay":    "overlay",
		"lighter":    "addition",
		"soft-light": "softlight",
		"difference": "difference",
	}
)

// Validate checks that the spec is complete and inside sane limits, and
// fills the defaults the front end may omit. It never touches the file
// system: whether Src paths exist is the caller's business.
func (p *Project) Validate() error {
	if p.Width < 2 || p.Height < 2 || p.Width > maxDimension || p.Height > maxDimension {
		return fmt.Errorf("frame size %dx%d is out of range", p.Width, p.Height)
	}
	if p.FPS <= 0 || p.FPS > maxFPS || math.IsNaN(p.FPS) || math.IsInf(p.FPS, 0) {
		return fmt.Errorf("frame rate %v is out of range", p.FPS)
	}
	if !(p.Duration > 0) || p.Duration > maxDuration {
		return fmt.Errorf("duration %v is out of range", p.Duration)
	}
	if p.Scale == 0 {
		p.Scale = 1
	}
	if p.Scale < 0.05 || p.Scale > 1 {
		return fmt.Errorf("output scale %v is out of range", p.Scale)
	}
	if p.Format == "" {
		p.Format = FormatMP4
	}
	if !validFormats[p.Format] {
		return fmt.Errorf("unsupported output format %q", p.Format)
	}
	if p.Quality == "" {
		p.Quality = QualityHigh
	}
	if !validQualities[p.Quality] {
		return fmt.Errorf("unsupported quality %q", p.Quality)
	}
	if len(p.Layers) > maxLayers || len(p.Audio) > maxLayers {
		return errors.New("too many clips")
	}
	if len(p.Layers) == 0 && len(p.Audio) == 0 {
		return errors.New("the timeline is empty")
	}

	ids := map[string]bool{}
	for i := range p.Layers {
		l := &p.Layers[i]
		if l.ID == "" || ids[l.ID] {
			return fmt.Errorf("layer %d has a missing or duplicate id", i)
		}
		ids[l.ID] = true
		if l.Kind != LayerVideo && l.Kind != LayerImage && l.Kind != LayerAdjust {
			return fmt.Errorf("layer %s: unsupported kind %q", l.ID, l.Kind)
		}
		if l.Src == "" && l.Kind != LayerAdjust {
			return fmt.Errorf("layer %s: no source file", l.ID)
		}
		if l.Kind == LayerAdjust {
			l.Src = ""
			l.Transition = nil
		}
		if err := checkTime("layer "+l.ID, l.Start, l.Duration, l.In, p.Duration); err != nil {
			return err
		}
		if l.Speed <= 0 {
			l.Speed = 1
		}
		if l.Speed < 0.05 || l.Speed > 100 {
			return fmt.Errorf("layer %s: speed %v is out of range", l.ID, l.Speed)
		}
		if l.Reverse && l.Duration*l.Speed > maxReverseSeconds {
			return fmt.Errorf("layer %s: reversed clips are limited to %d seconds of source", l.ID, maxReverseSeconds)
		}
		if err := l.Props.validate(l.ID); err != nil {
			return err
		}
		if err := checkKeyframes("layer "+l.ID, l.Props.Keyframes, layerKeyframes); err != nil {
			return err
		}
		if l.Transition != nil {
			if _, ok := xfadeTransitions[l.Transition.Type]; !ok {
				return fmt.Errorf("layer %s: unsupported transition %q", l.ID, l.Transition.Type)
			}
			if !(l.Transition.Duration > 0) {
				return fmt.Errorf("layer %s: transition duration must be positive", l.ID)
			}
			// A transition can never outlast its own clip
			if l.Transition.Duration > l.Duration {
				l.Transition.Duration = l.Duration
			}
		}
	}
	for i := range p.Audio {
		a := &p.Audio[i]
		if a.ID == "" {
			return fmt.Errorf("audio clip %d has no id", i)
		}
		if a.Src == "" {
			return fmt.Errorf("audio clip %s: no source file", a.ID)
		}
		if err := checkTime("audio clip "+a.ID, a.Start, a.Duration, a.In, p.Duration); err != nil {
			return err
		}
		if a.Speed <= 0 {
			a.Speed = 1
		}
		if a.Speed < 0.05 || a.Speed > 100 {
			return fmt.Errorf("audio clip %s: speed %v is out of range", a.ID, a.Speed)
		}
		if a.Volume < 0 || a.Volume > 4 || math.IsNaN(a.Volume) {
			return fmt.Errorf("audio clip %s: volume %v is out of range", a.ID, a.Volume)
		}
		if a.Pan < -100 || a.Pan > 100 || math.IsNaN(a.Pan) {
			return fmt.Errorf("audio clip %s: pan %v is out of range", a.ID, a.Pan)
		}
		if a.FadeIn < 0 || a.FadeOut < 0 || a.FadeIn > maxDuration || a.FadeOut > maxDuration {
			return fmt.Errorf("audio clip %s: fade length is out of range", a.ID)
		}
		if !validCurves[a.InCurve] || !validCurves[a.OutCurve] {
			return fmt.Errorf("audio clip %s: unsupported fade curve", a.ID)
		}
		if a.HasRamp && (a.RampFrom < 0 || a.RampTo < 0 || a.RampFrom > 4 || a.RampTo > 4) {
			return fmt.Errorf("audio clip %s: fade ramp is out of range", a.ID)
		}
		if a.Reverse && a.Duration*a.Speed > maxReverseSeconds {
			return fmt.Errorf("audio clip %s: reversed clips are limited to %d seconds of source", a.ID, maxReverseSeconds)
		}
		if err := checkKeyframes("audio clip "+a.ID, a.Keyframes, audioKeyframes); err != nil {
			return err
		}
	}
	return nil
}

// checkKeyframes validates animated properties: known keys, finite values,
// sane easing, and sorts each list by time.
func checkKeyframes(what string, kfs map[string][]Keyframe, allowed map[string]bool) error {
	total := 0
	for key, list := range kfs {
		if !allowed[key] {
			return fmt.Errorf("%s: property %q cannot be animated", what, key)
		}
		total += len(list)
		if total > maxKeyframes {
			return fmt.Errorf("%s: too many keyframes", what)
		}
		for i := range list {
			k := &list[i]
			if math.IsNaN(k.T) || math.IsInf(k.T, 0) || math.IsNaN(k.V) || math.IsInf(k.V, 0) || k.T < 0 {
				return fmt.Errorf("%s: invalid keyframe on %s", what, key)
			}
			if !validEases[k.Ease] {
				return fmt.Errorf("%s: unsupported keyframe easing %q", what, k.Ease)
			}
		}
		sort.SliceStable(list, func(i, j int) bool { return list[i].T < list[j].T })
		kfs[key] = list
	}
	return nil
}

func checkTime(what string, start, duration, in, total float64) error {
	for _, v := range []float64{start, duration, in} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Errorf("%s: invalid timing", what)
		}
	}
	if start < 0 || in < 0 || !(duration > 0) {
		return fmt.Errorf("%s: invalid timing", what)
	}
	if start+duration > total+1 {
		return fmt.Errorf("%s: extends past the end of the timeline", what)
	}
	return nil
}

func (pr *Props) validate(id string) error {
	if !validCrops[pr.Crop] {
		return fmt.Errorf("layer %s: unsupported crop mode %q", id, pr.Crop)
	}
	if pr.Crop == "" {
		pr.Crop = "fit"
	}
	if pr.Scale == 0 {
		pr.Scale = 100
	}
	if !validPresets[pr.Preset] {
		return fmt.Errorf("layer %s: unsupported colour preset %q", id, pr.Preset)
	}
	if _, ok := blendModes[pr.Blend]; !ok {
		return fmt.Errorf("layer %s: unsupported blend mode %q", id, pr.Blend)
	}
	for _, v := range []float64{pr.X, pr.Y, pr.Scale, pr.Rotation, pr.Opacity, pr.CropTop, pr.CropBottom, pr.CropLeft, pr.CropRight, pr.Exposure, pr.Contrast, pr.Saturation} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Errorf("layer %s: invalid property value", id)
		}
	}
	if pr.CropTop < 0 || pr.CropBottom < 0 || pr.CropLeft < 0 || pr.CropRight < 0 {
		return fmt.Errorf("layer %s: negative crop", id)
	}
	if pr.Scale < 0 || pr.Scale > 10000 {
		return fmt.Errorf("layer %s: scale %v is out of range", id, pr.Scale)
	}
	if pr.Opacity < 0 || pr.Opacity > 100 {
		return fmt.Errorf("layer %s: opacity %v is out of range", id, pr.Opacity)
	}
	for i := range pr.Effects {
		e := &pr.Effects[i]
		if !validEffects[e.Type] {
			return fmt.Errorf("layer %s: unsupported effect %q", id, e.Type)
		}
		for _, v := range []float64{e.Amount, e.Similarity, e.Soft} {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return fmt.Errorf("layer %s: invalid amount for effect %s", id, e.Type)
			}
		}
		if e.Type == "chromakey" {
			if e.Color == "" {
				e.Color = "#00ff00"
			}
			if !hexColour.MatchString(e.Color) {
				return fmt.Errorf("layer %s: invalid key colour %q", id, e.Color)
			}
		}
	}
	return nil
}

var hexColour = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
