package transcoder

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
		{"seg00000.m4s", true},
		{"seg00123.m4s", true},
		{"seg1.m4s", true},
		{"init.mp4", true}, // the fMP4 init segment goes through the same endpoint
		{"", false},
		{"seg.m4s", false},
		{"index.m3u8", false},
		{"seg00000.ts", false}, // the old MPEG-TS naming is no longer generated
		{"seg00000.m4s.bak", false},
		{"other00000.m4s", false},
		{"seg0000a.m4s", false},
		{"init.mp4.bak", false},
		{"../init.mp4", false},
		{"../seg00000.m4s", false},
		{"seg/00000.m4s", false},
		{"seg00000.m4s/../../passwd", false},
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

	got, err := session.SegmentPath("seg00007.m4s")
	if err != nil {
		t.Fatalf("SegmentPath(valid) returned error: %v", err)
	}
	if want := filepath.Join(session.Dir, "seg00007.m4s"); got != want {
		t.Errorf("SegmentPath = %q, want %q", got, want)
	}

	// The init segment must resolve inside the session directory too
	got, err = session.SegmentPath(HLSInitSegmentName)
	if err != nil {
		t.Fatalf("SegmentPath(init) returned error: %v", err)
	}
	if want := filepath.Join(session.Dir, HLSInitSegmentName); got != want {
		t.Errorf("SegmentPath(init) = %q, want %q", got, want)
	}
}

// TestRewritePlaylistInitURI verifies the #EXT-X-MAP URI is redirected onto the
// segment endpoint. ffmpeg writes it as a bare filename, which would otherwise
// resolve against the playlist URL and 404.
func TestRewritePlaylistInitURI(t *testing.T) {
	const initURL = "/media/hls/segment?sid=abc&name=init.mp4"

	playlist := "#EXTM3U\n" +
		"#EXT-X-VERSION:7\n" +
		"#EXT-X-MAP:URI=\"init.mp4\"\n" +
		"#EXTINF:4.000000,\n" +
		"/media/hls/segment?sid=abc&name=seg00000.m4s\n"

	got := string(rewritePlaylistInitURI([]byte(playlist), initURL))

	if !strings.Contains(got, "#EXT-X-MAP:URI=\""+initURL+"\"") {
		t.Errorf("init URI was not rewritten, got:\n%s", got)
	}
	if strings.Contains(got, "URI=\"init.mp4\"") {
		t.Error("the bare init filename survived the rewrite")
	}
	// Media segment lines must be left exactly as ffmpeg wrote them
	if !strings.Contains(got, "/media/hls/segment?sid=abc&name=seg00000.m4s") {
		t.Error("a media segment URI was altered by the rewrite")
	}
}

// TestRewritePlaylistInitURI_NoMapTag verifies a playlist without an init tag
// (an MPEG-TS playlist, or a header written before the first segment) passes
// through untouched.
func TestRewritePlaylistInitURI_NoMapTag(t *testing.T) {
	playlist := "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4\n"
	if got := string(rewritePlaylistInitURI([]byte(playlist), "/x")); got != playlist {
		t.Errorf("playlist without EXT-X-MAP was modified:\n%s", got)
	}
}

