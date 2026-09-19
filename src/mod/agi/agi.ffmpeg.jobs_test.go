package agi

import (
	"errors"
	"strings"
	"testing"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/media/render"
)

/*
	Tests for the asynchronous ffmpeg job functions (agi.ffmpeg.jobs.go).

	A real job needs a user with mounted file system handlers, which the
	AGI unit tests do not have (the stub user of agi_scheduler_test.go has
	none, so anything that resolves a virtual path is out of reach here);
	the graph and proxy builders are exercised end to end in
	mod/media/render. What is checked here is the JS surface and the input
	validation that runs before any path is resolved, all of which must
	refuse bad input without touching the disk.
*/

func injectFFmpegForTest(t *testing.T) *otto.Otto {
	t.Helper()
	g := minimalGateway()
	vm := otto.New()
	g.injectFFmpegFunctions(&static.AgiLibInjectionPayload{
		VM:   vm,
		User: stubUser("test"),
	})
	return vm
}

func evalBool(t *testing.T, vm *otto.Otto, src string) bool {
	t.Helper()
	val, err := vm.Run(src)
	if err != nil {
		t.Fatalf("running %q: %v", src, err)
	}
	b, err := val.ToBoolean()
	if err != nil {
		t.Fatalf("%q did not return a boolean: %v", src, err)
	}
	return b
}

func TestFFmpegJobFunctionsExposed(t *testing.T) {
	vm := injectFFmpegForTest(t)
	for _, name := range []string{"renderTimeline", "makeProxy", "hwEncoder", "cancel", "videoConvert"} {
		if !evalBool(t, vm, `typeof ffmpeg.`+name+` === "function"`) {
			t.Errorf("ffmpeg.%s is not exposed as a function", name)
		}
	}
	if !evalBool(t, vm, `typeof ffmpeg.hwEncoder() === "string"`) {
		t.Errorf("ffmpeg.hwEncoder() must return a string")
	}
}

func TestRenderTimelineRejectsBadInput(t *testing.T) {
	validSpec := `{"width":320,"height":180,"fps":25,"duration":2,"format":"mp4",` +
		`"layers":[{"id":"a","kind":"video","src":"user:/a.mp4","start":0,"duration":2,"speed":1,` +
		`"props":{"scale":100,"opacity":100,"crop":"fit","saturation":1}}]}`
	tests := []struct {
		name string
		call string
	}{
		{"missing spec", `ffmpeg.renderTimeline(undefined, "user:/out.mp4", "tmp:/p.progress.json")`},
		{"invalid json", `ffmpeg.renderTimeline("{nope", "user:/out.mp4", "tmp:/p.progress.json")`},
		{"spec fails validation", `ffmpeg.renderTimeline('{"width":0}', "user:/out.mp4", "tmp:/p.progress.json")`},
		{"missing output", `ffmpeg.renderTimeline('` + validSpec + `', undefined, "tmp:/p.progress.json")`},
		{"output extension mismatch", `ffmpeg.renderTimeline('` + validSpec + `', "user:/out.webm", "tmp:/p.progress.json")`},
		{"missing progress file", `ffmpeg.renderTimeline('` + validSpec + `', "user:/out.mp4", "")`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vm := injectFFmpegForTest(t)
			if evalBool(t, vm, tt.call) {
				t.Errorf("%s: call must return false", tt.call)
			}
		})
	}
}

func TestMakeProxyRejectsBadInput(t *testing.T) {
	tests := []struct {
		name string
		call string
	}{
		{"missing input", `ffmpeg.makeProxy(undefined, "user:/p.mp4", "video", 360, "tmp:/p.progress.json")`},
		{"missing output", `ffmpeg.makeProxy("user:/a.mkv", "", "video", 360, "tmp:/p.progress.json")`},
		{"unknown kind", `ffmpeg.makeProxy("user:/a.mkv", "user:/p.bin", "hologram", 0, "tmp:/p.progress.json")`},
		{"extension does not match kind", `ffmpeg.makeProxy("user:/a.mkv", "user:/p.mp4", "audio", 0, "tmp:/p.progress.json")`},
		{"absurd height", `ffmpeg.makeProxy("user:/a.mkv", "user:/p.mp4", "video", 100000, "tmp:/p.progress.json")`},
		{"missing progress file", `ffmpeg.makeProxy("user:/a.mkv", "user:/p.mp4", "video", 360, undefined)`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vm := injectFFmpegForTest(t)
			if evalBool(t, vm, tt.call) {
				t.Errorf("%s: call must return false", tt.call)
			}
		})
	}
}

func TestStartFFmpegJobValidation(t *testing.T) {
	build := func([]string) ([]string, int64, error) { return nil, 0, nil }
	tests := []struct {
		name string
		job  *ffmpegJob
		want string
	}{
		{"no user", &ffmpegJob{output: "user:/o.mp4", progressFile: "/tmp/p.json", build: build}, "user scope"},
		{"no progress file", &ffmpegJob{user: stubUser("t"), output: "user:/o.mp4", build: build}, "progress file"},
		{"no output", &ffmpegJob{user: stubUser("t"), progressFile: "/tmp/p.json", build: build}, "output filename"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := startFFmpegJob(tt.job)
			if err == nil {
				t.Fatalf("job must be rejected")
			}
			if tt.want != "" && !strings.Contains(err.Error(), tt.want) {
				t.Errorf("error %q should mention %q", err.Error(), tt.want)
			}
		})
	}
}

func TestRenderEncoderSoftwareByDefault(t *testing.T) {
	if renderEncoder(false) != nil {
		t.Error("software rendering must not pick a hardware encoder")
	}
}

func TestDropSilentAudio(t *testing.T) {
	clips := []render.AudioClip{
		{ID: "a", Src: "/m/with.mp4"},
		{ID: "b", Src: "/m/silent.mkv"},
		{ID: "c", Src: "/m/with.mp4"},
		{ID: "d", Src: "/m/unknown.mov"},
		{ID: "e", Src: "/m/silent.mkv"},
	}
	calls := map[string]int{}
	hasAudio := func(src string) (bool, error) {
		calls[src]++
		switch src {
		case "/m/silent.mkv":
			return false, nil
		case "/m/unknown.mov":
			return true, errors.New("ffprobe unavailable")
		}
		return true, nil
	}

	got := dropSilentAudio(clips, hasAudio)

	ids := ""
	for _, c := range got {
		ids += c.ID
	}
	if ids != "acd" {
		t.Errorf("kept clips %q, want %q (silent files dropped, unjudgeable file kept, order preserved)", ids, "acd")
	}
	for src, n := range calls {
		if n != 1 {
			t.Errorf("%s probed %d times, want once per file", src, n)
		}
	}
	if len(clips) != 5 {
		t.Errorf("input slice was modified: %d entries", len(clips))
	}
	if out := dropSilentAudio(nil, hasAudio); len(out) != 0 {
		t.Errorf("no clips in, got %d out", len(out))
	}
}
