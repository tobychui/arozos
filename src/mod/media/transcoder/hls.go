package transcoder

/*
	hls.go

	HTTP Live Streaming output for the transcoder.

	TranscodeAndStream pipes a single fragmented MP4 down one long-lived HTTP
	response, which cannot answer byte-range requests and therefore cannot be
	played by WebKit clients (Safari, and every browser on iOS). HLS solves that
	by cutting the transcode into short segments listed in a playlist: each
	segment is an ordinary, finite, seekable file.

	A session owns one ffmpeg process writing segments into its own temp
	directory. Sessions are keyed by owner + source file + resolution + start
	offset so that a reload, or a second player on the same file, reuses the
	transcode already running instead of starting another. Idle sessions are
	reaped by a background janitor, which kills ffmpeg and removes the directory.

	The playlist is written with -hls_playlist_type event, so it grows as the
	transcode proceeds and the player can seek freely within whatever has been
	produced so far. Seeking past that point is done the same way the MP4 path
	does it: by starting a new session at a later -ss offset.

	That last part is why a session carries the id of the player that asked for
	it. The MP4 path kills its ffmpeg as soon as the client drops the response,
	so a seek never leaves a transcode behind; an HLS session has no such
	signal, and without one every seek would add another ffmpeg racing through
	the rest of the film. A new session therefore supersedes the ones the same
	player left behind (see GetOrCreate).
*/

import (
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

const (
	// hlsSegmentSeconds is the target length of each segment. Four seconds is
	// the usual HLS compromise: short enough that playback starts quickly and
	// seeking lands close to the requested time, long enough that the segment
	// count (and request rate) stays sane on a feature-length file.
	hlsSegmentSeconds = 4

	hlsPlaylistName   = "index.m3u8"
	hlsSegmentPattern = "seg%05d.m4s"
	hlsSegmentPrefix  = "seg"
	hlsSegmentSuffix  = ".m4s"

	// HLSInitSegmentName is the fragmented-MP4 initialisation segment every
	// fMP4 playlist points at with #EXT-X-MAP. Exported because the handler
	// serving playlists has to rewrite that URI onto the segment endpoint.
	HLSInitSegmentName = "init.mp4"

	hlsWorkingDirName = "hls"
	// hlsIdleTimeout has to outlast a pause: a paused player stops fetching
	// segments entirely, and reaping its session under it means the next
	// segment request 404s and playback dies with an unexplained decode error.
	hlsIdleTimeout     = 15 * time.Minute
	hlsMaxSessions     = 8
	hlsJanitorInterval = 30 * time.Second

	// HLSPlaylistWaitTimeout bounds how long a playlist request should wait for
	// ffmpeg to produce the first segment before giving up. Exported so the
	// handler serving playlists uses the same budget the transcode was sized for.
	HLSPlaylistWaitTimeout = 45 * time.Second
)

// HLSSession is one running transcode writing HLS segments to disk.
type HLSSession struct {
	ID        string  // opaque identifier, also the temp directory name
	Owner     string  // username allowed to fetch this session's segments
	Client    string  // opaque id of the player that asked for this transcode
	Source    string  // source file being transcoded
	Dir       string  // directory holding the playlist and its segments
	StartTime float64 // -ss offset this session was started at, in seconds

	cmd    *exec.Cmd
	stderr *tailBuffer   // last few KB of ffmpeg's diagnostics
	exited chan struct{} // closed once the transcode process has been reaped

	mu         sync.Mutex
	lastAccess time.Time
	stopped    bool
}

// tailBuffer keeps the last hlsStderrTailBytes written to it. ffmpeg reports
// why a transcode produced nothing on stderr, and that is the only explanation
// available when a session fails; the whole stream is not worth keeping, but
// the end of it names the reason.
type tailBuffer struct {
	mu   sync.Mutex
	data []byte
}

// hlsStderrTailBytes bounds how much of ffmpeg's stderr is retained per
// session. Enough for the final error plus the surrounding context, small
// enough that eight idle sessions cost nothing worth measuring.
const hlsStderrTailBytes = 4096

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.data = append(t.data, p...)
	if len(t.data) > hlsStderrTailBytes {
		t.data = t.data[len(t.data)-hlsStderrTailBytes:]
	}
	return len(p), nil
}

