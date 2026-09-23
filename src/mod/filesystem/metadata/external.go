package metadata

/*
	Thumbnails of drives that render them where the file is stored

	A drive whose abstraction implements arozfs.ThumbnailRenderer (cluster:/
	for now) does not get a .metadata/.cache folder: the thumbnail is made by
	whatever holds the file, and the result is kept in a cache folder on this
	host, named after the key the abstraction gives for the content. The key
	changes with the content, so a cached thumbnail never goes stale; old
	ones are removed by PruneExternalCache once nobody has looked at them for
	a while.

	RenderLocalFile is the other half: it runs the ordinary renderers on a
	file this host can open by its OS path, which is what the holder of a
	copy does when another host asks it for a thumbnail.
*/

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

const (
	//externalFailureTTL is how long a file with no thumbnail is not asked
	//for again, so a folder that is opened repeatedly does not send the same
	//failing request to another host every time. A failure that may pass (a
	//holder offline, a timeout) is retried sooner.
	externalFailureTTL      = 10 * time.Minute
	externalRetryFailureTTL = time.Minute
	//externalRenderWait bounds how long a second request for a thumbnail
	//that is being rendered waits for the first one.
	externalRenderWait = 2 * time.Minute
	//MaxThumbnailSize is the largest thumbnail accepted from a renderer.
	MaxThumbnailSize = 4 << 20
)

var (
	externalCacheMu  sync.RWMutex
	externalCacheDir = filepath.Join(os.TempDir(), "arozos-thumbnails")
)

// SetExternalCacheDir sets the folder that keeps the thumbnails of drives
// implementing arozfs.ThumbnailRenderer.
func SetExternalCacheDir(dir string) {
	externalCacheMu.Lock()
	defer externalCacheMu.Unlock()
	externalCacheDir = filepath.Clean(dir)
}

// ExternalCacheDir returns the folder set by SetExternalCacheDir.
func ExternalCacheDir() string {
	externalCacheMu.RLock()
	defer externalCacheMu.RUnlock()
	return externalCacheDir
}

// thumbnailRendererOf returns the renderer of a drive, if it has one.
func thumbnailRendererOf(fsh *filesystem.FileSystemHandler) (arozfs.ThumbnailRenderer, bool) {
	if fsh == nil || fsh.FileSystemAbstraction == nil {
		return nil, false
	}
	r, ok := fsh.FileSystemAbstraction.(arozfs.ThumbnailRenderer)
	return r, ok
}

// externalCachePath is where the thumbnail for a content key is kept. The key
// is hashed so that whatever characters an abstraction puts in it, the file
// name is safe, and the first two characters spread the files over folders.
func externalCachePath(key string) string {
	sum := sha256.Sum256([]byte(key))
	name := hex.EncodeToString(sum[:])
	return filepath.Join(ExternalCacheDir(), name[:2], name+".thumb")
}

// externalCacheFile returns the cache path of a file and whether the
// thumbnail is there.
func externalCacheFile(r arozfs.ThumbnailRenderer, rpath string) (string, bool) {
	if !ThumbnailSupported(rpath) {
		return "", false
	}
	key, err := r.ThumbnailKey(rpath)
	if err != nil || key == "" {
		return "", false
	}
	cachePath := externalCachePath(key)
	info, err := os.Stat(cachePath)
	return cachePath, err == nil && !info.IsDir()
}

// renderFlight is one thumbnail being rendered, which other requests for
// the same content wait for instead of rendering it again.
type renderFlight struct {
	done chan struct{}
	data []byte
	err  error
}

