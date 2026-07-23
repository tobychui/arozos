package git

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInitCreatesRepository(t *testing.T) {
	manager := newTestManager(t)
	repoPath := filepath.Join(t.TempDir(), "newrepo")

	if manager.IsRepo(repoPath) {
		t.Fatalf("IsRepo() = true for a folder that does not exist yet")
	}

	if err := manager.Init(repoPath); err != nil {
		t.Fatalf("Init() returned error: %v", err)
	}

	if !manager.IsRepo(repoPath) {
		t.Errorf("IsRepo() = false right after Init()")
	}

	if _, err := os.Stat(filepath.Join(repoPath, ".git")); err != nil {
		t.Errorf("Init() did not create a .git folder: %v", err)
	}
}

func TestInitRejectsExistingRepository(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	if err := manager.Init(repoPath); err == nil {
		t.Errorf("Init() on an existing repository = nil error, want an error")
	}
}

func TestRepoRoot(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	nested := filepath.Join(repoPath, "a", "b")
	if err := os.MkdirAll(nested, 0775); err != nil {
		t.Fatalf("cannot create nested folder: %v", err)
	}

	tests := []struct {
		name      string
		path      string
		wantRoot  string
		wantError bool
	}{
		{name: "repository root itself", path: repoPath, wantRoot: filepath.ToSlash(repoPath)},
		{name: "nested subfolder", path: nested, wantRoot: filepath.ToSlash(repoPath)},
		{name: "outside any repository", path: t.TempDir(), wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root, err := manager.RepoRoot(test.path)
			if test.wantError {
				if err == nil {
					t.Fatalf("RepoRoot(%s) = %q, want an error", test.path, root)
				}
				return
			}
			if err != nil {
				t.Fatalf("RepoRoot(%s) returned error: %v", test.path, err)
			}

			//Compare resolved absolute paths: macOS temp dirs are symlinked
			wantAbs, _ := filepath.EvalSymlinks(test.wantRoot)
			gotAbs, _ := filepath.EvalSymlinks(root)
			if gotAbs != wantAbs {
				t.Errorf("RepoRoot(%s) = %q, want %q", test.path, gotAbs, wantAbs)
			}
		})
	}
}

func TestIsRepoOnPlainFolder(t *testing.T) {
	manager := newTestManager(t)

	if manager.IsRepo(t.TempDir()) {
		t.Errorf("IsRepo() = true for a plain folder")
	}
}

func TestCloneRejectsBadInput(t *testing.T) {
	manager := newTestManager(t)

	populated := t.TempDir()
	if err := os.WriteFile(filepath.Join(populated, "existing.txt"), []byte("hi"), 0664); err != nil {
		t.Fatalf("cannot seed folder: %v", err)
	}

	tests := []struct {
		name    string
		request *CloneRequest
	}{
		{name: "empty URL", request: &CloneRequest{URL: "", Dest: filepath.Join(t.TempDir(), "x")}},
		{name: "empty destination", request: &CloneRequest{URL: "https://example.com/a.git", Dest: ""}},
		{name: "destination not empty", request: &CloneRequest{URL: "https://example.com/a.git", Dest: populated}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := manager.Clone(test.request); err == nil {
				t.Errorf("Clone(%+v) = nil error, want an error", test.request)
			}
		})
	}
}

func TestRemotesLifecycle(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	remotes, err := manager.Remotes(repoPath)
	if err != nil {
		t.Fatalf("Remotes() returned error: %v", err)
	}
	if len(remotes) != 0 {
		t.Fatalf("Remotes() on a fresh repository = %d entries, want 0", len(remotes))
	}

	if err := manager.AddRemote(repoPath, "origin", "https://example.com/demo.git"); err != nil {
		t.Fatalf("AddRemote() returned error: %v", err)
	}

	remotes, err = manager.Remotes(repoPath)
	if err != nil {
		t.Fatalf("Remotes() returned error: %v", err)
	}
	if len(remotes) != 1 || remotes[0].Name != "origin" {
		t.Fatalf("Remotes() = %+v, want a single origin entry", remotes)
	}
	if remotes[0].URLs[0] != "https://example.com/demo.git" {
		t.Errorf("origin URL = %q, want %q", remotes[0].URLs[0], "https://example.com/demo.git")
	}

	//Re-adding the same name replaces the URL rather than failing
	if err := manager.AddRemote(repoPath, "origin", "https://example.com/other.git"); err != nil {
		t.Fatalf("AddRemote() on an existing name returned error: %v", err)
	}
	remotes, _ = manager.Remotes(repoPath)
	if len(remotes) != 1 || remotes[0].URLs[0] != "https://example.com/other.git" {
		t.Errorf("Remotes() after replace = %+v, want the updated URL", remotes)
	}

	if err := manager.RemoveRemote(repoPath, "origin"); err != nil {
		t.Fatalf("RemoveRemote() returned error: %v", err)
	}
	remotes, _ = manager.Remotes(repoPath)
	if len(remotes) != 0 {
		t.Errorf("Remotes() after remove = %d entries, want 0", len(remotes))
	}
}

func TestOperationsOnNonRepoReturnErrNotARepo(t *testing.T) {
	manager := newTestManager(t)
	plain := t.TempDir()

	if _, err := manager.Status(plain); err != ErrNotARepo {
		t.Errorf("Status() on a plain folder = %v, want ErrNotARepo", err)
	}
	if _, err := manager.Log(plain, 10); err != ErrNotARepo {
		t.Errorf("Log() on a plain folder = %v, want ErrNotARepo", err)
	}
	if _, err := manager.Branches(plain); err != ErrNotARepo {
		t.Errorf("Branches() on a plain folder = %v, want ErrNotARepo", err)
	}
}
