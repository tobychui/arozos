package icons

import (
	"bytes"
	"errors"
	"image"
	"image/png"
	"os"
	"path"
	"path/filepath"
	"strings"
)

/*
	icons.go

	Desktop icon generation for ArozOS web apps.

	A web app's module icon (the one declared in its init.agi) is designed to be
	edge to edge, which looks wrong on the desktop where icons are expected to
	carry padding around them. When a web app does not ship its own
	desktop_icon.png, this package renders one: the module icon is scaled down
	and centered on top of an opaque squircle backplate coloured to contrast with
	the icon, then written back into the web app folder next to the module icon.

	Author: tobychui
*/

// DesktopIconFilename is the filename a web app is expected to use for the icon
// shown on the desktop, resolved relative to its module icon folder.
const DesktopIconFilename = "desktop_icon.png"

// Generator renders and caches desktop icons for the web apps under a web root.
type Generator struct {
	webRoot string
	options Options
}

// NewGenerator creates a generator writing into the given web root (e.g. "./web")
// using the default rendering options.
func NewGenerator(webRoot string) *Generator {
	return NewGeneratorWithOptions(webRoot, DefaultOptions())
}

// NewGeneratorWithOptions creates a generator with custom rendering options.
// Zero valued fields in the given options fall back to their defaults.
func NewGeneratorWithOptions(webRoot string, options Options) *Generator {
	return &Generator{
		webRoot: webRoot,
		options: options.withDefaults(),
	}
}

// Options returns the rendering options in use by this generator.
func (g *Generator) Options() Options {
	return g.options
}

// EnsureDesktopIcon makes sure a desktop_icon.png exists next to the given
// module icon. moduleIconPath is a path relative to the web root, for example
// "Photo/img/module_icon.png". If the desktop icon is already there nothing is
// done; otherwise one is generated from the module icon and written into the web
// app folder.
//
// The web root relative path of the desktop icon is returned, together with a
// flag telling whether this call was the one that created it.
func (g *Generator) EnsureDesktopIcon(moduleIconPath string) (string, bool, error) {
	moduleIconRel, err := ResolveWebAssetPath(moduleIconPath)
	if err != nil {
		return "", false, err
	}

	desktopIconRel := path.Join(path.Dir(moduleIconRel), DesktopIconFilename)
	desktopIconAbs := g.absPath(desktopIconRel)
	if fileExists(desktopIconAbs) {
		//This web app already ships a desktop icon. Nothing to do.
		return desktopIconRel, false, nil
	}

	if strings.EqualFold(path.Base(moduleIconRel), DesktopIconFilename) {
		//The module icon is the desktop icon we are trying to create. Bail out
		//instead of recursing on a file that does not exist.
		return "", false, errors.New("desktop icon not found and cannot be generated from itself")
	}

	moduleIcon, err := g.LoadWebImage(moduleIconRel)
	if err != nil {
		return "", false, err
	}

	var generatedIcon bytes.Buffer
	err = png.Encode(&generatedIcon, g.Render(moduleIcon))
	if err != nil {
		return "", false, err
	}

	err = os.WriteFile(desktopIconAbs, generatedIcon.Bytes(), 0775)
	if err != nil {
		return "", false, err
	}

	return desktopIconRel, true, nil
}

// LoadWebImage decodes an image stored under the web root. Both the raster
// formats used by the web apps and SVG module icons are supported.
func (g *Generator) LoadWebImage(webRelPath string) (image.Image, error) {
	imageContent, err := os.ReadFile(g.absPath(webRelPath))
	if err != nil {
		return nil, err
	}

	if strings.EqualFold(path.Ext(webRelPath), ".svg") {
		return RasterizeSVG(imageContent, g.options.SVGRenderSize)
	}

	loadedImage, _, err := image.Decode(bytes.NewReader(imageContent))
	return loadedImage, err
}

// absPath maps a web root relative path to a path on the host filesystem.
func (g *Generator) absPath(webRelPath string) string {
	return filepath.Join(g.webRoot, filepath.FromSlash(webRelPath))
}

// ResolveWebAssetPath cleans a caller supplied web root relative asset path and
// collapses any ".." segments trying to climb out of the web root.
func ResolveWebAssetPath(relPath string) (string, error) {
	relPath = strings.TrimSpace(strings.ReplaceAll(relPath, "\\", "/"))
	if relPath == "" {
		return "", errors.New("empty asset path")
	}

	//Cleaning against the root collapses any ".." segments. Use path (not
	//filepath) so this behaves the same on the platforms where the OS separator
	//is not a slash.
	cleanedPath := strings.TrimPrefix(path.Clean("/"+strings.TrimLeft(relPath, "/")), "/")
	if cleanedPath == "" || cleanedPath == "." {
		return "", errors.New("invalid asset path: " + relPath)
	}

	return cleanedPath, nil
}

// fileExists reports whether the given host path points at an existing file
func fileExists(hostPath string) bool {
	_, err := os.Stat(hostPath)
	return err == nil
}
