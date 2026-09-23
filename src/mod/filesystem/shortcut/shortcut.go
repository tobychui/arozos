package shortcut

import (
	"errors"
	"net/url"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/utils"
)

/*
	A simple package to better handle shortcuts in ArozOS

	A shortcut file is plain text. The first four lines are fixed:

		type    (module / folder / url)
		name    (label shown on the desktop)
		path    (module name, virtual folder path or URL)
		icon    (web path or URL of the icon)

	Any following lines are optional key=value launch options, e.g.

		title=My Web App
		openin=tab
		width=1080
		height=640

	Older readers only look at the first four lines, so the extension is
	backward compatible.

	Author: tobychui
*/

// Option keys used in the key=value section of a shortcut file
const (
	OptWindowTitle  = "title"
	OptOpenIn       = "openin"
	OptWindowWidth  = "width"
	OptWindowHeight = "height"
)

// Values accepted for OptOpenIn
const (
	OpenInFloatWindow = "float"
	OpenInNewTab      = "tab"
)

// Limits for the initial floatWindow size
const (
	MinWindowSize = 100
	MaxWindowSize = 10000
)

func ReadShortcut(shortcutContent []byte) (*arozfs.ShortcutData, error) {
	//Split the content of the shortcut files into lines
	fileContent := strings.ReplaceAll(strings.TrimSpace(string(shortcutContent)), "\r\n", "\n")
	lines := strings.Split(fileContent, "\n")

	if len(lines) < 4 {
		return nil, errors.New("Corrupted Shortcut File")
	}

	for i := 0; i < len(lines); i++ {
		lines[i] = strings.TrimSpace(lines[i])
	}

	//Render it as shortcut data
	result := arozfs.ShortcutData{
		Type: lines[0],
		Name: lines[1],
		Path: lines[2],
		Icon: lines[3],
	}

	//Parse the optional key=value launch options
	for _, line := range lines[4:] {
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.ToLower(strings.TrimSpace(key))
		value = strings.TrimSpace(value)
		switch key {
		case OptWindowTitle:
			result.WindowTitle = value
		case OptOpenIn:
			result.OpenIn = NormalizeOpenIn(value)
		case OptWindowWidth:
			result.WindowWidth = NormalizeWindowSize(value)
		case OptWindowHeight:
			result.WindowHeight = NormalizeWindowSize(value)
		case "":
			continue
		default:
			if result.Extra == nil {
				result.Extra = map[string]string{}
			}
			result.Extra[key] = value
		}
	}

	return &result, nil
}

// NormalizeOpenIn maps a user supplied open-in value to a known one, or "" for default
func NormalizeOpenIn(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case OpenInFloatWindow:
		return OpenInFloatWindow
	case OpenInNewTab:
		return OpenInNewTab
	}
	return ""
}

// NormalizeWindowSize parses a window dimension, returning 0 (use default) when invalid
func NormalizeWindowSize(value string) int {
	size, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || size <= 0 {
		return 0
	}
	if size < MinWindowSize {
		return MinWindowSize
	}
	if size > MaxWindowSize {
		return MaxWindowSize
	}
	return size
}

// singleLine keeps a value on one line so it cannot break the file layout
func singleLine(value string) string {
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	return strings.TrimSpace(value)
}

// EncodeShortcut serializes shortcut data (including launch options) into file content
func EncodeShortcut(data *arozfs.ShortcutData) []byte {
	lines := []string{
		singleLine(data.Type),
		singleLine(data.Name),
		singleLine(data.Path),
		singleLine(data.Icon),
	}

	if title := singleLine(data.WindowTitle); title != "" {
		lines = append(lines, OptWindowTitle+"="+title)
	}
	if openIn := NormalizeOpenIn(data.OpenIn); openIn != "" {
		lines = append(lines, OptOpenIn+"="+openIn)
	}
	if width := NormalizeWindowSize(strconv.Itoa(data.WindowWidth)); width > 0 {
		lines = append(lines, OptWindowWidth+"="+strconv.Itoa(width))
	}
	if height := NormalizeWindowSize(strconv.Itoa(data.WindowHeight)); height > 0 {
		lines = append(lines, OptWindowHeight+"="+strconv.Itoa(height))
	}

	//Keep unknown options in a stable order
	extraKeys := make([]string, 0, len(data.Extra))
	for key := range data.Extra {
		extraKeys = append(extraKeys, key)
	}
	sort.Strings(extraKeys)
	for _, key := range extraKeys {
		cleanKey := strings.ToLower(singleLine(key))
		if cleanKey == "" || strings.Contains(cleanKey, "=") {
			continue
		}
		lines = append(lines, cleanKey+"="+singleLine(data.Extra[key]))
	}

	return []byte(strings.Join(lines, "\n"))
}

// IsWebURL reports whether target is an absolute http(s) URL, the only kind a url shortcut may open
func IsWebURL(target string) bool {
	u, err := url.Parse(strings.TrimSpace(target))
	if err != nil || u.Host == "" {
		return false
	}
	return u.Scheme == "http" || u.Scheme == "https"
}

// ClearLaunchOptions drops the launch options, used for types that do not support them
func ClearLaunchOptions(data *arozfs.ShortcutData) {
	data.WindowTitle = ""
	data.OpenIn = ""
	data.WindowWidth = 0
	data.WindowHeight = 0
}

// Generate the content of a shortcut base the the four important field of shortcut information
func GenerateShortcutBytes(shortcutTarget string, shortcutType string, shortcutText string, shortcutIcon string) []byte {
	//Check if there are desktop icon. If yes, override icon on module
	if shortcutType == "module" && utils.FileExists(arozfs.ToSlash(filepath.Join("./web/", filepath.Dir(shortcutIcon), "/desktop_icon.png"))) {
		shortcutIcon = arozfs.ToSlash(filepath.Join(filepath.Dir(shortcutIcon), "/desktop_icon.png"))
	}

	//Clean the shortcut text
	shortcutText = arozfs.FilterIllegalCharInFilename(shortcutText, " ")
	return []byte(shortcutType + "\n" + shortcutText + "\n" + shortcutTarget + "\n" + shortcutIcon)
}
