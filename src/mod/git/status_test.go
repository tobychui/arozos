package git

import (
	"os"
	"path/filepath"
	"testing"

	gogit "github.com/go-git/go-git/v5"
)

func TestStatusOnEmptyRepository(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}

	if !status.Clean {
		t.Errorf("Clean = false on a fresh repository, want true")
	}
	if status.Head != nil {
		t.Errorf("Head = %+v on an unborn branch, want nil", status.Head)
	}
	if status.Branch == "" {
		t.Errorf("Branch = \"\" on an unborn branch, want the default branch name")
	}
	if len(status.Changes) != 0 {
		t.Errorf("Changes = %d entries, want 0", len(status.Changes))
	}
}

func TestStatusReportsUntrackedAndStagedFiles(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	writeFile(t, repoPath, "untracked.txt", "hello\n")
	writeFile(t, repoPath, "staged.txt", "world\n")
	if err := manager.Add(repoPath, []string{"staged.txt"}); err != nil {
		t.Fatalf("Add() returned error: %v", err)
	}

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}

	if status.Clean {
		t.Errorf("Clean = true with pending changes, want false")
	}
	if len(status.Changes) != 2 {
		t.Fatalf("Changes = %d entries, want 2 (%+v)", len(status.Changes), status.Changes)
	}

	byPath := map[string]FileChange{}
	for _, change := range status.Changes {
		byPath[change.Path] = change
	}

	if got := byPath["untracked.txt"]; got.Status != "untracked" || got.Staged {
		t.Errorf("untracked.txt = %+v, want status untracked and Staged false", got)
	}
	if got := byPath["staged.txt"]; !got.Staged || got.Status != "added" {
		t.Errorf("staged.txt = %+v, want status added and Staged true", got)
	}
	if got := byPath["staged.txt"]; got.Size != int64(len("world\n")) {
		t.Errorf("staged.txt Size = %d, want %d", got.Size, len("world\n"))
	}
}

func TestStatusAfterCommitIsClean(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	hash := commitFile(t, manager, repoPath, "readme.md", "# demo\n", "initial commit")

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}

	if !status.Clean {
		t.Errorf("Clean = false right after a commit, want true (%+v)", status.Changes)
	}
	if status.Head == nil {
		t.Fatalf("Head = nil after a commit, want the new commit")
	}
	if status.Head.Hash != hash {
		t.Errorf("Head.Hash = %q, want %q", status.Head.Hash, hash)
	}
	if status.Head.Subject != "initial commit" {
		t.Errorf("Head.Subject = %q, want %q", status.Head.Subject, "initial commit")
	}
	if status.Ahead != 1 {
		t.Errorf("Ahead = %d for a never-pushed branch with one commit, want 1", status.Ahead)
	}
}

func TestStatusReportsModifiedAndDeleted(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "keep.txt", "one\n", "add keep")
	commitFile(t, manager, repoPath, "gone.txt", "two\n", "add gone")

	writeFile(t, repoPath, "keep.txt", "one changed\n")
	if err := os.Remove(filepath.Join(repoPath, "gone.txt")); err != nil {
		t.Fatalf("cannot delete file: %v", err)
	}

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}

	byPath := map[string]FileChange{}
	for _, change := range status.Changes {
		byPath[change.Path] = change
	}

	if got := byPath["keep.txt"]; got.Status != "modified" {
		t.Errorf("keep.txt Status = %q, want %q", got.Status, "modified")
	}
	if got := byPath["gone.txt"]; got.Status != "deleted" {
		t.Errorf("gone.txt Status = %q, want %q", got.Status, "deleted")
	}
	if got := byPath["gone.txt"]; got.Size != -1 {
		t.Errorf("gone.txt Size = %d, want -1 for a file that is gone", got.Size)
	}
}

func TestStatusFlagsBinaryFiles(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	if err := os.WriteFile(filepath.Join(repoPath, "blob.bin"), []byte{0x01, 0x00, 0x02}, 0664); err != nil {
		t.Fatalf("cannot write binary file: %v", err)
	}

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}
	if len(status.Changes) != 1 {
		t.Fatalf("Changes = %d entries, want 1", len(status.Changes))
	}
	if !status.Changes[0].Binary {
		t.Errorf("Binary = false for a file containing a NUL byte, want true")
	}
}

func TestStatusCodeToString(t *testing.T) {
	tests := []struct {
		name string
		code gogit.StatusCode
		want string
	}{
		{name: "unmodified", code: gogit.Unmodified, want: "unmodified"},
		{name: "untracked", code: gogit.Untracked, want: "untracked"},
		{name: "modified", code: gogit.Modified, want: "modified"},
		{name: "added", code: gogit.Added, want: "added"},
		{name: "deleted", code: gogit.Deleted, want: "deleted"},
		{name: "renamed", code: gogit.Renamed, want: "renamed"},
		{name: "copied", code: gogit.Copied, want: "copied"},
		{name: "unmerged", code: gogit.UpdatedButUnmerged, want: "conflicted"},
		{name: "unknown code", code: gogit.StatusCode('Z'), want: "unknown"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := statusCodeToString(test.code); got != test.want {
				t.Errorf("statusCodeToString(%q) = %q, want %q", string(test.code), got, test.want)
			}
		})
	}
}

func TestFileLooksBinary(t *testing.T) {
	folder := t.TempDir()

	tests := []struct {
		name    string
		content []byte
		want    bool
	}{
		{name: "plain text", content: []byte("hello world\n"), want: false},
		{name: "empty file", content: []byte{}, want: false},
		{name: "contains NUL", content: []byte("abc\x00def"), want: true},
		{name: "utf8 text", content: []byte("café 中文\n"), want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(folder, test.name)
			if err := os.WriteFile(path, test.content, 0664); err != nil {
				t.Fatalf("cannot write test file: %v", err)
			}
			if got := fileLooksBinary(path); got != test.want {
				t.Errorf("fileLooksBinary(%s) = %v, want %v", test.name, got, test.want)
			}
		})
	}
}
