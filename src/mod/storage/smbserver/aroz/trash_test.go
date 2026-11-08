package aroz

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/storage/smbserver"
)

// fakeBin stands in for the File Manager's trash bin.
type fakeBin struct {
	on    bool
	err   error
	calls []string
}

func (b *fakeBin) move(fsh *filesystem.FileSystemHandler, subpath, rpath, username string) error {
	b.calls = append(b.calls, subpath)
	if b.err != nil {
		return b.err
	}
	target := filepath.Join(filepath.Dir(rpath), ".trash-"+filepath.Base(rpath))
	return os.Rename(rpath, target)
}

func trashShare(t *testing.T, bin *fakeBin) (smbserver.Share, string) {
	t.Helper()
	fsh, root := drive(t, "media", "public")
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"media": "rw"}}
	b, err := New(Options{
		Credentials: noCredentials{},
		LookupUser:  func(string) (Account, Quota, error) { return account, nil, nil },
		UseTrash:    func() bool { return bin.on },
		Trash:       bin.move,
	})
	if err != nil {
		t.Fatal(err)
	}
	v, err := b.Login("alice")
	if err != nil {
		t.Fatal(err)
	}
	return onlyShare(t, v), root
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func TestDeletesGoToTheTrash(t *testing.T) {
	bin := &fakeBin{on: true}
	s, root := trashShare(t, bin)
	os.MkdirAll(filepath.Join(root, "docs"), 0755)
	os.WriteFile(filepath.Join(root, "docs", "report.docx"), []byte("x"), 0644)

	if err := s.Remove("docs/report.docx"); err != nil {
		t.Fatal(err)
	}
	if len(bin.calls) != 1 || bin.calls[0] != "/docs/report.docx" {
		t.Errorf("trash got %v", bin.calls)
	}
	if !exists(filepath.Join(root, "docs", ".trash-report.docx")) {
		t.Error("the file must be in the bin, not gone")
	}
	//Explorer then removes the emptied folder, which is not trashed
	os.Remove(filepath.Join(root, "docs", ".trash-report.docx"))
	if err := s.Remove("docs"); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(root, "docs")) || len(bin.calls) != 1 {
		t.Errorf("folder: calls %v", bin.calls)
	}
}

func TestScratchFilesSkipTheTrash(t *testing.T) {
	bin := &fakeBin{on: true}
	s, root := trashShare(t, bin)
	for _, name := range []string{"~$report.docx", "~WRL0005.tmp", "._photo.jpg", "Thumbs.db", ".~lock.sheet.ods#"} {
		os.WriteFile(filepath.Join(root, name), nil, 0644)
		if err := s.Remove(name); err != nil {
			t.Fatal(err)
		}
		if exists(filepath.Join(root, name)) {
			t.Errorf("%s was not deleted", name)
		}
	}
	if len(bin.calls) != 0 {
		t.Errorf("trash got %v", bin.calls)
	}
}

func TestFullTrashDeletesForGood(t *testing.T) {
	bin := &fakeBin{on: true, err: ErrTrashFull}
	s, root := trashShare(t, bin)
	os.WriteFile(filepath.Join(root, "a.txt"), nil, 0644)
	if err := s.Remove("a.txt"); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(root, "a.txt")) {
		t.Error("a full bin must not stop the delete")
	}
}

func TestTrashFailureKeepsTheFile(t *testing.T) {
	bin := &fakeBin{on: true, err: errors.New("rename failed")}
	s, root := trashShare(t, bin)
	os.WriteFile(filepath.Join(root, "a.txt"), nil, 0644)
	if err := s.Remove("a.txt"); err == nil {
		t.Error("the error must reach the client")
	}
	if !exists(filepath.Join(root, "a.txt")) {
		t.Error("a file that could not be trashed must stay")
	}
}

func TestTrashOffDeletes(t *testing.T) {
	bin := &fakeBin{on: false}
	s, root := trashShare(t, bin)
	os.WriteFile(filepath.Join(root, "a.txt"), nil, 0644)
	s.Remove("a.txt")
	if exists(filepath.Join(root, "a.txt")) || len(bin.calls) != 0 {
		t.Errorf("calls %v", bin.calls)
	}
}

func TestIsScratchFile(t *testing.T) {
	cases := map[string]bool{
		"report.docx": false, "~$report.docx": true, "Budget.TMP": true, "._x": true,
		".DS_Store": true, "desktop.ini": true, "notes.txt": false, "photo.part": true,
		"~WRD0000.tmp": true, "archive.tar": false,
	}
	for name, want := range cases {
		if got := isScratchFile(name); got != want {
			t.Errorf("isScratchFile(%q) = %v", name, got)
		}
	}
}
