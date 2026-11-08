package aroz

import (
	"io"
	"os"
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/storage/smbserver"
)

func streamOf(base, stream string) string { return base + smbserver.StreamSeparator + stream }

func TestStreamsLiveBesideTheirFile(t *testing.T) {
	s, root := versionShare(t)
	os.MkdirAll(filepath.Join(root, "docs"), 0755)
	os.WriteFile(filepath.Join(root, "docs", "a.txt"), []byte("data"), 0644)

	f, err := s.Open(streamOf("docs/a.txt", "Zone.Identifier"), os.O_RDWR|os.O_CREATE)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteAt([]byte("[ZoneTransfer]\r\nZoneId=3"), 0)
	f.Close()
	sidecar := filepath.Join(root, "docs", ".metadata", ".streams", "a.txt", "Zone.Identifier")
	if got, _ := os.ReadFile(sidecar); string(got) != "[ZoneTransfer]\r\nZoneId=3" {
		t.Fatalf("sidecar %q", got)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "docs", "a.txt")); string(got) != "data" {
		t.Error("the file's own data must not change")
	}

	//An attribute name from macOS, colon and all
	f, _ = s.Open(streamOf("docs/a.txt", "com.apple.metadata:_kMDItemUserTags"), os.O_RDWR|os.O_CREATE)
	f.WriteAt([]byte("tags"), 0)
	f.Close()
	list := s.(smbserver.StreamShare).Streams("docs/a.txt")
	names := map[string]int64{}
	for _, e := range list {
		names[e.Name] = e.Size
	}
	if len(names) != 2 || names["Zone.Identifier"] != 24 || names["com.apple.metadata:_kMDItemUserTags"] != 4 {
		t.Errorf("streams %v", names)
	}
	if info, err := s.Stat(streamOf("docs/a.txt", "Zone.Identifier")); err != nil || info.Size != 24 {
		t.Errorf("stat %v %v", info, err)
	}

	if err := s.Rename("docs/a.txt", "docs/b.txt"); err != nil {
		t.Fatal(err)
	}
	f, err = s.Open(streamOf("docs/b.txt", "Zone.Identifier"), os.O_RDONLY)
	if err != nil {
		t.Fatalf("streams must move with the file: %v", err)
	}
	got, _ := io.ReadAll(io.NewSectionReader(f.(io.ReaderAt), 0, 100))
	f.Close()
	if string(got) != "[ZoneTransfer]\r\nZoneId=3" {
		t.Errorf("moved stream %q", got)
	}

	if err := s.Remove(streamOf("docs/b.txt", "Zone.Identifier")); err != nil {
		t.Fatal(err)
	}
	if len(s.(smbserver.StreamShare).Streams("docs/b.txt")) != 1 {
		t.Error("removing one stream must keep the others")
	}
	if err := s.Remove("docs/b.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "docs", ".metadata", ".streams", "b.txt")); !os.IsNotExist(err) {
		t.Error("a deleted file's streams must go too")
	}
}

func TestFolderAndRootStreams(t *testing.T) {
	cases := map[string]string{
		"":             ".metadata/.rootstreams",
		".root":        ".metadata/.streams/.root",
		".rootstreams": ".metadata/.streams/.rootstreams",
		"docs":         ".metadata/.streams/docs",
		"docs/a.txt":   "docs/.metadata/.streams/a.txt",
	}
	for base, want := range cases {
		if got := streamDir(base); got != want {
			t.Errorf("streamDir(%q) = %q, want %q", base, got, want)
		}
	}
}

func TestStreamNameEscaping(t *testing.T) {
	for _, name := range []string{"Zone.Identifier", "AFP_AfpInfo", "com.apple.metadata:_kMDItemUserTags", "..", ".hidden", "a/b\\c", "日本語", "100%"} {
		enc := encodeStream(name)
		if enc == "." || enc == ".." || filepath.Base(enc) != enc || enc[0] == '.' {
			t.Errorf("%q encodes to the unsafe %q", name, enc)
		}
		back, ok := decodeStream(enc)
		if !ok || back != name {
			t.Errorf("%q round trips to %q", name, back)
		}
	}
	if _, ok := decodeStream("bad%Z"); ok {
		t.Error("a broken escape must not decode")
	}
}

