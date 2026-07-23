package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormaliseIgnorePatterns(t *testing.T) {
	tests := []struct {
		name      string
		patterns  []string
		want      []string
		wantError bool
	}{
		{name: "plain rule", patterns: []string{"/src/main.go"}, want: []string{"/src/main.go"}},
		{name: "extension glob", patterns: []string{"*.go"}, want: []string{"*.go"}},
		{name: "folder rule", patterns: []string{"/src/mod/agi"}, want: []string{"/src/mod/agi"}},
		{name: "surrounding spaces trimmed", patterns: []string{"  *.log  "}, want: []string{"*.log"}},
		{name: "backslashes converted", patterns: []string{"src\\mod\\agi"}, want: []string{"src/mod/agi"}},
		{name: "leading dot slash dropped", patterns: []string{"./build"}, want: []string{"build"}},
		{name: "blank entries skipped", patterns: []string{"", "   ", "*.tmp"}, want: []string{"*.tmp"}},
		{name: "duplicates collapsed", patterns: []string{"*.go", "*.go", " *.go "}, want: []string{"*.go"}},
		{name: "several rules keep order", patterns: []string{"a", "b", "c"}, want: []string{"a", "b", "c"}},
		{name: "nothing usable", patterns: []string{"", "  "}, wantError: true},
		{name: "empty input", patterns: []string{}, wantError: true},
		{name: "line break rejected", patterns: []string{"a\nb"}, wantError: true},
		{name: "carriage return rejected", patterns: []string{"a\rb"}, wantError: true},
		{name: "comment rejected", patterns: []string{"# not a rule"}, wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := normaliseIgnorePatterns(test.patterns)
			if test.wantError {
				if err == nil {
					t.Fatalf("normaliseIgnorePatterns(%v) = %v, want an error", test.patterns, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("normaliseIgnorePatterns(%v) returned error: %v", test.patterns, err)
			}
			if strings.Join(got, "|") != strings.Join(test.want, "|") {
				t.Errorf("normaliseIgnorePatterns(%v) = %v, want %v", test.patterns, got, test.want)
			}
		})
	}
}

func TestExistingIgnoreRules(t *testing.T) {
	content := "# a comment\n\n*.log\n  /build  \n#*.commented\nnode_modules\n"
	rules := existingIgnoreRules(content)

	for _, want := range []string{"*.log", "/build", "node_modules"} {
		if _, found := rules[want]; !found {
			t.Errorf("existingIgnoreRules() is missing %q", want)
		}
	}
	if _, found := rules["#*.commented"]; found {
		t.Errorf("existingIgnoreRules() treated a comment as a rule")
	}
	if _, found := rules["*.commented"]; found {
		t.Errorf("existingIgnoreRules() read a rule out of a comment")
	}
	if len(rules) != 3 {
		t.Errorf("existingIgnoreRules() = %d rules, want 3", len(rules))
	}
}

func TestAppendIgnoreRules(t *testing.T) {
	tests := []struct {
		name     string
		existing string
		added    []string
		want     string
	}{
		{
			name:     "empty file",
			existing: "",
			added:    []string{"*.log"},
			want:     ignoreHeader + "\n*.log\n",
		},
		{
			name:     "file without a trailing newline",
			existing: "*.tmp",
			added:    []string{"*.log"},
			want:     "*.tmp\n\n" + ignoreHeader + "\n*.log\n",
		},
		{
			name:     "file with a trailing newline",
			existing: "*.tmp\n",
			added:    []string{"*.log"},
			want:     "*.tmp\n\n" + ignoreHeader + "\n*.log\n",
		},
		{
			name:     "file already ending in a blank line",
			existing: "*.tmp\n\n",
			added:    []string{"*.log"},
			want:     "*.tmp\n\n" + ignoreHeader + "\n*.log\n",
		},
		{
			name:     "header is not repeated",
			existing: ignoreHeader + "\n*.tmp\n",
			added:    []string{"*.log"},
			want:     ignoreHeader + "\n*.tmp\n\n*.log\n",
		},
		{
			name:     "several rules",
			existing: "",
			added:    []string{"a", "b"},
			want:     ignoreHeader + "\na\nb\n",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := appendIgnoreRules(test.existing, test.added); got != test.want {
				t.Errorf("appendIgnoreRules() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestAddIgnoreRulesCreatesFile(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	added, err := manager.AddIgnoreRules(repoPath, []string{"*.log", "/build"})
	if err != nil {
		t.Fatalf("AddIgnoreRules() returned error: %v", err)
	}
	if len(added) != 2 {
		t.Fatalf("AddIgnoreRules() added %v, want 2 rules", added)
	}

	content, err := os.ReadFile(filepath.Join(repoPath, gitignoreName))
	if err != nil {
		t.Fatalf("cannot read .gitignore: %v", err)
	}
	for _, want := range []string{"*.log", "/build"} {
		if !strings.Contains(string(content), want) {
			t.Errorf(".gitignore is missing %q, content: %q", want, string(content))
		}
	}
}

func TestAddIgnoreRulesPreservesExistingContent(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	original := "# my own rules\nnode_modules/\n"
	writeFile(t, repoPath, gitignoreName, original)

	if _, err := manager.AddIgnoreRules(repoPath, []string{"*.log"}); err != nil {
		t.Fatalf("AddIgnoreRules() returned error: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(repoPath, gitignoreName))
	if err != nil {
		t.Fatalf("cannot read .gitignore: %v", err)
	}
	if !strings.HasPrefix(string(content), original) {
		t.Errorf("AddIgnoreRules() rewrote the existing content: %q", string(content))
	}
	if !strings.Contains(string(content), "*.log") {
		t.Errorf(".gitignore is missing the new rule: %q", string(content))
	}
}

func TestAddIgnoreRulesSkipsDuplicates(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	if _, err := manager.AddIgnoreRules(repoPath, []string{"*.log"}); err != nil {
		t.Fatalf("first AddIgnoreRules() returned error: %v", err)
	}

	added, err := manager.AddIgnoreRules(repoPath, []string{"*.log", "*.tmp"})
	if err != nil {
		t.Fatalf("second AddIgnoreRules() returned error: %v", err)
	}
	if len(added) != 1 || added[0] != "*.tmp" {
		t.Fatalf("AddIgnoreRules() added %v, want only *.tmp", added)
	}

	content, err := os.ReadFile(filepath.Join(repoPath, gitignoreName))
	if err != nil {
		t.Fatalf("cannot read .gitignore: %v", err)
	}
	if strings.Count(string(content), "*.log") != 1 {
		t.Errorf("*.log appears more than once: %q", string(content))
	}
}

func TestAddIgnoreRulesAllDuplicatesWritesNothing(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	if _, err := manager.AddIgnoreRules(repoPath, []string{"*.log"}); err != nil {
		t.Fatalf("AddIgnoreRules() returned error: %v", err)
	}

	before, err := os.ReadFile(filepath.Join(repoPath, gitignoreName))
	if err != nil {
		t.Fatalf("cannot read .gitignore: %v", err)
	}

	added, err := manager.AddIgnoreRules(repoPath, []string{"*.log"})
	if err != nil {
		t.Fatalf("AddIgnoreRules() returned error: %v", err)
	}
	if len(added) != 0 {
		t.Errorf("AddIgnoreRules() = %v, want nothing added", added)
	}

	after, err := os.ReadFile(filepath.Join(repoPath, gitignoreName))
	if err != nil {
		t.Fatalf("cannot read .gitignore: %v", err)
	}
	if string(before) != string(after) {
		t.Errorf("AddIgnoreRules() rewrote the file with nothing to add")
	}
}

// TestAddIgnoreRulesFromSubfolder checks the rules land at the working tree
// root, not next to whichever path inside the repository was passed in.
func TestAddIgnoreRulesFromSubfolder(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	nested := filepath.Join(repoPath, "src", "mod")
	if err := os.MkdirAll(nested, 0775); err != nil {
		t.Fatalf("cannot create the nested folder: %v", err)
	}

	if _, err := manager.AddIgnoreRules(nested, []string{"*.log"}); err != nil {
		t.Fatalf("AddIgnoreRules() returned error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(repoPath, gitignoreName)); err != nil {
		t.Errorf(".gitignore was not written at the repository root: %v", err)
	}
	if _, err := os.Stat(filepath.Join(nested, gitignoreName)); !os.IsNotExist(err) {
		t.Errorf(".gitignore was written into the subfolder as well")
	}
}

func TestAddIgnoreRulesValidation(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)

	tests := []struct {
		name     string
		path     string
		patterns []string
	}{
		{name: "not a repository", path: t.TempDir(), patterns: []string{"*.log"}},
		{name: "no usable rule", path: repoPath, patterns: []string{"", "  "}},
		{name: "rule with a line break", path: repoPath, patterns: []string{"a\nb"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := manager.AddIgnoreRules(test.path, test.patterns); err == nil {
				t.Errorf("AddIgnoreRules() with %s = nil error, want an error", test.name)
			}
		})
	}
}

// TestAddIgnoreRulesActuallyHidesTheFile is the end-to-end check: once a rule is
// written, the ignored file must disappear from the changes list.
func TestAddIgnoreRulesActuallyHidesTheFile(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "keep.txt", "one\n", "first")

	writeFile(t, repoPath, "debug.log", "noise\n")

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}
	if findChangeByPath(status, "debug.log") == nil {
		t.Fatalf("the untracked file is missing from the changes list before ignoring it")
	}

	if _, err := manager.AddIgnoreRules(repoPath, []string{"*.log"}); err != nil {
		t.Fatalf("AddIgnoreRules() returned error: %v", err)
	}

	status, err = manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}
	if findChangeByPath(status, "debug.log") != nil {
		t.Errorf("debug.log is still listed after being ignored")
	}
	//The .gitignore itself is a real change the user will want to commit
	if findChangeByPath(status, gitignoreName) == nil {
		t.Errorf(".gitignore is not listed as a new file")
	}
}

func findChangeByPath(status *RepoStatus, path string) *FileChange {
	for index, change := range status.Changes {
		if change.Path == path {
			return &status.Changes[index]
		}
	}
	return nil
}
