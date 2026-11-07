package utils

import (
	"net/http"
	"os"
	"strconv"
)

// FileETag identifies one version of a file. Last-Modified alone only resolves
// to a second, which is not enough to tell two quick saves of a file apart.
func FileETag(info os.FileInfo) string {
	return `"` + strconv.FormatInt(info.ModTime().UnixNano(), 16) + "-" + strconv.FormatInt(info.Size(), 16) + `"`
}

// SetRevalidationHeaders makes the browser check with the server before it
// reuses a stored copy of a user file. These files are overwritten in place
// under the same URL, and with only a Last-Modified header a browser guesses a
// lifetime and keeps answering from its cache without asking. A client reading
// a file in parts (the PDF reader, video players) then pairs the old length from
// the cache with byte ranges of the new file, which breaks a perfectly valid
// file. Checking costs a 304 when nothing changed, and private keeps permission
// checked content out of shared caches. Call it before http.ServeFile or
// http.ServeContent, which answer the conditional requests from these headers.
// info may be nil when the file cannot be stat cheaply: the check is then still
// forced, but there is no ETag to compare.
func SetRevalidationHeaders(w http.ResponseWriter, info os.FileInfo) {
	w.Header().Set("Cache-Control", "private, no-cache")
	if info != nil && !info.ModTime().IsZero() {
		w.Header().Set("ETag", FileETag(info))
	}
}
