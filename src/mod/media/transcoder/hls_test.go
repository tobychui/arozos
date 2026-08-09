package transcoder

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Source-file fixtures. These are never opened - the functions under test only
// ever treat them as opaque strings - but they are built with filepath.Join so
// no absolute, OS-specific path literal appears in the tree.
var (
	srcA = filepath.Join("movies", "a.avi")
	srcB = filepath.Join("movies", "b.avi")
)

// TestValidHLSSegmentName verifies that only names this package generates are
// accepted, since the name is used to build a path inside the session folder.
func TestValidHLSSegmentName(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"seg00000.ts", true},
		{"seg00123.ts", true},
		{"seg1.ts", true},
		{"", false},
		{"seg.ts", false},
		{"index.m3u8", false},
		{"seg00000.ts.bak", false},
		{"other00000.ts", false},
		{"seg0000a.ts", false},
		{"../seg00000.ts", false},
		{"seg/00000.ts", false},
		{"seg00000.ts/../../passwd", false},
		{"..", false},
		{"../passwd", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validHLSSegmentName(tc.name); got != tc.want {
				t.Errorf("validHLSSegmentName(%q) = %v, want %v", tc.name, got, tc.want)
			}
		})
	}
}

// TestSegmentPathRejectsTraversal confirms a rejected name yields an error
// rather than a path escaping the session directory.
func TestSegmentPathRejectsTraversal(t *testing.T) {
	session := &HLSSession{Dir: t.TempDir()}

	if _, err := session.SegmentPath("../../passwd"); err == nil {
		t.Error("SegmentPath accepted a traversal name, want error")
	}

	got, err := session.SegmentPath("seg00007.ts")
	if err != nil {
		t.Fatalf("SegmentPath(valid) returned error: %v", err)
	}
	if want := filepath.Join(session.Dir, "seg00007.ts"); got != want {
		t.Errorf("SegmentPath = %q, want %q", got, want)
	}
}

// TestHLSSessionKey verifies that only identical transcodes share a key.
func TestHLSSessionKey(t *testing.T) {
	base := hlsSessionKey("alice", srcA, TranscodeResolution_original, 0)

	if again := hlsSessionKey("alice", srcA, TranscodeResolution_original, 0); again != base {
		t.Errorf("same inputs produced different keys: %q vs %q", base, again)
	}

	differing := map[string]string{
		"other user":       hlsSessionKey("bob", srcA, TranscodeResolution_original, 0),
		"other file":       hlsSessionKey("alice", srcB, TranscodeResolution_original, 0),
		"other resolution": hlsSessionKey("alice", srcA, TranscodeResolution_720p, 0),
		"other start":      hlsSessionKey("alice", srcA, TranscodeResolution_original, 90),
	}
	for name, key := range differing {
		t.Run(name, func(t *testing.T) {
			if key == base {
				t.Errorf("%s produced the same session key as the base case", name)
			}
		})
	}
}

// TestResolutionHeight covers the shared mapping used by both the MP4 and the
// HLS path, including the rejection that guards the endpoint.
func TestResolutionHeight(t *testing.T) {
	cases := []struct {
		resolution TranscodeOutputResolution
		want       string
		wantErr    bool
	}{
		{TranscodeResolution_original, "", false},
		{"360p", "360", false},
		{"720p", "720", false},
		{"1080p", "1080", false},
		{"banana", "", true},
		{"480p", "", true},
	}

	for _, tc := range cases {
		t.Run(string(tc.resolution), func(t *testing.T) {
			got, err := resolutionHeight(tc.resolution)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("resolutionHeight(%q) returned no error, want one", tc.resolution)
				}
				return
			}
			if err != nil {
				t.Fatalf("resolutionHeight(%q) returned error: %v", tc.resolution, err)
			}
			if got != tc.want {
				t.Errorf("resolutionHeight(%q) = %q, want %q", tc.resolution, got, tc.want)
			}
		})
	}
}

