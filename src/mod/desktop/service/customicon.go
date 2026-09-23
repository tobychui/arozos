package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"image/png"
	"net/url"
	"path"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

/*
	Custom shortcut icons

	The shortcut editor crops an image (or renders a preset) to a square PNG in
	the browser and posts it as a data URL. The server decodes and re-encodes
	it, so only a plain PNG ever reaches the disk, and stores it in the hidden
	.metadata/.sc_icon folder next to the shortcut (beside .metadata/.cache and
	.metadata/.localver), named by content hash: the same picture is stored
	once and a changed picture gets a new URL, so no stale browser cache.
*/

const (
	//customIconFolder is the hidden folder, next to the shortcut, holding its custom icons
	customIconFolder = ".metadata/.sc_icon"

	//Limits of an uploaded custom icon
	minCustomIconSize  = 16
	maxCustomIconSize  = 512
	maxCustomIconBytes = 2 << 20

	pngDataURLPrefix = "data:image/png;base64,"
)

// decodeCustomIcon validates a square PNG data URL and returns it re-encoded
func decodeCustomIcon(dataURL string) ([]byte, error) {
	if !strings.HasPrefix(dataURL, pngDataURLPrefix) {
		return nil, errors.New("Icon must be a PNG image")
	}
	encoded := strings.TrimPrefix(dataURL, pngDataURLPrefix)
	if base64.StdEncoding.DecodedLen(len(encoded)) > maxCustomIconBytes {
		return nil, errors.New("Icon image is too large")
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, errors.New("Icon image is corrupted")
	}

	//Check the size before decoding the pixels
	config, err := png.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("Icon image is corrupted")
	}
	if config.Width != config.Height {
		return nil, errors.New("Icon image must be square")
	}
	if config.Width < minCustomIconSize || config.Width > maxCustomIconSize {
		return nil, errors.New("Icon image size is out of range")
	}

	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("Icon image is corrupted")
	}
	var clean bytes.Buffer
	if err := png.Encode(&clean, img); err != nil {
		return nil, err
	}
	return clean.Bytes(), nil
}

// customIconFilename names an icon by its content
func customIconFilename(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:8]) + ".png"
}

// customIconVpath is the virtual path of an icon stored next to the given shortcut
func customIconVpath(shortcutVpath string, filename string) string {
	return path.Join(path.Dir(shortcutVpath), customIconFolder, filename)
}

// mediaURL is the web path the desktop loads a user file through
func mediaURL(vpath string) string {
	return "media/?file=" + url.QueryEscape(vpath)
}

// writeCustomIcon stores the icon next to the shortcut at shortcutRpath
func writeCustomIcon(fsh *filesystem.FileSystemHandler, shortcutRpath string, filename string, content []byte) error {
	fshAbs := fsh.FileSystemAbstraction
	iconDir := arozfs.ToSlash(filepath.Join(filepath.Dir(shortcutRpath), customIconFolder))
	if !fshAbs.FileExists(iconDir) {
		if err := fshAbs.MkdirAll(iconDir, 0755); err != nil {
			return err
		}
	}
	iconPath := arozfs.ToSlash(filepath.Join(iconDir, filename))
	if fshAbs.FileExists(iconPath) {
		//Same content, already stored
		return nil
	}
	return fshAbs.WriteFile(iconPath, content, 0775)
}
