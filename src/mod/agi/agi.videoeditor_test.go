package agi

import (
	"errors"
	"strings"
	"testing"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	notification "imuslab.com/arozos/mod/notification"
	"imuslab.com/arozos/mod/videoeditor"
)

/*
	Tests for the videoeditor AGI library (agi.videoeditor.go).

	A real job needs a user with mounted file system handlers, which the AGI
	unit tests do not have, so what is checked here is the JS surface and the
	validation that runs before any path is resolved. Rendering itself is
	covered in mod/videoeditor.
*/

func injectVideoEditorForTest(t *testing.T) *otto.Otto {
	t.Helper()
	vm := otto.New()
	minimalGateway().injectVideoEditorFunctions(&static.AgiLibInjectionPayload{
		VM:   vm,
		User: stubUser("test"),
	})
	return vm
}

func evalVideoEditorBool(t *testing.T, vm *otto.Otto, src string) bool {
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

func TestVideoEditorFunctionsExposed(t *testing.T) {
	vm := injectVideoEditorForTest(t)
	for _, name := range []string{"renderTimeline", "makeProxy", "hwEncoder", "isRunning", "cancel"} {
		if !evalVideoEditorBool(t, vm, `typeof videoeditor.`+name+` === "function"`) {
			t.Errorf("videoeditor.%s is not exposed as a function", name)
		}
	}
	if !evalVideoEditorBool(t, vm, `typeof videoeditor.hwEncoder() === "string"`) {
		t.Errorf("videoeditor.hwEncoder() must return a string")
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
		{"missing spec", `videoeditor.renderTimeline(undefined, "user:/out.mp4", "tmp:/p.progress.json")`},
		{"invalid json", `videoeditor.renderTimeline("{nope", "user:/out.mp4", "tmp:/p.progress.json")`},
		{"spec fails validation", `videoeditor.renderTimeline('{"width":0}', "user:/out.mp4", "tmp:/p.progress.json")`},
		{"missing output", `videoeditor.renderTimeline('` + validSpec + `', undefined, "tmp:/p.progress.json")`},
		{"output extension mismatch", `videoeditor.renderTimeline('` + validSpec + `', "user:/out.webm", "tmp:/p.progress.json")`},
		{"missing progress file", `videoeditor.renderTimeline('` + validSpec + `', "user:/out.mp4", "")`},
		{"options that are not JSON", `videoeditor.renderTimeline('` + validSpec + `', "user:/out.mp4", "tmp:/p.progress.json", "{nope")`},
		{"cleanup is a file system root", `videoeditor.renderTimeline('` + validSpec + `', "user:/out.mp4", "tmp:/p.progress.json", {cleanup: "user:/"})`},
		{"cleanup holds the output", `videoeditor.renderTimeline('` + validSpec + `', "user:/scratch/out.mp4", "tmp:/p.progress.json", {cleanup: "user:/scratch"})`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if evalVideoEditorBool(t, injectVideoEditorForTest(t), tt.call) {
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
		{"missing input", `videoeditor.makeProxy(undefined, "user:/p.mp4", "video", 360, "tmp:/p.progress.json")`},
		{"missing output", `videoeditor.makeProxy("user:/a.mkv", "", "video", 360, "tmp:/p.progress.json")`},
		{"unknown kind", `videoeditor.makeProxy("user:/a.mkv", "user:/p.bin", "hologram", 0, "tmp:/p.progress.json")`},
		{"extension does not match kind", `videoeditor.makeProxy("user:/a.mkv", "user:/p.mp4", "audio", 0, "tmp:/p.progress.json")`},
		{"absurd height", `videoeditor.makeProxy("user:/a.mkv", "user:/p.mp4", "video", 100000, "tmp:/p.progress.json")`},
		{"missing progress file", `videoeditor.makeProxy("user:/a.mkv", "user:/p.mp4", "video", 360, undefined)`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if evalVideoEditorBool(t, injectVideoEditorForTest(t), tt.call) {
				t.Errorf("%s: call must return false", tt.call)
			}
		})
	}
}

func TestCheckVideoEditorJob(t *testing.T) {
	tests := []struct {
		name string
		job  *videoEditorJob
		want string
	}{
		{"no user", &videoEditorJob{output: "user:/o.mp4", progressFile: "/tmp/p.json"}, "user scope"},
		{"no progress file", &videoEditorJob{user: stubUser("t"), output: "user:/o.mp4"}, "progress file"},
		{"no output", &videoEditorJob{user: stubUser("t"), progressFile: "/tmp/p.json"}, "output filename"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := checkVideoEditorJob(tt.job)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("error %v should mention %q", err, tt.want)
			}
		})
	}
}

