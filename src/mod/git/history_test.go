package git

import (
	"testing"
)

func TestLogReturnsNewestFirst(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	commitFile(t, manager, repoPath, "a.txt", "one\n", "first commit")
	commitFile(t, manager, repoPath, "b.txt", "two\n", "second commit")
	third := commitFile(t, manager, repoPath, "c.txt", "three\n", "third commit")

	commits, err := manager.Log(repoPath, 10)
	if err != nil {
		t.Fatalf("Log() returned error: %v", err)
	}
	if len(commits) != 3 {
		t.Fatalf("Log() = %d commits, want 3", len(commits))
	}
	if commits[0].Hash != third {
		t.Errorf("Log()[0].Hash = %q, want the newest commit %q", commits[0].Hash, third)
	}
	if commits[0].Subject != "third commit" {
		t.Errorf("Log()[0].Subject = %q, want %q", commits[0].Subject, "third commit")
	}
	if len(commits[0].ShortHash) != 7 {
		t.Errorf("ShortHash = %q, want 7 characters", commits[0].ShortHash)
	}
	if commits[0].AuthorName != "Test User" {
		t.Errorf("AuthorName = %q, want %q", commits[0].AuthorName, "Test User")
	}
	if commits[0].Timestamp == 0 {
		t.Errorf("Timestamp = 0, want the author time")
	}
}

func TestLogRespectsLimit(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	for _, name := range []string{"a", "b", "c", "d"} {
		commitFile(t, manager, repoPath, name+".txt", name+"\n", "commit "+name)
	}

	tests := []struct {
		name  string
		limit int
		want  int
	}{
		{name: "limit below total", limit: 2, want: 2},
		{name: "limit above total", limit: 100, want: 4},
		{name: "zero falls back to default", limit: 0, want: 4},
		{name: "negative falls back to default", limit: -5, want: 4},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			commits, err := manager.Log(repoPath, test.limit)
			if err != nil {
				t.Fatalf("Log() returned error: %v", err)
			}
			if len(commits) != test.want {
				t.Errorf("Log(limit=%d) = %d commits, want %d", test.limit, len(commits), test.want)
			}
		})
	}
}

func TestLogOnUnbornBranchIsEmpty(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	commits, err := manager.Log(repoPath, 10)
	if err != nil {
		t.Fatalf("Log() on an unborn branch returned error: %v", err)
	}
	if len(commits) != 0 {
		t.Errorf("Log() = %d commits, want 0", len(commits))
	}
}

func TestBranchesAndCheckout(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	branches, err := manager.Branches(repoPath)
	if err != nil {
		t.Fatalf("Branches() returned error: %v", err)
	}
	if len(branches) != 1 {
		t.Fatalf("Branches() = %d entries, want 1", len(branches))
	}
	if !branches[0].IsCurrent {
		t.Errorf("the only branch is not flagged as current")
	}
	defaultBranch := branches[0].Name

	if err := manager.Checkout(repoPath, "feature", true); err != nil {
		t.Fatalf("Checkout(create) returned error: %v", err)
	}

	branches, err = manager.Branches(repoPath)
	if err != nil {
		t.Fatalf("Branches() returned error: %v", err)
	}
	if len(branches) != 2 {
		t.Fatalf("Branches() after create = %d entries, want 2", len(branches))
	}

	current := ""
	for _, branch := range branches {
		if branch.IsCurrent {
			current = branch.Name
		}
	}
	if current != "feature" {
		t.Errorf("current branch = %q, want %q", current, "feature")
	}

	if err := manager.Checkout(repoPath, defaultBranch, false); err != nil {
		t.Fatalf("Checkout(existing) returned error: %v", err)
	}
}

func TestCheckoutValidation(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	tests := []struct {
		name   string
		branch string
	}{
		{name: "empty name", branch: ""},
		{name: "whitespace only", branch: "   "},
		{name: "space inside", branch: "my branch"},
		{name: "leading dash", branch: "-force"},
		{name: "double dot", branch: "a..b"},
		{name: "reflog syntax", branch: "main@{1}"},
		{name: "caret", branch: "main^"},
		{name: "tilde", branch: "main~1"},
		{name: "colon", branch: "refs:heads"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := manager.Checkout(repoPath, test.branch, true); err == nil {
				t.Errorf("Checkout(%q) = nil error, want an error", test.branch)
			}
		})
	}
}

func TestValidateBranchName(t *testing.T) {
	tests := []struct {
		name      string
		branch    string
		wantError bool
	}{
		{name: "simple", branch: "master"},
		{name: "with slash", branch: "feature/login"},
		{name: "with dash", branch: "fix-123"},
		{name: "with dot", branch: "v3.0.2"},
		{name: "leading dash", branch: "-x", wantError: true},
		{name: "leading slash", branch: "/x", wantError: true},
		{name: "trailing slash", branch: "x/", wantError: true},
		{name: "double dot", branch: "a..b", wantError: true},
		{name: "reflog", branch: "a@{0}", wantError: true},
		{name: "space", branch: "a b", wantError: true},
		{name: "asterisk", branch: "a*", wantError: true},
		{name: "backslash", branch: "a\\b", wantError: true},
		{name: "control character", branch: "a\tb", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateBranchName(test.branch)
			if test.wantError && err == nil {
				t.Errorf("validateBranchName(%q) = nil, want an error", test.branch)
			}
			if !test.wantError && err != nil {
				t.Errorf("validateBranchName(%q) = %v, want nil", test.branch, err)
			}
		})
	}
}

func TestShortLocalName(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "remote branch", input: "origin/master", want: "master"},
		{name: "nested remote branch", input: "origin/feature/login", want: "feature/login"},
		{name: "local branch", input: "master", want: "master"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := shortLocalName(test.input); got != test.want {
				t.Errorf("shortLocalName(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestCommitToInfoSplitsSubject(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "short subject\n\nA longer body explaining why.\n")

	commits, err := manager.Log(repoPath, 1)
	if err != nil {
		t.Fatalf("Log() returned error: %v", err)
	}
	if len(commits) != 1 {
		t.Fatalf("Log() = %d commits, want 1", len(commits))
	}

	if commits[0].Subject != "short subject" {
		t.Errorf("Subject = %q, want %q", commits[0].Subject, "short subject")
	}
	if commits[0].Message == commits[0].Subject {
		t.Errorf("Message should keep the full body, got %q", commits[0].Message)
	}
}
