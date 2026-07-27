package icons

/*
	options.go

	Tunable parameters of the desktop icon renderer. Adjust the Default* values
	below to change the look of every generated desktop icon, or pass a custom
	Options value to NewGeneratorWithOptions for a one-off.
*/

const (
	/*
		DefaultSquircleFactor is the "squareness" factor f of the generated
		squircle backplate. The backplate is the superellipse (Lame curve)

			|x/r|^n + |y/r|^n = 1,  where n = 2 / (1 - f)

		so f = 0 renders a perfect circle, f = 0.5 the classic squircle and
		f approaching 1 approaches a plain square.
	*/
	DefaultSquircleFactor = 0.75

	//DefaultIconSize is the output resolution in px of the generated
	//desktop_icon.png, matching the hand drawn desktop icons of the built-in apps
	DefaultIconSize = 128

	//DefaultBackplateRatio is the width of the squircle backplate relative to
	//the canvas size. The hand drawn desktop icons of the built-in web apps all
	//sit at around 0.70 of their canvas, so match that to keep the generated
	//icons the same visual size as the rest of the desktop.
	DefaultBackplateRatio = 0.70

	//DefaultContentRatio is the width of the module icon relative to the
	//*backplate* (not the canvas), so the backplate size can be tuned without
	//having to re-balance the padding. The remainder is the padding drawn
	//around the icon.
	DefaultContentRatio = 0.66

	//DefaultSampleSteps is the supersampling grid size (n x n samples per pixel)
	//used to antialias the edge of the squircle backplate
	DefaultSampleSteps = 4

	//DefaultLumaThreshold is the perceived luminance (0 - 1) above which a
	//module icon counts as "bright" and gets a black backplate instead of white
	DefaultLumaThreshold = 0.5

	//DefaultSVGRenderSize is the resolution SVG module icons are rasterized at
	//before being scaled down onto the backplate
	DefaultSVGRenderSize = 512
)

// Options controls how a desktop icon is rendered. See the Default* constants
// above for the meaning of each field.
type Options struct {
	SquircleFactor float64
	IconSize       int
	BackplateRatio float64
	ContentRatio   float64
	SampleSteps    int
	LumaThreshold  float64
	SVGRenderSize  int
}

// DefaultOptions returns the rendering options used by NewGenerator.
func DefaultOptions() Options {
	return Options{
		SquircleFactor: DefaultSquircleFactor,
		IconSize:       DefaultIconSize,
		BackplateRatio: DefaultBackplateRatio,
		ContentRatio:   DefaultContentRatio,
		SampleSteps:    DefaultSampleSteps,
		LumaThreshold:  DefaultLumaThreshold,
		SVGRenderSize:  DefaultSVGRenderSize,
	}
}

// withDefaults fills in any unset field with its default so a caller can
// override just the parameters it cares about.
func (o Options) withDefaults() Options {
	defaults := DefaultOptions()
	if o.SquircleFactor <= 0 {
		o.SquircleFactor = defaults.SquircleFactor
	}
	if o.IconSize <= 0 {
		o.IconSize = defaults.IconSize
	}
	if o.BackplateRatio <= 0 {
		o.BackplateRatio = defaults.BackplateRatio
	}
	if o.ContentRatio <= 0 {
		o.ContentRatio = defaults.ContentRatio
	}
	if o.SampleSteps <= 0 {
		o.SampleSteps = defaults.SampleSteps
	}
	if o.LumaThreshold <= 0 {
		o.LumaThreshold = defaults.LumaThreshold
	}
	if o.SVGRenderSize <= 0 {
		o.SVGRenderSize = defaults.SVGRenderSize
	}
	return o
}
