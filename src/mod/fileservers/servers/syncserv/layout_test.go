package syncserv

import (
	"strings"
	"testing"
	"time"
)

func TestClassify(t *testing.T) {
	cases := map[string]string{
		"IMG_0001.HEIC":    KindPhoto,
		"IMG_0001.jpg":     KindPhoto,
		"Screenshot.PNG":   KindPhoto,
		"photo.DNG":        KindPhoto,
		"IMG_0002.MOV":     KindVideo,
		"clip.mp4":         KindVideo,
		"Recording.m4a":    KindAudio,
		"Invoice.pdf":      KindDocument,
		"notes.TXT":        KindDocument,
		"archive.zip":      KindOther,
		"no_extension":     KindOther,
		"IMG_0001.HEIC.gz": KindOther,
	}
	for name, want := range cases {
		if got := Classify(name); got != want {
			t.Errorf("Classify(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestSubfolder(t *testing.T) {
	when := time.Date(2026, 8, 14, 10, 22, 1, 0, time.Local)
	cases := []struct {
		byType bool
		dates  string
		kind   string
		want   string
	}{
		{false, DateNone, KindPhoto, ""},
		{true, DateNone, KindVideo, "Video"},
		{false, DateYear, KindPhoto, "2026"},
		{false, DateMonth, KindPhoto, "2026_08"},
		{false, DateNested, KindPhoto, "2026/08"},
		{true, DateYear, KindVideo, "Video/2026"},
		{true, DateMonth, KindPhoto, "Photo/2026_08"},
		{true, DateNested, KindOther, "Other/2026/08"},
	}
	for _, c := range cases {
		settings := UserSettings{ByType: c.byType, DateFolders: c.dates}
		if got := Subfolder(settings, c.kind, when); got != c.want {
			t.Errorf("Subfolder(byType=%v, dates=%q, %s) = %q, want %q", c.byType, c.dates, c.kind, got, c.want)
		}
	}
}

func TestCleanName(t *testing.T) {
	long := strings.Repeat("a", 300) + ".jpg"
	cases := []struct {
		in, want string
	}{
		{"IMG_0001.HEIC", "IMG_0001.HEIC"},
		{"../../etc/passwd", "passwd"},
		{`C:\Users\me\DCIM\IMG_1.JPG`, "IMG_1.JPG"},
		{"..", ""},
		{".", ""},
		{"", ""},
		{"...hidden.jpg", "hidden.jpg"},
		{"a<b>c:d\"e|f?g*h.jpg", "a_b_c_d_e_f_g_h.jpg"},
		{"tab\there\x00.jpg", "tabhere.jpg"},
		{"trailing. . ", "trailing"},
		{"CON.jpg", "_CON.jpg"},
		{"nul", "_nul"},
		{"照片 2026.heic", "照片 2026.heic"},
		{"right\u202eto\u200bleft.jpg", "righttoleft.jpg"},
	}
	for _, c := range cases {
		if got := CleanName(c.in); got != c.want {
			t.Errorf("CleanName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	got := CleanName(long)
	if len(got) > maxNameBytes || !strings.HasSuffix(got, ".jpg") {
		t.Errorf("CleanName of a long name = %d bytes %q", len(got), got)
	}
	cjk := CleanName(strings.Repeat("照", 100) + ".jpg")
	if len(cjk) > maxNameBytes || !strings.HasSuffix(cjk, ".jpg") || strings.ContainsRune(cjk, '\uFFFD') {
		t.Errorf("CleanName cut a character in half: %q", cjk)
	}
}

func TestParseDate(t *testing.T) {
	cases := []struct {
		in    string
		ok    bool
		year  int
		month time.Month
		day   int
	}{
		{"2026-08-14T10:22:01+08:00", true, 2026, 8, 14},
		{"2026-08-31T23:30:00-05:00", true, 2026, 8, 31},
		{"2026-08-14T10:22:01Z", true, 2026, 8, 14},
		{"2026-08-14T10:22:01", true, 2026, 8, 14},
		{"2026-08-14 10:22:01", true, 2026, 8, 14},
		{"2026-08-14", true, 2026, 8, 14},
		{"2026:08:14 10:22:01", true, 2026, 8, 14},
		{"20260814T102201", true, 2026, 8, 14},
		{"2026年8月14日 上午10:22", true, 2026, 8, 14},
		{"2026. 8. 14. 오전 10:22", true, 2026, 8, 14},
		{"2026/08/14 10:22", true, 2026, 8, 14},
		{"Aug 14, 2026 at 10:22 AM", true, 2026, 8, 14},
		{"August 14, 2026", true, 2026, 8, 14},
		{"14 Aug 2026 at 10:22", true, 2026, 8, 14},
		{"1786708800", true, 2026, 8, 14}, //Noon UTC: the same day from UTC-11 to UTC+11
		{"1786708800000", true, 2026, 8, 14},
		{"", false, 0, 0, 0},
		{"yesterday", false, 0, 0, 0},
		{"2026-02-31", false, 0, 0, 0},
		{"0000:00:00 00:00:00", false, 0, 0, 0},
		{"-5", false, 0, 0, 0},
		{strings.Repeat("9", 200), false, 0, 0, 0},
	}
	for _, c := range cases {
		got, ok := ParseDate(c.in)
		if ok != c.ok {
			t.Errorf("ParseDate(%q) ok = %v, want %v", c.in, ok, c.ok)
			continue
		}
		if ok && (got.Year() != c.year || got.Month() != c.month || got.Day() != c.day) {
			t.Errorf("ParseDate(%q) = %v, want %d-%d-%d", c.in, got, c.year, c.month, c.day)
		}
	}
}

func TestNumbered(t *testing.T) {
	cases := map[string]string{
		"IMG_0001.HEIC": "IMG_0001 (2).HEIC",
		"README":        "README (2)",
		"a.tar.gz":      "a.tar (2).gz",
	}
	for in, want := range cases {
		if got := Numbered(in, 2); got != want {
			t.Errorf("Numbered(%q, 2) = %q, want %q", in, got, want)
		}
	}
	if got := numberedRel("Photo/2026_08/IMG_1.JPG", 1); got != "Photo/2026_08/IMG_1 (1).JPG" {
		t.Errorf("numberedRel = %q", got)
	}
}

func TestSniffExt(t *testing.T) {
	cases := []struct {
		head        []byte
		contentType string
		want        string
	}{
		{[]byte("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00"), "", ".heic"},
		{[]byte("\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00"), "", ".mov"},
		{[]byte("\x00\x00\x00\x18ftypisom\x00\x00\x00\x00"), "", ".mp4"},
		{[]byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00"), "application/octet-stream", ".jpg"},
		{[]byte("whatever"), "image/png", ".png"},
		{[]byte{0x01, 0x02, 0x03}, "", ""},
	}
	for _, c := range cases {
		if got := sniffExt(c.head, c.contentType); got != c.want {
			t.Errorf("sniffExt(%q, %q) = %q, want %q", c.head, c.contentType, got, c.want)
		}
	}
}

func TestValidateSettings(t *testing.T) {
	good := DefaultSettings()
	if _, err := ValidateSettings(good); err != nil {
		t.Fatalf("default settings refused: %v", err)
	}
	bad := []UserSettings{
		{Folder: ""},
		{Folder: "Phone Uploads"},
		{Folder: "user:/x", DateFolders: "weekly"},
		{Folder: "user:/x", DateSource: "exif"},
		{Folder: "user:/x", Duplicates: "rename"},
	}
	for _, s := range bad {
		if _, err := ValidateSettings(s); err == nil {
			t.Errorf("ValidateSettings(%+v) accepted", s)
		}
	}
	filled, err := ValidateSettings(UserSettings{Folder: "user:/x"})
	if err != nil || filled.DateSource != SourceCreated || filled.Duplicates != DuplicateSkip {
		t.Errorf("empty choices not filled in: %+v, %v", filled, err)
	}
}

func TestValidateSyncPassword(t *testing.T) {
	cases := map[string]bool{
		"short":                  false,
		"long enough":            true,
		" leading space":         false,
		"trailing space ":        false,
		"ctrl\x01chars":          false,
		strings.Repeat("x", 72):  true,
		strings.Repeat("x", 73):  false,
		"日本語のパスワード":              true,
		"correct horse battery!": true,
	}
	for password, ok := range cases {
		if err := ValidateSyncPassword(password); (err == nil) != ok {
			t.Errorf("ValidateSyncPassword(%q) = %v, want ok=%v", password, err, ok)
		}
	}
}