func TestVideoEditorEncoderSoftwareByDefault(t *testing.T) {
	if videoEditorEncoder(false) != nil {
		t.Error("software rendering must not pick a hardware encoder")
	}
}

func TestParseRenderOptions(t *testing.T) {
	vm := otto.New()
	eval := func(src string) otto.Value {
		v, err := vm.Run(src)
		if err != nil {
			t.Fatalf("running %q: %v", src, err)
		}
		return v
	}
	tests := []struct {
		name    string
		js      string
		want    renderOptions
		wantErr bool
	}{
		{name: "undefined", js: `undefined`},
		{name: "null", js: `null`},
		{name: "empty string", js: `"  "`},
		{name: "object", js: `({cleanup: "user:/Cache/job", notify: true})`, want: renderOptions{Cleanup: "user:/Cache/job", Notify: true}},
		{name: "JSON string", js: `'{"notify":true}'`, want: renderOptions{Notify: true}},
		{name: "unknown keys are ignored", js: `({other: 1})`},
		{name: "broken JSON", js: `"{nope"`, wantErr: true},
		{name: "wrong type", js: `({notify: "yes"})`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseRenderOptions(eval(tt.js))
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestCheckScratchDir(t *testing.T) {
	tests := []struct {
		name    string
		dir     string
		output  string
		wantErr bool
	}{
		{name: "folder in the cache", dir: "user:/Cine Studio/Cache/render_1", output: "user:/Cine Studio/Exports/a.mp4"},
		{name: "trailing slash", dir: "user:/Cine Studio/Cache/render_1/", output: "user:/Cine Studio/Exports/a.mp4"},
		{name: "file system root", dir: "user:/", output: "user:/a.mp4", wantErr: true},
		{name: "file system root without slash", dir: "user:", output: "user:/a.mp4", wantErr: true},
		{name: "not a virtual path", dir: "render_1", output: "user:/a.mp4", wantErr: true},
		{name: "output inside the folder", dir: "user:/Cache/job", output: "user:/Cache/job/a.mp4", wantErr: true},
		{name: "output is the folder", dir: "user:/Cache/job", output: "user:/Cache/job", wantErr: true},
		{name: "sibling with the same prefix", dir: "user:/Cache/job", output: "user:/Cache/job2/a.mp4"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := checkScratchDir(tt.dir, tt.output)
			if (err != nil) != tt.wantErr {
				t.Errorf("checkScratchDir(%q, %q) error = %v, wantErr %v", tt.dir, tt.output, err, tt.wantErr)
			}
		})
	}
}

func TestNotifyRenderEnded(t *testing.T) {
	tests := []struct {
		name      string
		jobErr    error
		wantSent  bool
		wantTitle string
		wantMsg   string
	}{
		{name: "finished", wantSent: true, wantTitle: "Export finished: My Cut.mp4", wantMsg: "Saved to user:/Cine Studio/Exports"},
		{name: "failed", jobErr: errors.New("ffmpeg failed: boom"), wantSent: true, wantTitle: "Export failed: My Cut.mp4", wantMsg: "ffmpeg failed: boom"},
		{name: "cancelled by the user stays quiet", jobErr: videoeditor.ErrCancelled},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got *notification.NotificationPayload
			g := newNotificationTestGateway(func(p *notification.NotificationPayload) error { got = p; return nil })
			g.notifyRenderEnded("Cine Studio", "alice", "user:/Cine Studio/Exports/My Cut.mp4", tt.jobErr)

			if (got != nil) != tt.wantSent {
				t.Fatalf("notification sent = %v, want %v", got != nil, tt.wantSent)
			}
			if got == nil {
				return
			}
			if got.Title != tt.wantTitle || got.Message != tt.wantMsg {
				t.Errorf("notification = %q / %q, want %q / %q", got.Title, got.Message, tt.wantTitle, tt.wantMsg)
			}
			if len(got.Receiver) != 1 || got.Receiver[0] != "alice" || got.Sender != "Cine Studio" {
				t.Errorf("wrong addressing: sender %q receivers %v", got.Sender, got.Receiver)
			}
		})
	}

	t.Run("a missing notification system does not panic", func(t *testing.T) {
		newNotificationTestGateway(nil).notifyRenderEnded("Cine Studio", "alice", "user:/a.mp4", nil)
	})
}
