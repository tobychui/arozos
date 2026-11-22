package syncserv

import (
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

/*
	layout.go

	Where an upload goes inside the user's sync folder: the type folder
	(Photo, Video, ...), the date folders (2026, 2026_08 or 2026/08) and a
	file name that is safe on every disk ArozOS writes to.
*/

// Type folders
const (
	KindPhoto    = "Photo"
	KindVideo    = "Video"
	KindAudio    = "Audio"
	KindDocument = "Document"
	KindOther    = "Other"
)

// Date folder layouts
const (
	DateNone   = ""       //No date folders
	DateYear   = "year"   //2026
	DateMonth  = "month"  //2026_08
	DateNested = "nested" //2026/08
)

// Which date sorts an upload
const (
	SourceCreated = "created" //Taken or created, the upload date when unknown
	SourceUpload  = "upload"  //When the server received it
)

// What happens when the file is already there
const (
	DuplicateSkip      = "skip"
	DuplicateOverwrite = "overwrite"
)

var kindByExt = map[string]string{}

func init() {
	add := func(kind string, exts ...string) {
		for _, ext := range exts {
			kindByExt[ext] = kind
		}
	}
	add(KindPhoto, ".jpg", ".jpeg", ".jpe", ".heic", ".heif", ".hif", ".avif", ".png", ".gif", ".webp", ".bmp",
		".tif", ".tiff", ".dng", ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".srf", ".sr2", ".orf", ".rw2", ".raf",
		".pef", ".raw", ".rwl", ".3fr", ".srw", ".x3f", ".jxl")
	add(KindVideo, ".mov", ".mp4", ".m4v", ".3gp", ".3g2", ".avi", ".mkv", ".webm", ".mts", ".m2ts", ".mpg",
		".mpeg", ".wmv", ".flv", ".hevc", ".insv", ".lrv")
	add(KindAudio, ".m4a", ".mp3", ".wav", ".aac", ".flac", ".ogg", ".oga", ".opus", ".caf", ".aif", ".aiff",
		".wma", ".amr", ".alac")
	add(KindDocument, ".pdf", ".txt", ".md", ".rtf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt",
		".ods", ".odp", ".csv", ".pages", ".numbers", ".key", ".epub", ".json", ".xml", ".html", ".htm")
}

// Classify names the type folder of a file name.
func Classify(name string) string {
	if kind, ok := kindByExt[strings.ToLower(path.Ext(name))]; ok {
		return kind
	}
	return KindOther
}

// DateFolder is the date part of the folder an upload goes to.
func DateFolder(layout string, t time.Time) string {
	year := strconv.Itoa(t.Year())
	month := t.Format("01")
	switch layout {
	case DateYear:
		return year
	case DateMonth:
		return year + "_" + month
	case DateNested:
		return year + "/" + month
	}
	return ""
}

// Subfolder is the folder, relative to the sync folder, an upload goes to.
// It is empty when uploads go straight into the sync folder.
func Subfolder(settings UserSettings, kind string, t time.Time) string {
	parts := []string{}
	if settings.ByType {
		parts = append(parts, kind)
	}
	if date := DateFolder(settings.DateFolders, t); date != "" {
		parts = append(parts, date)
	}
	return strings.Join(parts, "/")
}

// Characters Windows and most network drives refuse in a file name
const badNameChars = `<>:"/\|?*`

var windowsDeviceNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

const maxNameBytes = 200

// CleanName turns the name a client sent into a plain file name: the last
// element of any path, no control characters or characters a disk would
// refuse, no leading dots (hidden or traversal names), at most 200 bytes.
// It returns "" when nothing usable is left.
func CleanName(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r == utf8.RuneError, r < 0x20, r == 0x7f, unicode.Is(unicode.Cf, r):
			continue
		case strings.ContainsRune(badNameChars, r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	name = strings.TrimLeft(b.String(), ". ")
	//Windows drops trailing dots and spaces itself
	name = strings.TrimRight(name, ". ")
	if name == "" {
		return ""
	}
	stem := name
	if i := strings.Index(stem, "."); i >= 0 {
		stem = stem[:i]
	}
	if windowsDeviceNames[strings.ToUpper(strings.TrimSpace(stem))] {
		name = "_" + name
	}
	if len(name) > maxNameBytes {
		ext := path.Ext(name)
		if len(ext) > 16 {
			ext = ""
		}
		stem := name[:len(name)-len(ext)]
		cut := maxNameBytes - len(ext)
		for cut > 0 && !utf8.RuneStart(stem[cut]) {
			cut--
		}
		name = strings.TrimRight(stem[:cut], ". ") + ext
	}
	return name
}

// extByContentType names a file that came without a name.
var extByContentType = map[string]string{
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/gif":       ".gif",
	"image/webp":      ".webp",
	"image/heic":      ".heic",
	"image/heif":      ".heif",
	"image/bmp":       ".bmp",
	"image/tiff":      ".tiff",
	"video/quicktime": ".mov",
	"video/mp4":       ".mp4",
	"video/webm":      ".webm",
	"audio/mpeg":      ".mp3",
	"audio/mp4":       ".m4a",
	"audio/x-m4a":     ".m4a",
	"audio/wave":      ".wav",
	"audio/wav":       ".wav",
	"application/pdf": ".pdf",
	"text/plain":      ".txt",
}

// ExtForContentType is the extension for a media type, "" when unknown.
func ExtForContentType(contentType string) string {
	contentType = strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	return extByContentType[contentType]
}

var (
	ymdPattern       = regexp.MustCompile(`(\d{4})\s*[-/.:年]\s*(\d{1,2})\s*[-/.:月]\s*(\d{1,2})`)
	monthNamePattern = regexp.MustCompile(`(?i)\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`)
	dayMonthPattern  = regexp.MustCompile(`(?i)\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})`)
	monthNames       = map[string]time.Month{"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
)

var dateLayouts = []string{
	time.RFC3339Nano,
	"2006-01-02T15:04:05Z0700",
	"2006-01-02T15:04:05",
	"2006-01-02T15:04Z07:00",
	"2006-01-02T15:04",
	"2006-01-02 15:04:05Z07:00",
	"2006-01-02 15:04:05 -0700",
	"2006-01-02 15:04:05",
	"2006-01-02 15:04",
	"2006:01:02 15:04:05",
	"20060102T150405Z0700",
	"20060102T150405",
	"2006-01-02",
	time.RFC1123Z,
	time.RFC1123,
}

func plausible(t time.Time) bool {
	return t.Year() >= 1970 && t.Year() <= 2200
}

// ParseDate reads the date a client sent along with a file: ISO 8601 (what
// iOS Shortcuts sends with the ISO 8601 date format), Unix seconds or
// milliseconds, EXIF style, or at least a year, month and day in a date
// written for people, as "2026年8月14日" or "Aug 14, 2026 at 10:22". A date
// with a time zone keeps it, so the day is the one on the phone.
func ParseDate(text string) (time.Time, bool) {
	text = strings.TrimSpace(text)
	if text == "" || len(text) > 128 {
		return time.Time{}, false
	}
	if n, err := strconv.ParseInt(text, 10, 64); err == nil {
		var t time.Time
		switch {
		case n > 1e11 && n < 1e14:
			t = time.UnixMilli(n)
		case n > 0 && n < 1e11:
			t = time.Unix(n, 0)
		default:
			return time.Time{}, false
		}
		return t, plausible(t)
	}
	for _, layout := range dateLayouts {
		if t, err := time.ParseInLocation(layout, text, time.Local); err == nil && plausible(t) {
			return t, true
		}
	}
	if m := ymdPattern.FindStringSubmatch(text); m != nil {
		return ymd(m[1], m[2], m[3])
	}
	if m := monthNamePattern.FindStringSubmatch(text); m != nil {
		return ymdMonth(m[3], monthNames[strings.ToLower(m[1][:3])], m[2])
	}
	if m := dayMonthPattern.FindStringSubmatch(text); m != nil {
		return ymdMonth(m[3], monthNames[strings.ToLower(m[2][:3])], m[1])
	}
	return time.Time{}, false
}

func ymd(year, month, day string) (time.Time, bool) {
	m, err := strconv.Atoi(month)
	if err != nil {
		return time.Time{}, false
	}
	return ymdMonth(year, time.Month(m), day)
}

func ymdMonth(year string, month time.Month, day string) (time.Time, bool) {
	y, err1 := strconv.Atoi(year)
	d, err2 := strconv.Atoi(day)
	if err1 != nil || err2 != nil || month < 1 || month > 12 || d < 1 || d > 31 {
		return time.Time{}, false
	}
	t := time.Date(y, month, d, 12, 0, 0, 0, time.Local)
	if t.Month() != month {
		//31 February and the like
		return time.Time{}, false
	}
	return t, plausible(t)
}

// Numbered is name with " (n)" before its extension, for a file that has
// the name of a different file already there.
func Numbered(name string, n int) string {
	ext := path.Ext(name)
	if len(ext) > 16 || ext == name {
		ext = ""
	}
	return name[:len(name)-len(ext)] + " (" + strconv.Itoa(n) + ")" + ext
}

// sniffExt names the extension of content that came without a file name.
func sniffExt(head []byte, contentType string) string {
	if len(head) >= 12 && string(head[4:8]) == "ftyp" {
		switch string(head[8:12]) {
		case "heic", "heix", "heim", "heis", "mif1", "msf1":
			return ".heic"
		case "avif", "avis":
			return ".avif"
		case "qt  ":
			return ".mov"
		case "M4A ":
			return ".m4a"
		default:
			return ".mp4"
		}
	}
	if ext := ExtForContentType(contentType); ext != "" {
		return ext
	}
	return ExtForContentType(http.DetectContentType(head))
}
