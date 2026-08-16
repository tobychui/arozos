package git

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCleanRepoPath(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		want      string
		wantError bool
	}{
		{name: "plain file", input: "main.go", want: "main.go"},
		{name: "nested file", input: "src/mod/git/main.go", want: "src/mod/git/main.go"},
		{name: "leading dot slash", input: "./main.go", want: "main.go"},
		{name: "backslash separators", input: "src\\mod\\main.go", want: "src/mod/main.go"},
		{name: "surrounding spaces", input: "  main.go  ", want: "main.go"},
		{name: "redundant segments", input: "src/./mod/../mod/main.go", want: "src/mod/main.go"},
		{name: "empty string", input: "", wantError: true},
		{name: "current folder", input: ".", wantError: true},
		{name: "parent escape", input: "../secret.txt", wantError: true},
		{name: "nested parent escape", input: "src/../../secret.txt", wantError: true},
		{name: "absolute unix path", input: "/absolute/secret.txt", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := cleanRepoPath(test.input)
			if test.wantError {
				if err == nil {
					t.Fatalf("cleanRepoPath(%q) = %q, want an error", test.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("cleanRepoPath(%q) returned error: %v", test.input, err)
			}
			if got != test.want {
				t.Errorf("cleanRepoPath(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestCommitRequiresMessage(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	writeFile(t, repoPath, "a.txt", "content\n")

	tests := []struct {
		name    string
		request *CommitRequest
	}{
		{name: "nil request", request: nil},
		{name: "empty message", request: &CommitRequest{Message: "", Files: []string{"a.txt"}}},
		{name: "whitespace message", request: &CommitRequest{Message: "   ", Files: []string{"a.txt"}}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := manager.Commit(repoPath, test.request); err == nil {
				t.Errorf("Commit() with %s = nil error, want an error", test.name)
			}
		})
	}
}

func TestCommitOnlySelectedFiles(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	writeFile(t, repoPath, "included.txt", "in\n")
	writeFile(t, repoPath, "excluded.txt", "out\n")

	if _, err := manager.Commit(repoPath, &CommitRequest{
		Message: "add only the selected file",
		Files:   []string{"included.txt"},
		Name:    "Test User",
		Email:   "test@arozos.local",
	}); err != nil {
		t.Fatalf("Commit() returned error: %v", err)
	}

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}

	if len(status.Changes) != 1 || status.Changes[0].Path != "excluded.txt" {
		t.Errorf("Changes after selective commit = %+v, want only excluded.txt", status.Changes)
	}
}

func TestCommitEmptySelectionFails(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	//Nothing changed since the last commit
	if _, err := manager.Commit(repoPath, &CommitRequest{
		Message: "empty",
		Name:    "Test User",
		Email:   "test@arozos.local",
	}); err == nil {
		t.Errorf("Commit() with no changes = nil error, want an error")
	}
}

func TestCommitRejectsEscapingPath(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	if _, err := manager.Commit(repoPath, &CommitRequest{
		Message: "escape attempt",
		Files:   []string{"../outside.txt"},
		Name:    "Test User",
		Email:   "test@arozos.local",
	}); err == nil {
		t.Errorf("Commit() with an escaping path = nil error, want an error")
	}
}

func TestAddAllStagesEverything(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	writeFile(t, repoPath, "a.txt", "a\n")
	writeFile(t, repoPath, "nested/b.txt", "b\n")

	if err := manager.AddAll(repoPath); err != nil {
		t.Fatalf("AddAll() returned error: %v", err)
	}

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}
	if len(status.Changes) != 2 {
		t.Fatalf("Changes = %d entries, want 2", len(status.Changes))
	}
	for _, change := range status.Changes {
		if !change.Staged {
			t.Errorf("%s Staged = false after AddAll(), want true", change.Path)
		}
	}
}

func TestUnstageRemovesFromIndexOnly(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	writeFile(t, repoPath, "a.txt", "one changed\n")
	if err := manager.Add(repoPath, []string{"a.txt"}); err != nil {
		t.Fatalf("Add() returned error: %v", err)
	}

	if err := manager.Unstage(repoPath, []string{"a.txt"}); err != nil {
		t.Fatalf("Unstage() returned error: %v", err)
	}

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}
	if len(status.Changes) != 1 {
		t.Fatalf("Changes = %d entries, want 1", len(status.Changes))
	}
	if status.Changes[0].Staged {
		t.Errorf("Staged = true after Unstage(), want false")
	}

	//The working tree edit must survive
	content, err := os.ReadFile(filepath.Join(repoPath, "a.txt"))
	if err != nil {
		t.Fatalf("cannot read file: %v", err)
	}
	if string(content) != "one changed\n" {
		t.Errorf("file content = %q, want the working tree edit to be preserved", string(content))
	}
}

func TestUnstageWithNoFilesFails(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	if err := manager.Unstage(repoPath, []string{}); err == nil {
		t.Errorf("Unstage() with no files = nil error, want an error")
	}
}

func TestDiscardRestoresTrackedFile(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "original\n", "first")

	writeFile(t, repoPath, "a.txt", "vandalised\n")
	if err := manager.Discard(repoPath, []string{"a.txt"}); err != nil {
		t.Fatalf("Discard() returned error: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(repoPath, "a.txt"))
	if err != nil {
		t.Fatalf("cannot read file: %v", err)
	}
	if string(content) != "original\n" {
		t.Errorf("file content = %q, want %q", string(content), "original\n")
	}
}

func TestDiscardDeletesUntrackedFile(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "tracked.txt", "keep\n", "first")

	writeFile(t, repoPath, "junk.txt", "delete me\n")
	if err := manager.Discard(repoPath, []string{"junk.txt"}); err != nil {
		t.Fatalf("Discard() returned error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(repoPath, "junk.txt")); !os.IsNotExist(err) {
		t.Errorf("untracked file still exists after Discard(), want it removed")
	}
}

func TestSanitiseLocalEmail(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "simple name", input: "toby", want: "toby@arozos.local"},
		{name: "mixed case", input: "Toby Chui", want: "tobychui@arozos.local"},
		{name: "punctuation stripped", input: "a.b-c_d!", want: "a.b-c_d@arozos.local"},
		{name: "non ascii only", input: "中文", want: "user@arozos.local"},
		{name: "empty", input: "", want: "user@arozos.local"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := sanitiseLocalEmail(test.input); got != test.want {
				t.Errorf("sanitiseLocalEmail(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestCommitFallsBackToRepositoryConfigIdentity(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	repo, err := manager.open(repoPath)
	if err != nil {
		t.Fatalf("open() returned error: %v", err)
	}
	cfg, err := repo.Config()
	if err != nil {
		t.Fatalf("Config() returned error: %v", err)
	}
	cfg.User.Name = "Config User"
	cfg.User.Email = "config@example.com"
	if err := repo.SetConfig(cfg); err != nil {
		t.Fatalf("SetConfig() returned error: %v", err)
	}

	writeFile(t, repoPath, "a.txt", "content\n")
	if _, err := manager.Commit(repoPath, &CommitRequest{
		Message: "identity from config",
		Files:   []string{"a.txt"},
	}); err != nil {
		t.Fatalf("Commit() returned error: %v", err)
	}

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}
	if status.Head.AuthorName != "Config User" {
		t.Errorf("AuthorName = %q, want %q", status.Head.AuthorName, "Config User")
	}
	if status.Head.AuthorEmail != "config@example.com" {
		t.Errorf("AuthorEmail = %q, want %q", status.Head.AuthorEmail, "config@example.com")
	}
}