// loadExternalCache is LoadCache for a drive implementing ThumbnailRenderer.
func (rh *RenderHandler) loadExternalCache(r arozfs.ThumbnailRenderer, rpath string, generateOnly bool) (string, error) {
	if !ThumbnailSupported(rpath) {
		return "", errors.New("no supported format")
	}
	key, err := r.ThumbnailKey(rpath)
	if err != nil {
		return "", err
	}
	if key == "" {
		return "", errors.New("no content key for this file")
	}
	cachePath := externalCachePath(key)

	if data, err := os.ReadFile(cachePath); err == nil {
		//Refresh the time so the pruning keeps thumbnails that are in use
		now := time.Now()
		os.Chtimes(cachePath, now, now)
		if generateOnly {
			return "", nil
		}
		return base64.StdEncoding.EncodeToString(data), nil
	}

	if until, ok := rh.externalFailures.Load(key); ok {
		if time.Now().Before(until.(time.Time)) {
			return "", errors.New("thumbnail rendering failed recently")
		}
		rh.externalFailures.Delete(key)
	}

	data, err := rh.renderExternal(r, rpath, key, cachePath)
	if err != nil {
		return "", err
	}
	if generateOnly {
		return "", nil
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// renderExternal asks the drive for a thumbnail and keeps it, making sure
// one piece of content is rendered once however many requests want it.
func (rh *RenderHandler) renderExternal(r arozfs.ThumbnailRenderer, rpath string, key string, cachePath string) ([]byte, error) {
	flight := &renderFlight{done: make(chan struct{})}
	if existing, loaded := rh.externalFlights.LoadOrStore(key, flight); loaded {
		other := existing.(*renderFlight)
		select {
		case <-other.done:
			return other.data, other.err
		case <-time.After(externalRenderWait):
			return nil, errors.New("timed out waiting for the thumbnail")
		}
	}
	defer func() {
		close(flight.done)
		rh.externalFlights.Delete(key)
	}()

	data, err := r.RenderThumbnail(rpath)
	if err == nil && len(data) == 0 {
		err = arozfs.ErrNoThumbnail
	}
	if err == nil && len(data) > MaxThumbnailSize {
		err = errors.New("thumbnail too large")
	}
	if err != nil {
		ttl := externalRetryFailureTTL
		if errors.Is(err, arozfs.ErrNoThumbnail) {
			ttl = externalFailureTTL
		}
		rh.externalFailures.Store(key, time.Now().Add(ttl))
		flight.err = err
		return nil, err
	}
	//A failed write only means the thumbnail is not kept for next time
	writeFileAtomic(cachePath, data)
	flight.data = data
	return data, nil
}

// writeFileAtomic writes to a temporary file next to path and renames it in
// place, so a reader never sees half a thumbnail.
func writeFileAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".render-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}

// PruneExternalCache removes the kept thumbnails that have not been used for
// maxAge, and returns how many it removed.
func PruneExternalCache(maxAge time.Duration) int {
	root := ExternalCacheDir()
	cutoff := time.Now().Add(-maxAge)
	removed := 0
	filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.ModTime().Before(cutoff) {
			if os.Remove(p) == nil {
				removed++
			}
		}
		return nil
	})
	return removed
}

// RenderLocalFile renders the thumbnail of a file this host can open by its OS
// path and returns the encoded image. The renderers write their output into a
// scratch folder, never next to the file.
func RenderLocalFile(osPath string) ([]byte, error) {
	info, err := os.Stat(osPath)
	if err != nil {
		return nil, err
	}
	if info.IsDir() || !ThumbnailSupported(osPath) {
		return nil, arozfs.ErrNoThumbnail
	}

	scratch, err := os.MkdirTemp("", "arozos-thumb-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(scratch)

	dir := filepath.Dir(osPath)
	fsh := &filesystem.FileSystemHandler{
		Name:                  "thumbnail",
		UUID:                  "thumbnail",
		Path:                  dir,
		Hierarchy:             "public",
		ReadOnly:              true,
		InitiationTime:        time.Now().Unix(),
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("thumbnail", dir, "public", true),
		Filesystem:            "ext4",
	}
	cacheFolder := filepath.ToSlash(scratch)
	if !strings.HasSuffix(cacheFolder, "/") {
		cacheFolder += "/"
	}

	encoded, err := renderThumbnail(fsh, cacheFolder, filepath.ToSlash(osPath), false)
	if err != nil {
		return nil, err
	}
	if encoded == "" {
		return nil, arozfs.ErrNoThumbnail
	}
	return base64.StdEncoding.DecodeString(encoded)
}
