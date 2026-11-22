package utils

import (
	"mime"
	"net/http"
	"path/filepath"
	"strings"
)

/*
	User files shown inline

	Files users upload are served on the ArozOS origin itself (/media, share
	preview links, WebDAV). A file a browser can run as a page (HTML, SVG,
	XML) would run with the session of whoever opens it, so a user could
	share one and act as everyone who looks at it. Such files are therefore
	sent with a sandbox Content-Security-Policy: the browser gives the page
	an origin of its own, so its scripts still run (previews keep working)
	but cannot read this site's cookies, storage, API answers or the desktop
	around it. Pictures, video, audio, PDF and text are left as they are.
*/

// UserContentSandbox is the Content-Security-Policy of a user file that a
// browser could open as a page. It has no allow-same-origin on purpose.
const UserContentSandbox = "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"

// IsActiveUserContent reports whether a browser may run scripts in a file
// of this name when it is opened as a page: HTML, XHTML, SVG and XML of any
// kind (XSLT can turn it into HTML), and any file whose type the extension
// does not tell, which the server or the browser would sniff.
func IsActiveUserContent(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		return true
	}
	ctype := mime.TypeByExtension(ext)
	if ctype == "" {
		return true
	}
	mediaType, _, err := mime.ParseMediaType(ctype)
	if err != nil {
		return true
	}
	switch mediaType {
	case "text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/xml",
		"text/xsl", "application/xslt+xml", "message/rfc822", "multipart/related", "application/octet-stream":
		return true
	}
	return strings.HasSuffix(mediaType, "+xml")
}

// SetUserContentHeaders prepares the answer that shows a user file inline.
// Call it before http.ServeFile, http.ServeContent or copying the file out.
// A file that could be a page gets the sandbox policy and nosniff; every
// other file gets the Content-Type of its extension set here, so a server
// side guess from its bytes (a .png that holds HTML) never decides it.
func SetUserContentHeaders(w http.ResponseWriter, filename string) {
	if IsActiveUserContent(filename) {
		w.Header().Set("Content-Security-Policy", UserContentSandbox)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		return
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", mime.TypeByExtension(strings.ToLower(filepath.Ext(filename))))
	}
}