func TestFolderDeleteTakesItsMetadata(t *testing.T) {
	s, root := versionShare(t)
	os.MkdirAll(filepath.Join(root, "docs", ".metadata", ".localver", "2026-11-08_10-00-00"), 0755)
	os.WriteFile(filepath.Join(root, "docs", ".metadata", ".localver", "2026-11-08_10-00-00", "a.txt"), nil, 0644)
	os.MkdirAll(filepath.Join(root, ".metadata", ".streams", "docs"), 0755)
	os.WriteFile(filepath.Join(root, ".metadata", ".streams", "docs", "AFP_AfpInfo"), nil, 0644)
	if err := s.Remove("docs"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "docs")); !os.IsNotExist(err) {
		t.Error("the folder must be gone")
	}
	if _, err := os.Stat(filepath.Join(root, ".metadata", ".streams", "docs")); !os.IsNotExist(err) {
		t.Error("the folder's own streams must go too")
	}
	//A folder with real content is still refused by the file system
	os.MkdirAll(filepath.Join(root, "full"), 0755)
	os.WriteFile(filepath.Join(root, "full", "keep.txt"), nil, 0644)
	if err := s.Remove("full"); err == nil {
		t.Error("a folder with files must not be removed")
	}
}

func writeStream(t *testing.T, s smbserver.Share, p, content string) {
	t.Helper()
	f, err := s.Open(p, os.O_RDWR|os.O_CREATE)
	if err != nil {
		t.Fatalf("open %q: %v", p, err)
	}
	f.WriteAt([]byte(content), 0)
	f.Close()
}

func readStream(t *testing.T, s smbserver.Share, p string) string {
	t.Helper()
	f, err := s.Open(p, os.O_RDONLY)
	if err != nil {
		return ""
	}
	defer f.Close()
	got, _ := io.ReadAll(io.NewSectionReader(f.(io.ReaderAt), 0, 1000))
	return string(got)
}

// A file named like the root's sidecar folder must not share its streams.
func TestRootStreamsAreApartFromFiles(t *testing.T) {
	s, root := versionShare(t)
	streams := s.(smbserver.StreamShare)
	for _, name := range []string{".root", ".rootstreams"} {
		os.WriteFile(filepath.Join(root, name), nil, 0644)
	}
	writeStream(t, s, streamOf("", "AFP_AfpInfo"), "root info")
	writeStream(t, s, streamOf(".root", "AFP_AfpInfo"), "file info")
	writeStream(t, s, streamOf(".rootstreams", "AFP_AfpInfo"), "other info")

	if got := readStream(t, s, streamOf("", "AFP_AfpInfo")); got != "root info" {
		t.Errorf("root stream %q", got)
	}
	if got := readStream(t, s, streamOf(".root", "AFP_AfpInfo")); got != "file info" {
		t.Errorf(".root stream %q", got)
	}
	if err := s.Remove(".root"); err != nil {
		t.Fatal(err)
	}
	if err := s.Remove(".rootstreams"); err != nil {
		t.Fatal(err)
	}
	if len(streams.Streams("")) != 1 || readStream(t, s, streamOf("", "AFP_AfpInfo")) != "root info" {
		t.Error("deleting a file took the root's streams")
	}
}

// A rename over a file leaves the new file with the streams it brought, and
// none of the file it replaced.
func TestRenameOverAFileDropsItsStreams(t *testing.T) {
	tests := []struct {
		name       string
		srcStreams map[string]string
		want       map[string]string
	}{
		{"source has none", nil, map[string]string{}},
		{"source has its own", map[string]string{"Zone.Identifier": "new zone"}, map[string]string{"Zone.Identifier": "new zone"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, root := versionShare(t)
			streams := s.(smbserver.StreamShare)
			os.WriteFile(filepath.Join(root, "new.txt"), []byte("new"), 0644)
			os.WriteFile(filepath.Join(root, "old.txt"), []byte("old"), 0644)
			writeStream(t, s, streamOf("old.txt", "AFP_Resource"), "old fork")
			writeStream(t, s, streamOf("old.txt", "Zone.Identifier"), "old zone")
			for name, content := range tt.srcStreams {
				writeStream(t, s, streamOf("new.txt", name), content)
			}

			if err := s.Rename("new.txt", "old.txt"); err != nil {
				t.Fatal(err)
			}
			got := map[string]string{}
			for _, e := range streams.Streams("old.txt") {
				got[e.Name] = readStream(t, s, streamOf("old.txt", e.Name))
			}
			if len(got) != len(tt.want) {
				t.Fatalf("streams after the rename %v, want %v", got, tt.want)
			}
			for name, content := range tt.want {
				if got[name] != content {
					t.Errorf("%s = %q, want %q", name, got[name], content)
				}
			}
		})
	}
}