// TestRewritePlaylistInitURI_Malformed verifies a truncated tag cannot panic or
// corrupt the playlist.
func TestRewritePlaylistInitURI_Malformed(t *testing.T) {
	cases := []string{
		"#EXT-X-MAP:\n",
		"#EXT-X-MAP:URI=\n",
		"#EXT-X-MAP:URI=\"unterminated\n",
		"#EXT-X-MAP:URI=''\n",
	}
	for _, tc := range cases {
		out := string(rewritePlaylistInitURI([]byte(tc), "/x"))
		if out == "" {
			t.Errorf("rewrite emptied the playlist for %q", tc)
		}
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
	body := "#EXTM3U\n#EXT-X-VERSION:7\n#EXTINF:4.000,\n/media/hls/segment?sid=x&name=seg00000.m4s\n"
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
	if err := os.WriteFile(filepath.Join(stale, "seg00000.m4s"), []byte("x"), 0644); err != nil {
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

// TestTailBufferKeepsTail verifies the stderr capture keeps the end of the
// stream and stays bounded, since ffmpeg's final message is the only
// explanation available when a transcode produces nothing.
func TestTailBufferKeepsTail(t *testing.T) {
	tests := []struct {
		name   string
		writes []string
		want   string
	}{
		{name: "empty", writes: nil, want: ""},
		{name: "single write", writes: []string{"boom"}, want: "boom"},
		{name: "appends in order", writes: []string{"a", "b", "c"}, want: "abc"},
		{
			name:   "keeps only the tail",
			writes: []string{strings.Repeat("x", hlsStderrTailBytes), "tail"},
			want:   strings.Repeat("x", hlsStderrTailBytes-4) + "tail",
		},
		{
			name:   "single oversized write is trimmed",
			writes: []string{strings.Repeat("y", hlsStderrTailBytes+10)},
			want:   strings.Repeat("y", hlsStderrTailBytes),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buf := &tailBuffer{}
			for _, chunk := range tt.writes {
				n, err := buf.Write([]byte(chunk))
				if err != nil {
					t.Fatalf("Write returned error: %v", err)
				}
				if n != len(chunk) {
					t.Errorf("Write returned n = %d, want %d", n, len(chunk))
				}
			}
			if got := buf.String(); got != tt.want {
				t.Errorf("String() length %d, want %d (content mismatch)", len(got), len(tt.want))
			}
		})
	}
}

// TestStderrTailWithoutBuffer verifies a session carrying no capture buffer
// reports no diagnostics rather than panicking.
func TestStderrTailWithoutBuffer(t *testing.T) {
	session := &HLSSession{}
	if got := session.StderrTail(); got != "" {
		t.Errorf("StderrTail() = %q, want empty", got)
	}

	session.stderr = &tailBuffer{}
	session.stderr.Write([]byte("  ffmpeg said this  \n"))
	if got := session.StderrTail(); got != "ffmpeg said this" {
		t.Errorf("StderrTail() = %q, want trimmed message", got)
	}
}

// TestCollectSuperseded verifies which running transcodes a newly created
// session retires. A seek arrives as a request for the same file at another
// offset, and without this the transcode it replaces would keep running.
func TestCollectSuperseded(t *testing.T) {
	newSession := func(id, owner, client, source string) *HLSSession {
		return &HLSSession{ID: id, Owner: owner, Client: client, Source: source}
	}

	tests := []struct {
		name     string
		existing map[string]*HLSSession
		created  *HLSSession
		want     []string
	}{
		{
			name:     "same player seeking retires its earlier offset",
			existing: map[string]*HLSSession{"old": newSession("old", "alice", "tab1", srcA)},
			created:  newSession("new", "alice", "tab1", srcA),
			want:     []string{"old"},
		},
		{
			name:     "same player switching file retires the previous one",
			existing: map[string]*HLSSession{"old": newSession("old", "alice", "tab1", srcA)},
			created:  newSession("new", "alice", "tab1", srcB),
			want:     []string{"old"},
		},
		{
			name:     "another tab of the same user is left alone",
			existing: map[string]*HLSSession{"old": newSession("old", "alice", "tab2", srcA)},
			created:  newSession("new", "alice", "tab1", srcA),
			want:     nil,
		},
		{
			name:     "another user is left alone",
			existing: map[string]*HLSSession{"old": newSession("old", "bob", "tab1", srcA)},
			created:  newSession("new", "alice", "tab1", srcA),
			want:     nil,
		},
		{
			name:     "unidentified player retires its own file only",
			existing: map[string]*HLSSession{"old": newSession("old", "alice", "", srcA)},
			created:  newSession("new", "alice", "", srcA),
			want:     []string{"old"},
		},
		{
			name:     "unidentified player leaves another file alone",
			existing: map[string]*HLSSession{"old": newSession("old", "alice", "", srcB)},
			created:  newSession("new", "alice", "", srcA),
			want:     nil,
		},
		{
			name:     "unidentified player never retires an identified one",
			existing: map[string]*HLSSession{"old": newSession("old", "alice", "tab1", srcA)},
			created:  newSession("new", "alice", "", srcA),
			want:     nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := &HLSManager{sessions: map[string]*HLSSession{}}
			for key, session := range tt.existing {
				m.sessions[key] = session
			}
			m.sessions["new"] = tt.created

			got := m.collectSuperseded("new", tt.created)
			var gotIDs []string
			for _, session := range got {
				gotIDs = append(gotIDs, session.ID)
			}
			if strings.Join(gotIDs, ",") != strings.Join(tt.want, ",") {
				t.Errorf("collectSuperseded returned %v, want %v", gotIDs, tt.want)
			}
			if _, stillThere := m.sessions["new"]; !stillThere {
				t.Error("collectSuperseded removed the session that was just created")
			}
			for _, id := range gotIDs {
				if _, stillThere := m.sessions[id]; stillThere {
					t.Errorf("superseded session %q was returned but not removed from the map", id)
				}
			}
			if len(m.sessions) != len(tt.existing)+1-len(tt.want) {
				t.Errorf("session map holds %d entries after superseding, want %d",
					len(m.sessions), len(tt.existing)+1-len(tt.want))
			}
		})
	}
}

// TestGetOrCreateSupersedesOnSeek runs the real thing: a session is started,
// then the same player asks for a later offset the way a seek does. The first
// transcode must be gone by the time the second playlist is ready, since two
// ffmpeg processes racing through the same film is what starves the host and
// leaves the player waiting on a segment that never arrives.
//
// Skipped where ffmpeg is not installed, which is also where the HLS endpoints
// are not registered at all.
func TestGetOrCreateSupersedesOnSeek(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed on this host")
	}

	tmp := t.TempDir()
	source := filepath.Join(tmp, "source.mp4")
	generateTestVideo(t, source)

	m, err := NewHLSManager(tmp, "/media/hls/segment")
	if err != nil {
		t.Fatalf("NewHLSManager returned error: %v", err)
	}
	defer m.Close()

	first, err := m.GetOrCreate("alice", "tab1", source, TranscodeResolution_original, 0)
	if err != nil {
		t.Fatalf("starting the first session: %v", err)
	}
	if err := first.WaitForPlaylist(HLSPlaylistWaitTimeout); err != nil {
		t.Fatalf("first session produced no segment: %v (ffmpeg: %s)", err, first.StderrTail())
	}

	//The seek: same player, same file, later offset
	second, err := m.GetOrCreate("alice", "tab1", source, TranscodeResolution_original, 6)
	if err != nil {
		t.Fatalf("starting the session for the seek: %v", err)
	}
	if second.ID == first.ID {
		t.Fatal("a seek to another offset reused the session it should have replaced")
	}
	if err := second.WaitForPlaylist(HLSPlaylistWaitTimeout); err != nil {
		t.Fatalf("seek session produced no segment: %v (ffmpeg: %s)", err, second.StderrTail())
	}

	if got := m.Session(first.ID); got != nil {
		t.Error("the superseded session is still being served")
	}
	select {
	case <-first.exited:
	case <-time.After(10 * time.Second):
		t.Error("the superseded transcode is still running")
	}
	if _, err := os.Stat(first.Dir); !os.IsNotExist(err) {
		t.Errorf("the superseded session's directory survived (err=%v)", err)
	}

	//The replacement has to be intact and still serving
	if m.Session(second.ID) == nil {
		t.Fatal("the session started by the seek is not being served")
	}
	playlist, err := m.ReadPlaylist(second)
	if err != nil {
		t.Fatalf("reading the playlist of the seek session: %v", err)
	}
	if !strings.Contains(string(playlist), m.segmentBaseURL(second.ID)+HLSInitSegmentName) {
		t.Error("the playlist does not point its init segment at the segment endpoint")
	}
	if !strings.Contains(string(playlist), hlsSegmentSuffix) {
		t.Error("the playlist lists no media segment")
	}
}

// generateTestVideo writes a short, deterministic clip with ffmpeg for the
// tests that need a real file to transcode.
func generateTestVideo(t *testing.T, path string) {
	t.Helper()
	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc=size=192x108:rate=15:duration=12",
		"-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
		"-an", path)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not generate a test clip with ffmpeg: %v (%s)", err, string(output))
	}
}