func (t *tailBuffer) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.data)
}

// StderrTail returns the end of the transcode's diagnostic output, for logging
// when the session fails to produce anything playable.
func (s *HLSSession) StderrTail() string {
	if s.stderr == nil {
		return ""
	}
	return strings.TrimSpace(s.stderr.String())
}

// touch records activity so the janitor does not reap a session that is still
// being played.
func (s *HLSSession) touch() {
	s.mu.Lock()
	s.lastAccess = time.Now()
	s.mu.Unlock()
}

func (s *HLSSession) idleFor() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return time.Since(s.lastAccess)
}

// PlaylistPath returns the on-disk location of this session's playlist.
func (s *HLSSession) PlaylistPath() string {
	return filepath.Join(s.Dir, hlsPlaylistName)
}

// SegmentPath resolves a segment name from a playlist entry to a path inside
// this session's directory. The name is validated rather than merely cleaned:
// it must look exactly like a name this session generated, so a request can
// never address a file outside the session directory.
func (s *HLSSession) SegmentPath(name string) (string, error) {
	if !validHLSSegmentName(name) {
		return "", errors.New("invalid segment name")
	}
	return filepath.Join(s.Dir, name), nil
}

// stop kills the transcode and removes the session's directory. Safe to call
// more than once.
//
// Only the goroutine started in GetOrCreate ever calls cmd.Wait; this waits on
// the channel that goroutine closes instead, since calling Wait twice on the
// same command is an error.
func (s *HLSSession) stop() {
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return
	}
	s.stopped = true
	cmd := s.cmd
	exited := s.exited
	dir := s.Dir
	s.mu.Unlock()

	if cmd != nil && cmd.Process != nil {
		cmd.Process.Kill()
		if exited != nil {
			<-exited
		}
	}
	if dir != "" {
		os.RemoveAll(dir)
	}
}

