package aroz

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/storage/smbserver"
)

func versionShare(t *testing.T) (smbserver.Share, string) {
	t.Helper()
	fsh, root := drive(t, "media", "public")
	v := loginAs(t, "alice", &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"media": "rw"}}, nil)
	return onlyShare(t, v), root
}

func TestVersionsFromLocalver(t *testing.T) {
	s, root := versionShare(t)
	docs := filepath.Join(root, "docs")
	os.MkdirAll(filepath.Join(docs, ".metadata/.localver/2026-11-08_10-00-00"), 0755)
	os.MkdirAll(filepath.Join(docs, ".metadata/.localver/2026-11-07_09-30-15"), 0755)
	os.WriteFile(filepath.Join(docs, "report.docx"), []byte("now"), 0644)
	os.WriteFile(filepath.Join(docs, ".metadata/.localver/2026-11-08_10-00-00/report.docx"), []byte("v2"), 0644)
	os.WriteFile(filepath.Join(docs, ".metadata/.localver/2026-11-07_09-30-15/other.txt"), []byte("o"), 0644)
	os.MkdirAll(filepath.Join(docs, ".metadata/.localver/not-a-time"), 0755)

	ss := s.(smbserver.SnapshotShare)
	want := time.Date(2026, 11, 8, 10, 0, 0, 0, time.Local)
	got := ss.Snapshots("docs/report.docx")
	if len(got) != 1 || !got[0].Equal(want) {
		t.Fatalf("file versions %v", got)
	}
	if folder := ss.Snapshots("docs"); len(folder) != 2 {
		t.Errorf("folder versions %v", folder)
	}
	if none := ss.Snapshots("docs/unversioned.txt"); len(none) != 0 {
		t.Errorf("versions of a file without any: %v", none)
	}

	p, ok := ss.SnapshotPath("docs/report.docx", want.UTC())
	if !ok || p != "docs/.metadata/.localver/2026-11-08_10-00-00/report.docx" {
		t.Errorf("path %q, %v", p, ok)
	}
	if _, ok := ss.SnapshotPath("docs/report.docx", want.Add(time.Second)); ok {
		t.Error("a time with no version must not match")
	}
	if p, ok := ss.SnapshotPath("docs", want); !ok || p != "docs/.metadata/.localver/2026-11-08_10-00-00" {
		t.Errorf("folder path %q, %v", p, ok)
	}

	//The file is gone, its versions are not
	os.Remove(filepath.Join(docs, "report.docx"))
	if _, ok := ss.SnapshotPath("docs/report.docx", want); !ok {
		t.Error("a deleted file's version must still open")
	}
}

func TestVersionTime(t *testing.T) {
	if _, ok := versionTime("2026-11-08_10-00-00"); !ok {
		t.Error("a snapshot folder name must parse")
	}
	for _, bad := range []string{"", "2026-11-08", "latest", "2026-13-40_99-00-00"} {
		if _, ok := versionTime(bad); ok {
			t.Errorf("%q parsed", bad)
		}
	}
}
