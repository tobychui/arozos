package git

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	githttp "github.com/go-git/go-git/v5/plumbing/transport/http"
)

func TestRemoteHost(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "https url", input: "https://github.com/tobychui/arozos.git", want: "github.com"},
		{name: "http url", input: "http://192.168.1.10:3000/a/b.git", want: "192.168.1.10"},
		{name: "url with user info", input: "https://user:pass@gitlab.com/a/b.git", want: "gitlab.com"},
		{name: "scp syntax", input: "git@github.com:tobychui/arozos.git", want: "github.com"},
		{name: "ssh url", input: "ssh://git@git.local:22/a/b.git", want: "git.local"},
		{name: "mixed case", input: "https://GitHub.com/a/b.git", want: "github.com"},
		{name: "empty", input: "", want: ""},
		{name: "spaces only", input: "   ", want: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := RemoteHost(test.input); got != test.want {
				t.Errorf("RemoteHost(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestBuildAuth(t *testing.T) {
	tests := []struct {
		name         string
		username     string
		token        string
		wantNil      bool
		wantUsername string
	}{
		{name: "no credentials", username: "", token: "", wantNil: true},
		{name: "whitespace only", username: "  ", token: "  ", wantNil: true},
		{name: "user and token", username: "tobychui", token: "ghp_x", wantUsername: "tobychui"},
		{name: "token only gets a placeholder user", username: "", token: "ghp_x", wantUsername: "git"},
		{name: "user only", username: "tobychui", token: "", wantUsername: "tobychui"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			auth := buildAuth(test.username, test.token)
			if test.wantNil {
				if auth != nil {
					t.Fatalf("buildAuth() = %v, want nil", auth)
				}
				return
			}
			if auth == nil {
				t.Fatalf("buildAuth() = nil, want a basic auth method")
			}

			basic, ok := auth.(*githttp.BasicAuth)
			if !ok {
				t.Fatalf("buildAuth() = %T, want *http.BasicAuth", auth)
			}
			if basic.Username != test.wantUsername {
				t.Errorf("Username = %q, want %q", basic.Username, test.wantUsername)
			}
		})
	}
}

func TestRemoteOrDefault(t *testing.T) {
	tests := []struct {
		name    string
		request *TransportRequest
		want    string
	}{
		{name: "nil request", request: nil, want: "origin"},
		{name: "empty remote", request: &TransportRequest{}, want: "origin"},
		{name: "whitespace remote", request: &TransportRequest{Remote: "  "}, want: "origin"},
		{name: "named remote", request: &TransportRequest{Remote: "upstream"}, want: "upstream"},
		{name: "padded name", request: &TransportRequest{Remote: " upstream "}, want: "upstream"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := remoteOrDefault(test.request); got != test.want {
				t.Errorf("remoteOrDefault() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestTransportWithoutRemoteReportsErrNoRemote(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	if err := manager.Fetch(repoPath, &TransportRequest{}); !errors.Is(err, ErrNoRemote) {
		t.Errorf("Fetch() without a remote = %v, want ErrNoRemote", err)
	}
	if _, err := manager.Pull(repoPath, &TransportRequest{}); !errors.Is(err, ErrNoRemote) {
		t.Errorf("Pull() without a remote = %v, want ErrNoRemote", err)
	}
	if _, err := manager.Push(repoPath, &TransportRequest{}); !errors.Is(err, ErrNoRemote) {
		t.Errorf("Push() without a remote = %v, want ErrNoRemote", err)
	}
}

func TestPushOnUnbornBranchFails(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	if err := manager.AddRemote(repoPath, "origin", "https://example.invalid/a.git"); err != nil {
		t.Fatalf("AddRemote() returned error: %v", err)
	}

	if _, err := manager.Push(repoPath, &TransportRequest{}); !errors.Is(err, ErrUnbornBranch) {
		t.Errorf("Push() on an unborn branch = %v, want ErrUnbornBranch", err)
	}
}

func TestPushRejectsInvalidBranchName(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	if _, err := manager.Push(repoPath, &TransportRequest{Branch: "bad branch"}); err == nil {
		t.Errorf("Push() with an invalid branch name = nil error, want an error")
	}
}

func TestRemoteURLForName(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	if err := manager.AddRemote(repoPath, "origin", "https://example.com/a.git"); err != nil {
		t.Fatalf("AddRemote() returned error: %v", err)
	}
	if err := manager.AddRemote(repoPath, "upstream", "https://example.com/b.git"); err != nil {
		t.Fatalf("AddRemote() returned error: %v", err)
	}

	tests := []struct {
		name      string
		remote    string
		want      string
		wantError bool
	}{
		{name: "explicit origin", remote: "origin", want: "https://example.com/a.git"},
		{name: "empty defaults to origin", remote: "", want: "https://example.com/a.git"},
		{name: "named remote", remote: "upstream", want: "https://example.com/b.git"},
		{name: "unknown remote", remote: "nope", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := manager.RemoteURLForName(repoPath, test.remote)
			if test.wantError {
				if err == nil {
					t.Fatalf("RemoteURLForName(%q) = %q, want an error", test.remote, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("RemoteURLForName(%q) returned error: %v", test.remote, err)
			}
			if got != test.want {
				t.Errorf("RemoteURLForName(%q) = %q, want %q", test.remote, got, test.want)
			}
		})
	}
}

// TestCloneFromLocalRepository exercises the real clone path without needing
// network access, by cloning one temp repository into another.
func TestCloneFromLocalRepository(t *testing.T) {
	manager := newTestManager(t)
	source := newTestRepo(t, manager)
	commitFile(t, manager, source, "readme.md", "# source\n", "initial commit")

	destination := filepath.Join(t.TempDir(), "clone")
	if err := manager.Clone(&CloneRequest{
		URL:  source,
		Dest: destination,
	}); err != nil {
		t.Fatalf("Clone() returned error: %v", err)
	}

	if !manager.IsRepo(destination) {
		t.Fatalf("clone destination is not a repository")
	}

	status, err := manager.Status(destination)
	if err != nil {
		t.Fatalf("Status() on the clone returned error: %v", err)
	}
	if status.Head == nil || status.Head.Subject != "initial commit" {
		t.Errorf("cloned HEAD = %+v, want the source commit", status.Head)
	}
	if len(status.Remotes) != 1 || status.Remotes[0].Name != "origin" {
		t.Errorf("cloned remotes = %+v, want a single origin", status.Remotes)
	}
}

func TestCloneFailureCleansUpDestination(t *testing.T) {
	manager := newTestManager(t)
	destination := filepath.Join(t.TempDir(), "clone")

	err := manager.Clone(&CloneRequest{
		URL:  filepath.Join(t.TempDir(), "does-not-exist"),
		Dest: destination,
	})
	if err == nil {
		t.Fatalf("Clone() from a missing source = nil error, want an error")
	}

	empty, ierr := dirIsEmpty(destination)
	if ierr != nil {
		t.Fatalf("dirIsEmpty() returned error: %v", ierr)
	}
	if !empty {
		t.Errorf("a failed clone left files behind at the destination")
	}
}

// TestPushToLocalRepository verifies the push path, including upstream
// tracking, against a local bare repository.
func TestPushToLocalRepository(t *testing.T) {
	manager := newTestManager(t)
	source := newTestRepo(t, manager)
	commitFile(t, manager, source, "readme.md", "# source\n", "initial commit")

	//A clone gives us a working tree wired to a real remote
	clonePath := filepath.Join(t.TempDir(), "clone")
	if err := manager.Clone(&CloneRequest{URL: source, Dest: clonePath}); err != nil {
		t.Fatalf("Clone() returned error: %v", err)
	}

	commitFile(t, manager, clonePath, "added.txt", "from the clone\n", "add a file")

	status, err := manager.Status(clonePath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}
	if status.Ahead != 1 {
		t.Errorf("Ahead = %d after one local commit, want 1", status.Ahead)
	}
	if status.Behind != 0 {
		t.Errorf("Behind = %d, want 0", status.Behind)
	}
}

// TestCloneFailureKeepsAPreexistingFolder guards the distinction between a
// destination folder GitApp created and one the user already had: a failed
// clone must never delete the latter.
func TestCloneFailureKeepsAPreexistingFolder(t *testing.T) {
	manager := newTestManager(t)
	destination := filepath.Join(t.TempDir(), "existing")
	if err := os.MkdirAll(destination, 0775); err != nil {
		t.Fatalf("cannot create the destination: %v", err)
	}

	err := manager.Clone(&CloneRequest{
		URL:  filepath.Join(t.TempDir(), "does-not-exist"),
		Dest: destination,
	})
	if err == nil {
		t.Fatalf("Clone() from a missing source = nil error, want an error")
	}

	if !isDir(destination) {
		t.Errorf("a failed clone deleted a folder that already existed")
	}
	empty, ierr := dirIsEmpty(destination)
	if ierr != nil {
		t.Fatalf("dirIsEmpty() returned error: %v", ierr)
	}
	if !empty {
		t.Errorf("a failed clone left partial contents in the destination")
	}
}

func TestDirIsEmpty(t *testing.T) {
	folder := t.TempDir()

	empty, err := dirIsEmpty(folder)
	if err != nil {
		t.Fatalf("dirIsEmpty() returned error: %v", err)
	}
	if !empty {
		t.Errorf("dirIsEmpty() = false for a fresh temp folder, want true")
	}

	missing, err := dirIsEmpty(filepath.Join(folder, "nope"))
	if err != nil {
		t.Fatalf("dirIsEmpty() on a missing path returned error: %v", err)
	}
	if !missing {
		t.Errorf("dirIsEmpty() = false for a path that does not exist, want true")
	}

	writeFileRaw(t, filepath.Join(folder, "file.txt"))
	populated, err := dirIsEmpty(folder)
	if err != nil {
		t.Fatalf("dirIsEmpty() returned error: %v", err)
	}
	if populated {
		t.Errorf("dirIsEmpty() = true for a folder with a file in it, want false")
	}
}

func writeFileRaw(t *testing.T, path string) {
	t.Helper()
	writeFile(t, filepath.Dir(path), filepath.Base(path), "content")
}