// validHLSSegmentName reports whether name matches the segment naming this
// package generates ("seg00000.ts"), rejecting anything containing a path
// separator, "..", or unexpected characters.
func validHLSSegmentName(name string) bool {
	// The fMP4 initialisation segment is fetched through the same endpoint as
	// the media segments, so it has to be accepted here too. Matching the exact
	// constant keeps the guarantee that only generated names resolve.
	if name == HLSInitSegmentName {
		return true
	}
	if !strings.HasPrefix(name, hlsSegmentPrefix) || !strings.HasSuffix(name, hlsSegmentSuffix) {
		return false
	}
	digits := strings.TrimSuffix(strings.TrimPrefix(name, hlsSegmentPrefix), hlsSegmentSuffix)
	if digits == "" {
		return false
	}
	for _, c := range digits {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// hlsSessionKey identifies a reusable transcode. Two requests that would
// produce byte-identical output share a session.
func hlsSessionKey(owner string, inputFile string, resolution TranscodeOutputResolution, startTime float64) string {
	raw := strings.Join([]string{
		owner,
		inputFile,
		string(resolution),
		strconv.FormatFloat(startTime, 'f', 3, 64),
	}, "\x00")
	sum := md5.Sum([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// buildHLSArgs assembles the ffmpeg command line for an HLS session. It mirrors
// the encoder selection in TranscodeAndStream - the same hardware profile when
// one is available, libx264 otherwise - and differs only in the muxer.
//
// segmentBaseURL is prepended to every segment name in the playlist, letting the
// segments be fetched from an HTTP endpoint rather than sitting next to the
// playlist on disk.
func buildHLSArgs(inputFile string, dir string, resolution TranscodeOutputResolution, startTime float64, segmentBaseURL string, hw *hwEncoderProfile) ([]string, error) {
	height, err := resolutionHeight(resolution)
	if err != nil {
		return nil, err
	}

	var args []string
	var vf string
	var videoCodecArgs []string
	if hw != nil {
		args = append(args, hw.PreInput...)
		vf = hw.ScaleFilter(height)
		videoCodecArgs = append([]string{"-vcodec", hw.Codec}, hw.EncodeArgs...)
	} else {
		if height != "" {
			vf = "scale=-1:" + height
		}
		// See TranscodeAndStream: without this a 10-bit source yields a High 10
		// stream that most browsers cannot decode.
		videoCodecArgs = []string{"-vcodec", "libx264", "-preset", "superfast", "-pix_fmt", "yuv420p"}
	}

	if startTime > 0.001 {
		// Seeking before -i is the fast path: output timestamps then start at
		// zero, which is what the growing playlist expects.
		args = append(args, "-ss", fmt.Sprintf("%.3f", startTime))
	}
	args = append(args, "-i", inputFile)

	// Take the first video and, if present, the first audio track. Without this
	// a file carrying extra streams (subtitles, attachments, second audio) can
	// fail to mux into MPEG-TS.
	args = append(args, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn")

	if vf != "" {
		args = append(args, "-vf", vf)
	}
	args = append(args, videoCodecArgs...)

	// Segments can only be cut on a keyframe, so force one exactly on every
	// segment boundary; otherwise ffmpeg overshoots and segment lengths drift
	// away from hlsSegmentSeconds.
	args = append(args,
		"-force_key_frames", fmt.Sprintf("expr:gte(t,n_forced*%d)", hlsSegmentSeconds),
		"-c:a", "aac", "-b:a", "128k", "-ac", "2",
	)

	args = append(args,
		"-f", "hls",
		"-hls_time", strconv.Itoa(hlsSegmentSeconds),
		"-hls_list_size", "0", // keep every segment in the playlist so seeking back works
		"-hls_playlist_type", "event",
		"-hls_flags", "independent_segments",
		// Fragmented MP4 rather than MPEG-TS. Safari plays either, but fMP4
		// segments can be appended straight into a MediaSource buffer, which is
		// what lets Firefox and Chrome play this stream without a third-party
		// library to demux transport-stream packets first.
		"-hls_segment_type", "fmp4",
		"-hls_fmp4_init_filename", HLSInitSegmentName,
		"-hls_base_url", segmentBaseURL,
		"-hls_segment_filename", filepath.Join(dir, hlsSegmentPattern),
		filepath.Join(dir, hlsPlaylistName),
	)
	return args, nil
}

// resolutionHeight maps a requested output resolution to an ffmpeg scale
// height, returning an error for anything unrecognised.
func resolutionHeight(resolution TranscodeOutputResolution) (string, error) {
	switch resolution {
	case "360p":
		return "360", nil
	case "720p":
		return "720", nil
	case "1080p":
		return "1080", nil
	case "":
		return "", nil
	}
	return "", errors.New("invalid resolution parameter")
}

// HLSManager owns every live HLS session and the temp directory they live in.
type HLSManager struct {
	root            string // parent directory for all session directories
	segmentEndpoint string // URL path that serves segments back to the player

	mu       sync.Mutex
	sessions map[string]*HLSSession
	closed   bool
	stopChan chan struct{}
}

// NewHLSManager prepares the working directory and starts the reaper. Any
// directory left behind by a previous run is discarded, since the ffmpeg
// processes that were filling those directories died with that run.
func NewHLSManager(tmpDirectory string, segmentEndpoint string) (*HLSManager, error) {
	root := filepath.Join(tmpDirectory, hlsWorkingDirName)
	os.RemoveAll(root)
	if err := os.MkdirAll(root, 0755); err != nil {
		return nil, err
	}
	m := &HLSManager{
		root:            root,
		segmentEndpoint: segmentEndpoint,
		sessions:        map[string]*HLSSession{},
		stopChan:        make(chan struct{}),
	}
	go m.janitor()
	return m, nil
}

// janitor reaps sessions nobody has touched for hlsIdleTimeout.
func (m *HLSManager) janitor() {
	ticker := time.NewTicker(hlsJanitorInterval)
	defer ticker.Stop()
	for {
		select {
		case <-m.stopChan:
			return
		case <-ticker.C:
			m.reapIdle()
		}
	}
}

func (m *HLSManager) reapIdle() {
	m.mu.Lock()
	var expired []*HLSSession
	for key, session := range m.sessions {
		if session.idleFor() > hlsIdleTimeout {
			expired = append(expired, session)
			delete(m.sessions, key)
		}
	}
	m.mu.Unlock()

	for _, session := range expired {
		session.stop()
		logger.PrintAndLog("Transcoder", "Reaped idle HLS session "+session.ID, nil)
	}
}

// Close stops the janitor and tears down every live session.
func (m *HLSManager) Close() {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return
	}
	m.closed = true
	close(m.stopChan)
	sessions := make([]*HLSSession, 0, len(m.sessions))
	for key, session := range m.sessions {
		sessions = append(sessions, session)
		delete(m.sessions, key)
	}
	m.mu.Unlock()

	for _, session := range sessions {
		session.stop()
	}
	os.RemoveAll(m.root)
}

// Session returns a live session by ID, or nil. It counts as activity, so
// fetching segments keeps the session from being reaped mid-playback.
func (m *HLSManager) Session(id string) *HLSSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, session := range m.sessions {
		if session.ID == id {
			session.touch()
			return session
		}
	}
	return nil
}

// GetOrCreate returns the session for this exact transcode, starting one if it
// is not already running.
//
// client identifies the player asking, so that a seek - which arrives as a
// request for the same file at a different offset - retires the transcode it
// replaces instead of leaving it running. Pass an empty string when there is no
// such id; the previous transcode of the same file for the same user is then
// treated as the one being replaced.
func (m *HLSManager) GetOrCreate(owner string, client string, inputFile string, resolution TranscodeOutputResolution, startTime float64) (*HLSSession, error) {
	key := hlsSessionKey(owner, inputFile, resolution, startTime)

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil, errors.New("HLS manager closed")
	}
	if existing, ok := m.sessions[key]; ok {
		existing.touch()
		m.mu.Unlock()
		return existing, nil
	}
	m.mu.Unlock()

	// Make room before starting another transcode; each one costs a process.
	m.evictToCapacity()

	session := &HLSSession{
		ID:         key,
		Owner:      owner,
		Client:     client,
		Source:     inputFile,
		Dir:        filepath.Join(m.root, key),
		StartTime:  startTime,
		stderr:     &tailBuffer{},
		lastAccess: time.Now(),
	}
	if err := os.MkdirAll(session.Dir, 0755); err != nil {
		return nil, err
	}

	args, err := buildHLSArgs(inputFile, session.Dir, resolution, startTime,
		m.segmentBaseURL(key), getHWEncoderProfile())
	if err != nil {
		os.RemoveAll(session.Dir)
		return nil, err
	}

	cmd := exec.Command("ffmpeg", args...)
	//Kept rather than discarded: when a transcode produces no playable segment,
	//ffmpeg's own message is the only thing that says why.
	cmd.Stderr = session.stderr
	if err := cmd.Start(); err != nil {
		os.RemoveAll(session.Dir)
		return nil, err
	}
	session.cmd = cmd
	session.exited = make(chan struct{})
	//Sole owner of cmd.Wait: reaps the process whether it finishes the file or
	//is killed, and signals both facts through the same channel.
	go func(exited chan struct{}) {
		cmd.Wait()
		close(exited)
	}(session.exited)

	m.mu.Lock()
	// Another request may have created the same session while ffmpeg was
	// starting; keep the winner and discard this duplicate.
	if existing, ok := m.sessions[key]; ok {
		m.mu.Unlock()
		session.stop()
		existing.touch()
		return existing, nil
	}
	m.sessions[key] = session
	superseded := m.collectSuperseded(key, session)
	m.mu.Unlock()

	for _, old := range superseded {
		old.stop()
		logger.PrintAndLog("Transcoder", "Retired superseded HLS session "+old.ID, nil)
	}
	return session, nil
}

// collectSuperseded removes and returns the sessions the newly created one
// replaces: the same player's earlier transcodes, or - when the player did not
// identify itself - the same user's earlier transcodes of the same file.
//
// Must be called with m.mu held; the returned sessions are stopped by the
// caller once the lock is released, since stopping waits on a process.
func (m *HLSManager) collectSuperseded(newKey string, session *HLSSession) []*HLSSession {
	var superseded []*HLSSession
	for key, candidate := range m.sessions {
		if key == newKey {
			continue
		}
		if candidate.Owner != session.Owner {
			continue
		}
		if session.Client != "" {
			//A player only ever plays one thing at a time, so anything else it
			//started - another offset, or the previous episode - is finished with.
			if candidate.Client != session.Client {
				continue
			}
		} else if candidate.Client != "" || candidate.Source != session.Source {
			//Without an id the most that can be assumed is that the same user
			//re-opened the same file. Never retire a session that does belong to
			//an identified player.
			continue
		}
		superseded = append(superseded, candidate)
		delete(m.sessions, key)
	}
	return superseded
}

// evictToCapacity stops the least recently used sessions until there is room
// for one more.
func (m *HLSManager) evictToCapacity() {
	for {
		m.mu.Lock()
		if len(m.sessions) < hlsMaxSessions {
			m.mu.Unlock()
			return
		}
		var oldestKey string
		var oldest *HLSSession
		for key, session := range m.sessions {
			if oldest == nil || session.idleFor() > oldest.idleFor() {
				oldestKey, oldest = key, session
			}
		}
		if oldest == nil {
			m.mu.Unlock()
			return
		}
		delete(m.sessions, oldestKey)
		m.mu.Unlock()

		oldest.stop()
		logger.PrintAndLog("Transcoder", "Evicted HLS session "+oldest.ID+" to stay within the session limit", nil)
	}
}

func (m *HLSManager) segmentBaseURL(sessionID string) string {
	return m.segmentEndpoint + "?sid=" + sessionID + "&name="
}

// ReadPlaylist returns the session's playlist with the #EXT-X-MAP init segment
// URI rewritten onto the segment endpoint.
//
// -hls_base_url only rewrites media segment URIs; ffmpeg always writes the
// init segment as a bare filename. Left alone it would resolve relative to the
// playlist URL (/media/hls?file=…) and 404, so the rewrite happens here rather
// than leaving every client to work it out.
func (m *HLSManager) ReadPlaylist(session *HLSSession) ([]byte, error) {
	content, err := os.ReadFile(session.PlaylistPath())
	if err != nil {
		return nil, err
	}
	return rewritePlaylistInitURI(content, m.segmentBaseURL(session.ID)+HLSInitSegmentName), nil
}

// rewritePlaylistInitURI replaces the URI inside an #EXT-X-MAP tag. Split out
// from the file read so the substitution can be unit-tested directly.
func rewritePlaylistInitURI(playlist []byte, initURL string) []byte {
	lines := strings.Split(string(playlist), "\n")
	for i, line := range lines {
		if !strings.HasPrefix(strings.TrimSpace(line), "#EXT-X-MAP:") {
			continue
		}
		start := strings.Index(line, `URI="`)
		if start < 0 {
			continue
		}
		start += len(`URI="`)
		end := strings.Index(line[start:], `"`)
		if end < 0 {
			continue
		}
		lines[i] = line[:start] + initURL + line[start+end:]
	}
	return []byte(strings.Join(lines, "\n"))
}

// WaitForPlaylist blocks until the session's playlist lists at least one
// segment, so the player is never handed an empty playlist to choke on.
func (s *HLSSession) WaitForPlaylist(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	s.mu.Lock()
	exited := s.exited
	s.mu.Unlock()

	for {
		if playlistHasSegment(s.PlaylistPath()) {
			return nil
		}
		// Check for a dead transcode only after re-checking the playlist above,
		// so a process that exited right after writing its last segment still
		// counts as a success.
		select {
		case <-exited:
			if playlistHasSegment(s.PlaylistPath()) {
				return nil
			}
			return errors.New("transcode ended before producing any segment")
		default:
		}
		if time.Now().After(deadline) {
			return errors.New("timed out waiting for the first segment")
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// playlistHasSegment reports whether the playlist on disk already references a
// segment. ffmpeg writes the header before the first segment is complete, so
// the file existing is not on its own enough.
func playlistHasSegment(path string) bool {
	content, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return strings.Contains(string(content), hlsSegmentSuffix)
}