// TestBuildHLSArgs checks the generated command line for the properties that
// make the output playable: correct muxer settings, the whole playlist kept,
// the segment URL prefix, and the encoder chosen the same way the MP4 path
// chooses it.
func TestBuildHLSArgs(t *testing.T) {
	dir := t.TempDir()
	const baseURL = "/media/hls/segment?sid=abc&name="

	t.Run("software encoder", func(t *testing.T) {
		args, err := buildHLSArgs(srcA, dir, TranscodeResolution_360p, 0, baseURL, nil)
		if err != nil {
			t.Fatalf("buildHLSArgs returned error: %v", err)
		}
		joined := strings.Join(args, " ")

		for _, want := range []string{
			"-f hls",
			"-hls_list_size 0",
			"-hls_playlist_type event",
			"-hls_base_url " + baseURL,
			"-vcodec libx264",
			"-vf scale=-1:360",
			"-c:a aac",
			"-map 0:v:0",
		} {
			if !strings.Contains(joined, want) {
				t.Errorf("args missing %q\ngot: %v", want, args)
			}
		}
		if strings.Contains(joined, "-ss ") {
			t.Errorf("start time 0 should not add -ss\ngot: %v", args)
		}
		if last := args[len(args)-1]; last != filepath.Join(dir, hlsPlaylistName) {
			t.Errorf("playlist path = %q, want it last and inside the session dir", last)
		}
	})

	t.Run("hardware encoder", func(t *testing.T) {
		hw := &hwEncoderProfile{
			Name:        "test",
			Codec:       "h264_videotoolbox",
			ScaleFilter: nv12ScaleFilter,
			EncodeArgs:  []string{"-realtime", "1"},
		}
		args, err := buildHLSArgs(srcA, dir, TranscodeResolution_original, 0, baseURL, hw)
		if err != nil {
			t.Fatalf("buildHLSArgs returned error: %v", err)
		}
		joined := strings.Join(args, " ")
		if !strings.Contains(joined, "-vcodec h264_videotoolbox -realtime 1") {
			t.Errorf("hardware encoder args not applied\ngot: %v", args)
		}
		if strings.Contains(joined, "libx264") {
			t.Errorf("hardware path should not fall back to libx264\ngot: %v", args)
		}
	})

	t.Run("pre-input args precede the input", func(t *testing.T) {
		hw := &hwEncoderProfile{
			Name:        "vaapi-like",
			Codec:       "h264_vaapi",
			PreInput:    []string{"-vaapi_device", "renderD128"},
			ScaleFilter: func(string) string { return "format=nv12,hwupload" },
		}
		args, err := buildHLSArgs(srcA, dir, TranscodeResolution_original, 30, baseURL, hw)
		if err != nil {
			t.Fatalf("buildHLSArgs returned error: %v", err)
		}
		device := indexOf(args, "-vaapi_device")
		seek := indexOf(args, "-ss")
		input := indexOf(args, "-i")
		if device == -1 || seek == -1 || input == -1 {
			t.Fatalf("expected -vaapi_device, -ss and -i in args: %v", args)
		}
		if !(device < seek && seek < input) {
			t.Errorf("expected -vaapi_device before -ss before -i, got positions %d, %d, %d\nargs: %v",
				device, seek, input, args)
		}
	})

	t.Run("invalid resolution", func(t *testing.T) {
		if _, err := buildHLSArgs(srcA, dir, "banana", 0, baseURL, nil); err == nil {
			t.Error("buildHLSArgs accepted an invalid resolution, want error")
		}
	})
}

func indexOf(list []string, want string) int {
	for i, v := range list {
		if v == want {
			return i
		}
	}
	return -1
}

// TestPlaylistHasSegment verifies the readiness check distinguishes a header
// only playlist from one that actually lists a segment.
func TestPlaylistHasSegment(t *testing.T) {
	dir := t.TempDir()

	missing := filepath.Join(dir, "missing.m3u8")
	if playlistHasSegment(missing) {
		t.Error("playlistHasSegment reported true for a missing file")
	}

	headerOnly := filepath.Join(dir, "header.m3u8")
	if err := os.WriteFile(headerOnly, []byte("#EXTM3U\n#EXT-X-VERSION:3\n"), 0644); err != nil {
		t.Fatalf("writing header playlist: %v", err)
	}
	if playlistHasSegment(headerOnly) {
		t.Error("playlistHasSegment reported true for a playlist with no segments")
	}

	withSegment := filepath.Join(dir, "ready.m3u8")
	body := "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4.000,\n/media/hls/segment?sid=x&name=seg00000.ts\n"
	if err := os.WriteFile(withSegment, []byte(body), 0644); err != nil {
		t.Fatalf("writing ready playlist: %v", err)
	}
	if !playlistHasSegment(withSegment) {
		t.Error("playlistHasSegment reported false for a playlist listing a segment")
	}
}

// TestHLSManagerLifecycle verifies the working directory is created up front
// and removed on Close, and that unknown session IDs are not resolvable.
func TestHLSManagerLifecycle(t *testing.T) {
	tmp := t.TempDir()
	m, err := NewHLSManager(tmp, "/media/hls/segment")
	if err != nil {
		t.Fatalf("NewHLSManager returned error: %v", err)
	}

	root := filepath.Join(tmp, hlsWorkingDirName)
	if _, err := os.Stat(root); err != nil {
		t.Errorf("working directory was not created: %v", err)
	}
	if got := m.Session("does-not-exist"); got != nil {
		t.Errorf("Session(unknown) = %v, want nil", got)
	}

	m.Close()
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Errorf("working directory still present after Close (err=%v)", err)
	}
	m.Close() // must be safe to call twice
}

// TestHLSManagerDiscardsStaleSessions verifies that session directories left
// behind by a previous run are removed at startup. The ffmpeg processes that
// were filling them died with that run, so the segments can never be completed
// and the directories would otherwise accumulate after every crash.
func TestHLSManagerDiscardsStaleSessions(t *testing.T) {
	tmp := t.TempDir()
	stale := filepath.Join(tmp, hlsWorkingDirName, "stale-session")
	if err := os.MkdirAll(stale, 0755); err != nil {
		t.Fatalf("seeding a stale session directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(stale, "seg00000.ts"), []byte("x"), 0644); err != nil {
		t.Fatalf("seeding a stale segment: %v", err)
	}

	m, err := NewHLSManager(tmp, "/media/hls/segment")
	if err != nil {
		t.Fatalf("NewHLSManager returned error: %v", err)
	}
	defer m.Close()

	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Errorf("stale session directory survived startup (err=%v)", err)
	}
	if _, err := os.Stat(filepath.Join(tmp, hlsWorkingDirName)); err != nil {
		t.Errorf("working directory should have been recreated: %v", err)
	}
}

// TestSegmentBaseURL verifies the prefix ffmpeg writes in front of every
// playlist entry addresses the serving endpoint for this session.
func TestSegmentBaseURL(t *testing.T) {
	m := &HLSManager{segmentEndpoint: "/media/hls/segment"}
	got := m.segmentBaseURL("deadbeef")
	want := "/media/hls/segment?sid=deadbeef&name="
	if got != want {
		t.Errorf("segmentBaseURL = %q, want %q", got, want)
	}
}
