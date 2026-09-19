package render

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

/*
	Tests for the timeline renderer.

	The graph builder is pure, so most tests inspect the produced arguments.
	TestRenderWithFFmpeg additionally runs the real ffmpeg when one is on the
	PATH, rendering a small project that exercises every feature of the
	graph, and is skipped otherwise so the suite passes on any CI box.
*/

func baseProject() *Project {
	return &Project{
		Width:    320,
		Height:   180,
		FPS:      25,
		Duration: 4,
		Format:   FormatMP4,
		Quality:  QualityLow,
	}
}

func defaultProps() Props {
	return Props{Scale: 100, Opacity: 100, Crop: "fit", Saturation: 1, Blend: "normal", Preset: "default"}
}

func videoLayer(id, src string, start, dur float64) Layer {
	return Layer{ID: id, Kind: LayerVideo, Src: src, Start: start, Duration: dur, Speed: 1, Props: defaultProps()}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(p *Project)
		wantErr string
	}{
		{"valid single layer", func(p *Project) {
			p.Layers = []Layer{videoLayer("a", "a.mp4", 0, 4)}
		}, ""},
		{"empty timeline", func(p *Project) {}, "empty"},
		{"bad frame size", func(p *Project) {
			p.Width = 0
			p.Layers = []Layer{videoLayer("a", "a.mp4", 0, 4)}
		}, "frame size"},
		{"bad fps", func(p *Project) {
			p.FPS = 500
			p.Layers = []Layer{videoLayer("a", "a.mp4", 0, 4)}
		}, "frame rate"},
		{"unknown format", func(p *Project) {
			p.Format = "avi"
			p.Layers = []Layer{videoLayer("a", "a.mp4", 0, 4)}
		}, "format"},
		{"duplicate ids", func(p *Project) {
			p.Layers = []Layer{videoLayer("a", "a.mp4", 0, 2), videoLayer("a", "b.mp4", 2, 2)}
		}, "duplicate"},
		{"layer past the end", func(p *Project) {
			p.Layers = []Layer{videoLayer("a", "a.mp4", 3, 4)}
		}, "past the end"},
		{"unknown effect", func(p *Project) {
			l := videoLayer("a", "a.mp4", 0, 4)
			l.Props.Effects = []Effect{{Type: "explode", Amount: 1}}
			p.Layers = []Layer{l}
		}, "effect"},
		{"unknown blend", func(p *Project) {
			l := videoLayer("a", "a.mp4", 0, 4)
			l.Props.Blend = "xor"
			p.Layers = []Layer{l}
		}, "blend"},
		{"unknown transition", func(p *Project) {
			l := videoLayer("a", "a.mp4", 0, 4)
			l.Transition = &Transition{Type: "spin", Duration: 1}
			p.Layers = []Layer{l}
		}, "transition"},
		{"audio only is fine", func(p *Project) {
			p.Audio = []AudioClip{{ID: "x", Src: "x.wav", Start: 0, Duration: 4, Volume: 1}}
		}, ""},
		{"audio volume out of range", func(p *Project) {
			p.Audio = []AudioClip{{ID: "x", Src: "x.wav", Start: 0, Duration: 4, Volume: 9}}
		}, "volume"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := baseProject()
			tt.mutate(p)
			err := p.Validate()
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("want error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestValidateFillsDefaults(t *testing.T) {
	p := baseProject()
	p.Format = ""
	p.Quality = ""
	p.Scale = 0
	l := videoLayer("a", "a.mp4", 0, 4)
	l.Speed = 0
	l.Props.Scale = 0
	l.Props.Crop = ""
	l.Transition = &Transition{Type: "dissolve", Duration: 99}
	p.Layers = []Layer{l}
	if err := p.Validate(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got := p.Layers[0]
	if p.Format != FormatMP4 || p.Quality != QualityHigh || p.Scale != 1 {
		t.Errorf("project defaults not filled: %+v", p)
	}
	if got.Speed != 1 || got.Props.Scale != 100 || got.Props.Crop != "fit" {
		t.Errorf("layer defaults not filled: %+v", got)
	}
	if got.Transition.Duration != 4 {
		t.Errorf("transition should be capped to the clip length, got %v", got.Transition.Duration)
	}
}

func TestFloatFormat(t *testing.T) {
	tests := []struct {
		in   float64
		want string
	}{
		{0, "0"}, {1, "1"}, {0.5, "0.5"}, {2.125, "2.125"}, {1e-9, "0"}, {-0.25, "-0.25"}, {30, "30"}, {1234567.5, "1234567.5"},
	}
	for _, tt := range tests {
		if got := f(tt.in); got != tt.want {
			t.Errorf("f(%v) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestAtempoChain(t *testing.T) {
	tests := []struct {
		speed float64
		want  []string
	}{
		{1, nil},
		{2, []string{"atempo=2"}},
		{0.5, []string{"atempo=0.5"}},
		{4, []string{"atempo=2", "atempo=2"}},
		{0.25, []string{"atempo=0.5", "atempo=0.5"}},
		{3, []string{"atempo=2", "atempo=1.5"}},
	}
	for _, tt := range tests {
		got := atempoChain(tt.speed)
		if strings.Join(got, ",") != strings.Join(tt.want, ",") {
			t.Errorf("atempoChain(%v) = %v, want %v", tt.speed, got, tt.want)
		}
	}
}

func TestVolumeExpr(t *testing.T) {
	plain := volumeExpr(&AudioClip{Volume: 0.8, Duration: 4})
	if plain != "volume=volume='min(1,0.8)':eval=frame" {
		t.Errorf("plain volume expression = %q", plain)
	}
	shaped := volumeExpr(&AudioClip{Volume: 1, Duration: 4, FadeIn: 1, FadeOut: 0.5, HasRamp: true, RampFrom: 1, RampTo: 0})
	for _, want := range []string{"t/1)", "(4-t)/0.5", "(1+(-1)*min(1,max(0,t/4)))"} {
		if !strings.Contains(shaped, want) {
			t.Errorf("shaped volume expression %q lacks %q", shaped, want)
		}
	}
}

func TestProxyHeight(t *testing.T) {
	tests := []struct {
		h    int
		q    float64
		want int
	}{
		{1080, 1, 0}, {1080, 0.5, 540}, {1080, 0.25, 270}, {720, 0.25, 240}, {2160, 0.25, 540}, {0, 0.5, 0}, {1080, 0, 0},
	}
	for _, tt := range tests {
		if got := ProxyHeight(tt.h, tt.q); got != tt.want {
			t.Errorf("ProxyHeight(%d, %v) = %d, want %d", tt.h, tt.q, got, tt.want)
		}
	}
}

func TestProxyArgs(t *testing.T) {
	if _, err := ProxyArgs("bogus", "in", 0, nil); err == nil {
		t.Fatal("unknown kind must be rejected")
	}
	video, err := ProxyArgs(ProxyVideo, "in.mkv", 360, nil)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(video, " ")
	for _, want := range []string{"-i in.mkv", "min(ih,360)", "libx264", "+faststart", "-c:a aac"} {
		if !strings.Contains(joined, want) {
			t.Errorf("video proxy args %q lack %q", joined, want)
		}
	}
	hw, _ := ProxyArgs(ProxyVideo, "in.mkv", 0, &Encoder{Codec: "h264_vaapi", PreInput: []string{"-vaapi_device", "x"}, FinalFilter: "format=nv12,hwupload"})
	joined = strings.Join(hw, " ")
	if !strings.Contains(joined, "-vaapi_device x -i in.mkv") || !strings.Contains(joined, "format=nv12,hwupload -c:v h264_vaapi") {
		t.Errorf("hardware proxy args = %q", joined)
	}
	audio, _ := ProxyArgs(ProxyAudio, "in.wma", 0, nil)
	if !strings.Contains(strings.Join(audio, " "), "-vn") {
		t.Errorf("audio proxy must drop video: %v", audio)
	}
	if ProxyCacheName("abc", ProxyVideo, 360) != "proxy_abc_360.mp4" {
		t.Errorf("unexpected cache name %q", ProxyCacheName("abc", ProxyVideo, 360))
	}
}

func TestBuildArgsGraph(t *testing.T) {
	p := baseProject()
	a := videoLayer("a", "a.mp4", 0, 2)
	a.Props.Rotation = 15
	a.Props.Opacity = 50
	a.Props.CropLeft = 10
	a.Props.Effects = []Effect{{Type: "bw", Amount: 100}, {Type: "vignette", Amount: 50}, {Type: "fadein", Amount: 0.5}}
	b := videoLayer("b", "b.mp4", 2, 2)
	b.Transition = &Transition{Type: "wipe", Duration: 1}
	b.PrevID = "a"
	img := Layer{ID: "t", Kind: LayerImage, Src: "title.png", Start: 1, Duration: 2, Props: defaultProps()}
	img.Props.Blend = "multiply"
	p.Layers = []Layer{a, b, img}
	p.Audio = []AudioClip{{ID: "a", Src: "a.mp4", Start: 0, Duration: 2, Volume: 1, Speed: 2}}

	res, err := BuildArgs(p, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.DurationMs != 4000 {
		t.Errorf("DurationMs = %d, want 4000", res.DurationMs)
	}
	joined := strings.Join(res.Args, " ")
	var graph string
	for i, arg := range res.Args {
		if arg == "-filter_complex" {
			graph = res.Args[i+1]
		}
	}
	checks := []string{
		"-ss 0 -t 2 -i a.mp4",
		"-loop 1 -framerate 25 -t 2 -i title.png",
		"-ss 0 -t 2 -i a.mp4",
		"-c:v libx264",
		"-c:a aac",
		"-t 4",
	}
	for _, want := range checks {
		if !strings.Contains(joined, want) {
			t.Errorf("args %q lack %q", joined, want)
		}
	}
	graphChecks := []string{
		"rotate=15*PI/180",
		"colorchannelmixer=aa=0.5",
		"crop=w='max(2,iw-10)'",
		"fade=t=in:st=0:d=0.5:alpha=1",
		"tpad=stop_mode=clone:stop_duration=1",
		"xfade=transition=wiperight:duration=1:offset=2",
		"blend=all_mode=multiply",
		"geq=r=0:g=0:b=0:a=",
		"atempo=2",
		"amix=inputs=2:duration=first:dropout_transition=0,volume=2",
		"format=yuv420p",
	}
	for _, want := range graphChecks {
		if !strings.Contains(graph, want) {
			t.Errorf("graph lacks %q:\n%s", want, graph)
		}
	}
	// grayscale matrix must be the CSS luminance weights at full strength
	if !strings.Contains(graph, "colorchannelmixer=rr=0.2126:rg=0.7152:rb=0.0722") {
		t.Errorf("grayscale matrix missing from graph")
	}
}

func TestBuildArgsFormats(t *testing.T) {
	tests := []struct {
		format string
		want   []string
		absent []string
	}{
		{FormatWebM, []string{"libvpx-vp9", "libopus"}, []string{"libx264"}},
		{FormatGIF, []string{"palettegen", "paletteuse", "-an", "-loop 0"}, []string{"aac"}},
		{FormatM4A, []string{"-vn", "-c:a aac"}, []string{"libx264", "-map [vout"}},
		{FormatMKV, []string{"libx264"}, []string{"faststart"}},
		{FormatMOV, []string{"libx264", "faststart"}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.format, func(t *testing.T) {
			p := baseProject()
			p.Format = tt.format
			p.Layers = []Layer{videoLayer("a", "a.mp4", 0, 4)}
			p.Audio = []AudioClip{{ID: "a", Src: "a.mp4", Start: 0, Duration: 4, Volume: 1}}
			res, err := BuildArgs(p, nil)
			if err != nil {
				t.Fatal(err)
			}
			joined := strings.Join(res.Args, " ")
			for _, w := range tt.want {
				if !strings.Contains(joined, w) {
					t.Errorf("%s args lack %q: %s", tt.format, w, joined)
				}
			}
			for _, a := range tt.absent {
				if strings.Contains(joined, a) {
					t.Errorf("%s args must not contain %q: %s", tt.format, a, joined)
				}
			}
		})
	}
}

func TestBuildArgsHardwareEncoder(t *testing.T) {
	p := baseProject()
	p.Layers = []Layer{videoLayer("a", "a.mp4", 0, 4)}
	enc := &Encoder{Codec: "h264_nvenc", FinalFilter: "format=nv12", Args: []string{"-preset", "fast"}}
	res, err := BuildArgs(p, enc)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(res.Args, " ")
	if !strings.Contains(joined, "-c:v h264_nvenc -preset fast") || strings.Contains(joined, "libx264") {
		t.Errorf("hardware encoder not applied: %s", joined)
	}
	if !strings.Contains(joined, "format=nv12[vout") {
		t.Errorf("hardware final filter missing: %s", joined)
	}
}

func TestBuildArgsOutputScale(t *testing.T) {
	p := baseProject()
	p.Scale = 0.25
	p.Layers = []Layer{videoLayer("a", "a.mp4", 0, 4)}
	res, err := BuildArgs(p, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(res.Args, " "), "scale=80:44:flags=lanczos") {
		t.Errorf("quarter-size output must scale to even 80x44: %v", res.Args)
	}
}

func TestSpecRoundTripsJSON(t *testing.T) {
	// The front end posts JSON: make sure the field names survive a trip
	src := `{"width":1920,"height":1080,"fps":30,"duration":5,"scale":0.5,"format":"mp4","quality":"high",
	 "layers":[{"id":"c1","kind":"video","src":"user:/a.mp4","start":0,"duration":5,"in":1,"speed":1,
	   "props":{"x":10,"y":-5,"scale":120,"rotation":0,"opacity":100,"crop":"fill","cropTop":0,"cropBottom":0,"cropLeft":0,"cropRight":0,
	     "preset":"warm","exposure":0.1,"contrast":5,"saturation":1.2,"blend":"normal","flipH":true,"flipV":false,
	     "effects":[{"type":"blur","amount":3}]},
	   "transition":{"type":"dissolve","duration":1},"prevId":""}],
	 "audio":[{"id":"c1","src":"user:/a.mp4","start":0,"duration":5,"in":1,"speed":1,"volume":0.5,"fadeIn":1,"fadeOut":0,"hasRamp":false}]}`
	var p Project
	if err := json.Unmarshal([]byte(src), &p); err != nil {
		t.Fatal(err)
	}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	l := p.Layers[0]
	if l.Props.Preset != "warm" || l.Props.Crop != "fill" || !l.Props.FlipH || l.Props.Effects[0].Type != "blur" || l.Transition.Type != "dissolve" {
		t.Errorf("layer fields lost in JSON: %+v", l)
	}
	if p.Audio[0].FadeIn != 1 || p.Audio[0].Volume != 0.5 {
		t.Errorf("audio fields lost in JSON: %+v", p.Audio[0])
	}
}

/* ---------- integration ---------- */

func runFFmpeg(t *testing.T, args ...string) {
	t.Helper()
	out, err := exec.Command("ffmpeg", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("ffmpeg %v failed: %v\n%s", args, err, out)
	}
}

func probe(t *testing.T, file string) (width, height int, duration float64) {
	t.Helper()
	out, err := exec.Command("ffprobe", "-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=width,height:format=duration", "-of", "default=nw=1", file).Output()
	if err != nil {
		t.Fatalf("ffprobe %s failed: %v", file, err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		kv := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "width":
			width, _ = strconv.Atoi(kv[1])
		case "height":
			height, _ = strconv.Atoi(kv[1])
		case "duration":
			duration, _ = strconv.ParseFloat(kv[1], 64)
		}
	}
	return
}

// TestRenderWithFFmpeg renders a project touching every branch of the graph
// builder with the real ffmpeg and checks the output is a sane file.
func TestRenderWithFFmpeg(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not installed")
	}
	dir := t.TempDir()
	clipA := filepath.Join(dir, "a.mp4")
	clipB := filepath.Join(dir, "b.mp4")
	still := filepath.Join(dir, "still.png")
	music := filepath.Join(dir, "music.wav")
	runFFmpeg(t, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25:duration=3",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", clipA)
	runFFmpeg(t, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "smptebars=size=200x300:rate=30:duration=3",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", clipB)
	runFFmpeg(t, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red@0.5:s=320x180:d=1,format=rgba", "-frames:v", "1", still)
	runFFmpeg(t, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=5", music)

	p := &Project{Width: 320, Height: 180, FPS: 25, Duration: 5, Scale: 0.5, Format: FormatMP4, Quality: QualityLow}
	a := videoLayer("a", clipA, 0, 2)
	a.In = 0.5
	a.Props.Rotation = 10
	a.Props.Opacity = 80
	a.Props.CropLeft = 20
	a.Props.CropTop = 10
	a.Props.Crop = "fill"
	a.Props.Exposure = 0.1
	a.Props.Contrast = 10
	a.Props.Saturation = 1.3
	a.Props.Preset = "warm"
	a.Props.Effects = []Effect{{Type: "bw", Amount: 40}, {Type: "invert", Amount: 20}, {Type: "hue", Amount: 30},
		{Type: "blur", Amount: 1}, {Type: "vignette", Amount: 60}, {Type: "grain", Amount: 30}, {Type: "fadein", Amount: 0.5}}
	b := videoLayer("b", clipB, 2, 2)
	b.Speed = 1.5
	b.Props.FlipH = true
	b.Props.Effects = []Effect{{Type: "pixelate", Amount: 8}, {Type: "mirror"}, {Type: "fadeout", Amount: 0.5}}
	b.Transition = &Transition{Type: "dissolve", Duration: 0.5}
	b.PrevID = "a"
	c := videoLayer("c", clipA, 4, 1)
	c.Transition = &Transition{Type: "wipe", Duration: 0.5}
	c.PrevID = "b"
	lone := videoLayer("lone", clipB, 3, 1.5)
	lone.Transition = &Transition{Type: "fade", Duration: 0.5}
	lone.Props.Scale = 40
	lone.Props.X = 80
	lone.Props.Y = -30
	overlay := Layer{ID: "png", Kind: LayerImage, Src: still, Start: 1, Duration: 3, Props: defaultProps()}
	overlay.Props.Blend = "multiply"
	overlay.Props.Opacity = 70
	soft := Layer{ID: "soft", Kind: LayerImage, Src: still, Start: 0, Duration: 1, Props: defaultProps()}
	soft.Props.Blend = "soft-light"
	p.Layers = []Layer{a, b, c, lone, overlay, soft}
	p.Audio = []AudioClip{
		{ID: "a", Src: clipA, Start: 0, Duration: 2, In: 0.5, Speed: 1, Volume: 0.9, FadeIn: 0.5},
		{ID: "m", Src: music, Start: 1, Duration: 4, Speed: 0.5, Volume: 0.6, FadeOut: 1, HasRamp: true, RampFrom: 1, RampTo: 0.2},
	}

	res, err := BuildArgs(p, nil)
	if err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "out.mp4")
	runFFmpeg(t, append(append([]string{"-y"}, res.Args...), out)...)

	w, h, d := probe(t, out)
	if w != 160 || h != 90 {
		t.Errorf("output size = %dx%d, want 160x90", w, h)
	}
	if d < 4.9 || d > 5.2 {
		t.Errorf("output duration = %v, want about 5", d)
	}
	if st, err := os.Stat(out); err != nil || st.Size() < 1000 {
		t.Errorf("output file looks empty: %v %v", st, err)
	}

	// The remaining containers only need to encode; keep them tiny
	for _, format := range []string{FormatWebM, FormatGIF, FormatM4A, FormatMKV} {
		t.Run(format, func(t *testing.T) {
			q := &Project{Width: 160, Height: 90, FPS: 10, Duration: 1, Format: format, Quality: QualityLow}
			q.Layers = []Layer{videoLayer("a", clipA, 0, 1)}
			q.Audio = []AudioClip{{ID: "a", Src: clipA, Start: 0, Duration: 1, Volume: 1}}
			res, err := BuildArgs(q, nil)
			if err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(dir, "out."+format)
			runFFmpeg(t, append(append([]string{"-y"}, res.Args...), target)...)
			if st, err := os.Stat(target); err != nil || st.Size() == 0 {
				t.Errorf("%s output missing: %v", format, err)
			}
		})
	}

	// Proxies of the same assets
	for _, tt := range []struct {
		kind, in string
		height   int
	}{{ProxyVideo, clipB, 240}, {ProxyAudio, music, 0}, {ProxyImage, still, 0}} {
		args, err := ProxyArgs(tt.kind, tt.in, tt.height, nil)
		if err != nil {
			t.Fatal(err)
		}
		target := filepath.Join(dir, "proxy_"+tt.kind+ProxyExtension[tt.kind])
		runFFmpeg(t, append(append([]string{"-y"}, args...), target)...)
		if tt.kind == ProxyVideo {
			pw, ph, _ := probe(t, target)
			if ph != 240 || pw != 160 {
				t.Errorf("video proxy size = %dx%d, want 160x240", pw, ph)
			}
		}
	}
}

/* ---------- keyframes, adjustment layers, keying, reverse ---------- */

func TestKeyframeExpr(t *testing.T) {
	tests := []struct {
		name string
		kfs  []Keyframe
		want []string
	}{
		{"single keyframe is a constant", []Keyframe{{T: 1, V: 50}}, []string{"if(lt(t,1),50,50)"}},
		{"linear segment", []Keyframe{{T: 0, V: 0}, {T: 2, V: 100}},
			[]string{"if(lt(t,0),0,if(lt(t,2),0+(100)*clip((t-0)/2,0,1),100))"}},
		{"ease uses smoothstep", []Keyframe{{T: 0, V: 0, Ease: "ease"}, {T: 1, V: 10}},
			[]string{"*(3-2*(clip((t-0)/1,0,1)))"}},
		{"hold keeps the first value", []Keyframe{{T: 0, V: 5, Ease: "hold"}, {T: 1, V: 10}},
			[]string{"if(lt(t,1),5,10)"}},
		{"blend clock variable", []Keyframe{{T: 0, V: 100}, {T: 1, V: 0}}, []string{"lt(T,1)", "clip((T-0)/1,0,1)"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v := "t"
			if tt.name == "blend clock variable" {
				v = "T"
			}
			got := kfExpr(tt.kfs, v)
			for _, w := range tt.want {
				if !strings.Contains(got, w) {
					t.Errorf("kfExpr = %q, want it to contain %q", got, w)
				}
			}
		})
	}
	if kfExpr(nil, "t") != "0" {
		t.Error("empty keyframe list must yield 0")
	}
}

func TestPanFilter(t *testing.T) {
	if panFilter(&AudioClip{Pan: 0}) != "" {
		t.Error("centre pan needs no filter")
	}
	left := panFilter(&AudioClip{Pan: -100})
	if !strings.HasPrefix(left, "pan=stereo|c0=c0+") || !strings.Contains(left, "c1=0*c1") {
		t.Errorf("hard left pan = %q", left)
	}
	right := panFilter(&AudioClip{Pan: 100})
	if !strings.Contains(right, "c0=0*c0") || !strings.Contains(right, "c1=c1+1*c0") {
		t.Errorf("hard right pan = %q", right)
	}
	animated := panFilter(&AudioClip{Keyframes: map[string][]Keyframe{"pan": {{T: 0, V: 50}, {T: 1, V: -50}}}})
	if !strings.HasPrefix(animated, "pan=stereo|c0=0.7071*c0") {
		t.Errorf("animated pan should use its first keyframe: %q", animated)
	}
}

func TestValidateAnimationAndAdjust(t *testing.T) {
	p := baseProject()
	adj := Layer{ID: "adj", Kind: LayerAdjust, Start: 0, Duration: 4, Props: defaultProps()}
	adj.Transition = &Transition{Type: "dissolve", Duration: 1}
	l := videoLayer("a", "a.mp4", 0, 4)
	l.Props.Keyframes = map[string][]Keyframe{"scale": {{T: 2, V: 50}, {T: 0, V: 100}}}
	p.Layers = []Layer{l, adj}
	p.Audio = []AudioClip{{ID: "a", Src: "a.mp4", Start: 0, Duration: 4, Volume: 1, Pan: 20, InCurve: "power",
		Keyframes: map[string][]Keyframe{"volume": {{T: 0, V: 100}, {T: 4, V: 0}}}}}
	if err := p.Validate(); err != nil {
		t.Fatalf("valid animated project rejected: %v", err)
	}
	if p.Layers[0].Props.Keyframes["scale"][0].T != 0 {
		t.Error("keyframes must be sorted by time")
	}
	if p.Layers[1].Transition != nil {
		t.Error("adjustment layers cannot carry transitions")
	}

	bad := baseProject()
	b1 := videoLayer("a", "a.mp4", 0, 4)
	b1.Props.Keyframes = map[string][]Keyframe{"blend": {{T: 0, V: 1}}}
	bad.Layers = []Layer{b1}
	if err := bad.Validate(); err == nil || !strings.Contains(err.Error(), "cannot be animated") {
		t.Errorf("unknown animated property must be rejected, got %v", err)
	}

	rev := baseProject()
	rev.Duration = 3600
	r := videoLayer("a", "a.mp4", 0, 1000)
	r.Reverse = true
	rev.Layers = []Layer{r}
	if err := rev.Validate(); err == nil || !strings.Contains(err.Error(), "reversed") {
		t.Errorf("long reversed clips must be rejected, got %v", err)
	}

	key := baseProject()
	k := videoLayer("a", "a.mp4", 0, 4)
	k.Props.Effects = []Effect{{Type: "chromakey", Color: "green"}}
	key.Layers = []Layer{k}
	if err := key.Validate(); err == nil || !strings.Contains(err.Error(), "key colour") {
		t.Errorf("bad key colour must be rejected, got %v", err)
	}
}

func TestBuildArgsAnimatedGraph(t *testing.T) {
	p := baseProject()
	l := videoLayer("a", "a.mp4", 0, 4)
	l.Reverse = true
	l.Props.Keyframes = map[string][]Keyframe{
		"scale":    {{T: 0, V: 100}, {T: 4, V: 50}},
		"x":        {{T: 0, V: -100}, {T: 4, V: 100}},
		"rotation": {{T: 0, V: 0}, {T: 4, V: 90}},
		"opacity":  {{T: 0, V: 100}, {T: 4, V: 0}},
	}
	l.Props.Effects = []Effect{{Type: "chromakey", Color: "#00ff00", Similarity: 30, Soft: 10}, {Type: "sharpen", Amount: 50}}
	adj := Layer{ID: "adj", Kind: LayerAdjust, Start: 1, Duration: 2, Props: defaultProps()}
	adj.Props.Saturation = 0
	adj.Props.Opacity = 50
	adj.Props.Effects = []Effect{{Type: "blur", Amount: 2}, {Type: "vignette", Amount: 40}}
	p.Layers = []Layer{l, adj}
	p.Audio = []AudioClip{{ID: "a", Src: "a.mp4", Start: 0, Duration: 4, Volume: 1, Reverse: true, Pan: -40,
		FadeIn: 1, InCurve: "power", FadeOut: 1, OutCurve: "linear",
		Keyframes: map[string][]Keyframe{"volume": {{T: 0, V: 100}, {T: 4, V: 20}}}}}
	res, err := BuildArgs(p, nil)
	if err != nil {
		t.Fatal(err)
	}
	var graph string
	for i, arg := range res.Args {
		if arg == "-filter_complex" {
			graph = res.Args[i+1]
		}
	}
	for _, want := range []string{
		"reverse,setpts", "areverse,asetpts",
		"chromakey=color=0x00ff00:similarity=0.3:blend=0.1",
		"unsharp=5:5:1.15",
		":eval=frame", "trunc(320*max(0.01,if(lt(t,0),100",
		"rotate=a='(if(lt(t,0),0,",
		"blend=all_mode=normal:c3_expr='B*clip(if(lt(T,0),100,",
		"overlay=x='(main_w-overlay_w)/2+(if(lt(t,0),-100,",
		"eq=saturation=0:enable='between(t,1,3)'",
		"gblur=sigma=2:enable='between(t,1,3)'",
		"blend=all_mode=normal:all_opacity=0.5",
		"sin(min(1,max(0,t/1))*PI/2)",
		"(clip(if(lt(t,0),100,",
		"pan=stereo|c0=c0+",
	} {
		if !strings.Contains(graph, want) {
			t.Errorf("graph lacks %q:\n%s", want, graph)
		}
	}
}

func TestBuildArgsAllTransitions(t *testing.T) {
	for name, xf := range xfadeTransitions {
		p := baseProject()
		a := videoLayer("a", "a.mp4", 0, 2)
		b := videoLayer("b", "b.mp4", 2, 2)
		b.Transition = &Transition{Type: name, Duration: 0.5}
		b.PrevID = "a"
		p.Layers = []Layer{a, b}
		res, err := BuildArgs(p, nil)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !strings.Contains(strings.Join(res.Args, " "), "xfade=transition="+xf+":") {
			t.Errorf("%s should map onto xfade %s", name, xf)
		}
	}
}

// TestRenderAnimatedWithFFmpeg renders keyframed motion, an adjustment
// layer, a chroma key, reversed clips and every xfade transition with the
// real ffmpeg, so a filter that a build does not accept is caught here
// rather than by a user.
func TestRenderAnimatedWithFFmpeg(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	clipA := filepath.Join(dir, "a.mp4")
	clipB := filepath.Join(dir, "b.mp4")
	green := filepath.Join(dir, "green.mp4")
	runFFmpeg(t, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25:duration=3",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", clipA)
	runFFmpeg(t, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "smptebars=size=320x180:rate=25:duration=3",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", clipB)
	// A green frame with a white box in the middle: keying the green must
	// leave the box and expose the layer beneath
	runFFmpeg(t, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x00ff00:s=320x180:r=25:d=3,drawbox=x=120:y=60:w=80:h=60:color=white:t=fill",
		"-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "1", green)

	p := &Project{Width: 320, Height: 180, FPS: 25, Duration: 4, Format: FormatMP4, Quality: QualityLow}
	bg := videoLayer("bg", clipB, 0, 4)
	bg.Reverse = true
	keyed := videoLayer("key", green, 0, 4)
	keyed.Props.Effects = []Effect{{Type: "chromakey", Color: "#00ff00", Similarity: 25, Soft: 5}, {Type: "sharpen", Amount: 30}}
	keyed.Props.Keyframes = map[string][]Keyframe{
		"scale":    {{T: 0, V: 100}, {T: 4, V: 40, Ease: "ease"}},
		"x":        {{T: 0, V: 0}, {T: 2, V: 60, Ease: "hold"}, {T: 4, V: -60}},
		"y":        {{T: 0, V: 0}, {T: 4, V: 20}},
		"rotation": {{T: 0, V: 0}, {T: 4, V: 45}},
		"opacity":  {{T: 0, V: 100}, {T: 4, V: 30}},
	}
	adj := Layer{ID: "adj", Kind: LayerAdjust, Start: 1, Duration: 2, Props: defaultProps()}
	adj.Props.Saturation = 0
	adj.Props.Opacity = 60
	adj.Props.Effects = []Effect{{Type: "blur", Amount: 1}, {Type: "grain", Amount: 20}}
	p.Layers = []Layer{bg, keyed, adj}
	p.Audio = []AudioClip{{ID: "a", Src: clipA, Start: 0, Duration: 3, Volume: 1, Reverse: true, Pan: 60,
		FadeIn: 0.5, InCurve: "power", FadeOut: 0.5, OutCurve: "power",
		Keyframes: map[string][]Keyframe{"volume": {{T: 0, V: 100}, {T: 3, V: 50}}}}}
	res, err := BuildArgs(p, nil)
	if err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "animated.mp4")
	runFFmpeg(t, append(append([]string{"-y"}, res.Args...), out)...)
	w, h, d := probe(t, out)
	if w != 320 || h != 180 || d < 3.9 || d > 4.2 {
		t.Errorf("animated render = %dx%d %vs", w, h, d)
	}

	for name := range xfadeTransitions {
		t.Run(name, func(t *testing.T) {
			q := &Project{Width: 160, Height: 90, FPS: 10, Duration: 2, Format: FormatMP4, Quality: QualityLow}
			a := videoLayer("a", clipA, 0, 1)
			b := videoLayer("b", clipB, 1, 1)
			b.Transition = &Transition{Type: name, Duration: 0.5}
			b.PrevID = "a"
			q.Layers = []Layer{a, b}
			res, err := BuildArgs(q, nil)
			if err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(dir, "tr_"+name+".mp4")
			runFFmpeg(t, append(append([]string{"-y"}, res.Args...), target)...)
			if _, _, d := probe(t, target); d < 1.8 {
				t.Errorf("%s render too short: %v", name, d)
			}
		})
	}
}
