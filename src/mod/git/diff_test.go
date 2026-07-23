package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSplitLines(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{name: "empty string", input: "", want: []string{}},
		{name: "single line no newline", input: "abc", want: []string{"abc"}},
		{name: "single line trailing newline", input: "abc\n", want: []string{"abc"}},
		{name: "two lines", input: "a\nb\n", want: []string{"a", "b"}},
		{name: "blank line preserved", input: "a\n\nb\n", want: []string{"a", "", "b"}},
		{name: "crlf normalised", input: "a\r\nb\r\n", want: []string{"a", "b"}},
		{name: "only newline", input: "\n", want: []string{""}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := splitLines(test.input)
			if len(got) != len(test.want) {
				t.Fatalf("splitLines(%q) = %q, want %q", test.input, got, test.want)
			}
			for i := range got {
				if got[i] != test.want[i] {
					t.Errorf("splitLines(%q)[%d] = %q, want %q", test.input, i, got[i], test.want[i])
				}
			}
		})
	}
}

func TestDiffLines(t *testing.T) {
	tests := []struct {
		name    string
		oldText []string
		newText []string
		want    []string //"kind:text" pairs, in order
	}{
		{
			name:    "identical",
			oldText: []string{"a", "b"},
			newText: []string{"a", "b"},
			want:    []string{"context:a", "context:b"},
		},
		{
			name:    "append a line",
			oldText: []string{"a"},
			newText: []string{"a", "b"},
			want:    []string{"context:a", "add:b"},
		},
		{
			name:    "delete a line",
			oldText: []string{"a", "b"},
			newText: []string{"a"},
			want:    []string{"context:a", "del:b"},
		},
		{
			name:    "replace middle line",
			oldText: []string{"a", "b", "c"},
			newText: []string{"a", "x", "c"},
			want:    []string{"context:a", "del:b", "add:x", "context:c"},
		},
		{
			name:    "from empty",
			oldText: []string{},
			newText: []string{"a", "b"},
			want:    []string{"add:a", "add:b"},
		},
		{
			name:    "to empty",
			oldText: []string{"a", "b"},
			newText: []string{},
			want:    []string{"del:a", "del:b"},
		},
		{
			name:    "both empty",
			oldText: []string{},
			newText: []string{},
			want:    []string{},
		},
		{
			name:    "insert at start",
			oldText: []string{"b"},
			newText: []string{"a", "b"},
			want:    []string{"add:a", "context:b"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			operations := diffLines(test.oldText, test.newText)
			got := []string{}
			for _, operation := range operations {
				got = append(got, operation.kind+":"+operation.text)
			}
			if strings.Join(got, "|") != strings.Join(test.want, "|") {
				t.Errorf("diffLines() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestDiffLinesLargeRegionFallsBackToReplace(t *testing.T) {
	oldText := make([]string, maxLCSRegion+10)
	newText := make([]string, maxLCSRegion+10)
	for i := range oldText {
		oldText[i] = "old line"
		newText[i] = "new line"
	}

	operations := diffLines(oldText, newText)

	deletions, additions := 0, 0
	for _, operation := range operations {
		switch operation.kind {
		case "del":
			deletions++
		case "add":
			additions++
		}
	}

	if deletions != len(oldText) || additions != len(newText) {
		t.Errorf("large region diff = %d deletions / %d additions, want %d / %d",
			deletions, additions, len(oldText), len(newText))
	}
}

func TestBuildHunksLineNumbering(t *testing.T) {
	operations := []diffOp{
		{kind: "context", text: "a"},
		{kind: "del", text: "b"},
		{kind: "add", text: "B"},
		{kind: "context", text: "c"},
	}

	hunks := buildHunks(operations)
	if len(hunks) != 1 {
		t.Fatalf("buildHunks() = %d hunks, want 1", len(hunks))
	}

	hunk := hunks[0]
	if hunk.OldStart != 1 || hunk.NewStart != 1 {
		t.Errorf("hunk start = -%d +%d, want -1 +1", hunk.OldStart, hunk.NewStart)
	}
	if hunk.OldLines != 3 || hunk.NewLines != 3 {
		t.Errorf("hunk length = -%d +%d, want -3 +3", hunk.OldLines, hunk.NewLines)
	}
	if !strings.HasPrefix(hunk.Header, "@@ -1,3 +1,3 @@") {
		t.Errorf("hunk Header = %q, want it to start with %q", hunk.Header, "@@ -1,3 +1,3 @@")
	}

	wantLines := []DiffLine{
		{Type: "context", OldLine: 1, NewLine: 1, Content: "a"},
		{Type: "del", OldLine: 2, NewLine: 0, Content: "b"},
		{Type: "add", OldLine: 0, NewLine: 2, Content: "B"},
		{Type: "context", OldLine: 3, NewLine: 3, Content: "c"},
	}
	if len(hunk.Lines) != len(wantLines) {
		t.Fatalf("hunk has %d lines, want %d", len(hunk.Lines), len(wantLines))
	}
	for i, want := range wantLines {
		got := hunk.Lines[i]
		if got != want {
			t.Errorf("line %d = %+v, want %+v", i, got, want)
		}
	}
}

func TestBuildHunksNoChangesProducesNoHunks(t *testing.T) {
	operations := []diffOp{
		{kind: "context", text: "a"},
		{kind: "context", text: "b"},
	}
	if hunks := buildHunks(operations); len(hunks) != 0 {
		t.Errorf("buildHunks() with no changes = %d hunks, want 0", len(hunks))
	}
}

func TestBuildHunksSplitsDistantChanges(t *testing.T) {
	operations := []diffOp{{kind: "add", text: "start"}}
	for i := 0; i < 20; i++ {
		operations = append(operations, diffOp{kind: "context", text: "filler"})
	}
	operations = append(operations, diffOp{kind: "add", text: "end"})

	hunks := buildHunks(operations)
	if len(hunks) != 2 {
		t.Errorf("buildHunks() with two distant changes = %d hunks, want 2", len(hunks))
	}
}

func TestIsBinaryContent(t *testing.T) {
	//A NUL past the 8000 byte probe window is deliberately not detected, which
	//is the same trade-off git itself makes.
	lateNul := append([]byte(strings.Repeat("a", 8000)), 0x00)

	tests := []struct {
		name    string
		content []byte
		want    bool
	}{
		{name: "text", content: []byte("hello"), want: false},
		{name: "empty", content: []byte{}, want: false},
		{name: "nul at start", content: []byte{0x00, 'a'}, want: true},
		{name: "nul in the middle", content: []byte("abc\x00def"), want: true},
		{name: "nul beyond the probe window", content: lateNul, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isBinaryContent(test.content); got != test.want {
				t.Errorf("isBinaryContent(%s) = %v, want %v", test.name, got, test.want)
			}
		})
	}
}

func TestBuildFileDiffFlags(t *testing.T) {
	tests := []struct {
		name          string
		oldContent    []byte
		newContent    []byte
		oldExists     bool
		newExists     bool
		wantNew       bool
		wantDeleted   bool
		wantBinary    bool
		wantAdditions int
		wantDeletions int
	}{
		{
			name:          "new file",
			oldContent:    []byte{},
			newContent:    []byte("a\nb\n"),
			oldExists:     false,
			newExists:     true,
			wantNew:       true,
			wantAdditions: 2,
		},
		{
			name:          "deleted file",
			oldContent:    []byte("a\n"),
			newContent:    []byte{},
			oldExists:     true,
			newExists:     false,
			wantDeleted:   true,
			wantDeletions: 1,
		},
		{
			name:       "binary file",
			oldContent: []byte{0x00, 0x01},
			newContent: []byte{0x00, 0x02},
			oldExists:  true,
			newExists:  true,
			wantBinary: true,
		},
		{
			name:          "one line changed",
			oldContent:    []byte("a\nb\nc\n"),
			newContent:    []byte("a\nB\nc\n"),
			oldExists:     true,
			newExists:     true,
			wantAdditions: 1,
			wantDeletions: 1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			diff := buildFileDiff("file.txt", test.oldContent, test.newContent, test.oldExists, test.newExists)

			if diff.IsNew != test.wantNew {
				t.Errorf("IsNew = %v, want %v", diff.IsNew, test.wantNew)
			}
			if diff.IsDeleted != test.wantDeleted {
				t.Errorf("IsDeleted = %v, want %v", diff.IsDeleted, test.wantDeleted)
			}
			if diff.Binary != test.wantBinary {
				t.Errorf("Binary = %v, want %v", diff.Binary, test.wantBinary)
			}
			if diff.Additions != test.wantAdditions {
				t.Errorf("Additions = %d, want %d", diff.Additions, test.wantAdditions)
			}
			if diff.Deletions != test.wantDeletions {
				t.Errorf("Deletions = %d, want %d", diff.Deletions, test.wantDeletions)
			}
		})
	}
}

func TestBuildFileDiffTooLarge(t *testing.T) {
	diff := buildFileDiff("big.bin", nil, []byte("x"), true, true)
	if !diff.TooLarge {
		t.Errorf("TooLarge = false for an oversized side, want true")
	}
	if len(diff.Hunks) != 0 {
		t.Errorf("Hunks = %d, want 0 for an oversized diff", len(diff.Hunks))
	}
}

func TestDiffAgainstWorkingTree(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\ntwo\nthree\n", "first")

	writeFile(t, repoPath, "a.txt", "one\nTWO\nthree\n")

	diff, err := manager.Diff(repoPath, "a.txt")
	if err != nil {
		t.Fatalf("Diff() returned error: %v", err)
	}

	if diff.Additions != 1 || diff.Deletions != 1 {
		t.Errorf("Diff() = +%d -%d, want +1 -1", diff.Additions, diff.Deletions)
	}
	if diff.IsNew || diff.IsDeleted || diff.Binary {
		t.Errorf("Diff() flags = new:%v deleted:%v binary:%v, want all false",
			diff.IsNew, diff.IsDeleted, diff.Binary)
	}
	if len(diff.Hunks) != 1 {
		t.Fatalf("Diff() = %d hunks, want 1", len(diff.Hunks))
	}
}

func TestDiffNewUntrackedFile(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	writeFile(t, repoPath, "new.txt", "fresh\ncontent\n")

	diff, err := manager.Diff(repoPath, "new.txt")
	if err != nil {
		t.Fatalf("Diff() returned error: %v", err)
	}
	if !diff.IsNew {
		t.Errorf("IsNew = false for an untracked file, want true")
	}
	if diff.Additions != 2 {
		t.Errorf("Additions = %d, want 2", diff.Additions)
	}
}

func TestDiffMissingFileFails(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	if _, err := manager.Diff(repoPath, "nowhere.txt"); err == nil {
		t.Errorf("Diff() on a nonexistent path = nil error, want an error")
	}
}

func TestDiffRejectsEscapingPath(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	if _, err := manager.Diff(repoPath, "../../secret.txt"); err == nil {
		t.Errorf("Diff() with an escaping path = nil error, want an error")
	}
}

func TestDiffCommitAndCommitFiles(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")
	second := commitFile(t, manager, repoPath, "a.txt", "one\ntwo\n", "second")

	files, err := manager.CommitFiles(repoPath, second)
	if err != nil {
		t.Fatalf("CommitFiles() returned error: %v", err)
	}
	if len(files) != 1 || files[0].Path != "a.txt" || files[0].Status != "modified" {
		t.Fatalf("CommitFiles() = %+v, want a single modified a.txt", files)
	}

	diff, err := manager.DiffCommit(repoPath, second, "a.txt")
	if err != nil {
		t.Fatalf("DiffCommit() returned error: %v", err)
	}
	if diff.Additions != 1 || diff.Deletions != 0 {
		t.Errorf("DiffCommit() = +%d -%d, want +1 -0", diff.Additions, diff.Deletions)
	}
}

func TestCommitFilesOnInitialCommit(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	first := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	files, err := manager.CommitFiles(repoPath, first)
	if err != nil {
		t.Fatalf("CommitFiles() returned error: %v", err)
	}
	if len(files) != 1 || files[0].Status != "added" {
		t.Errorf("CommitFiles() on the initial commit = %+v, want a single added file", files)
	}
}

func TestWorktreeContentHonoursSizeLimit(t *testing.T) {
	folder := t.TempDir()
	bigPath := filepath.Join(folder, "big.txt")

	big := make([]byte, maxDiffBytes+1)
	for i := range big {
		big[i] = 'a'
	}
	if err := os.WriteFile(bigPath, big, 0664); err != nil {
		t.Fatalf("cannot write oversized file: %v", err)
	}

	content, exists, err := worktreeContent(folder, "big.txt")
	if err != nil {
		t.Fatalf("worktreeContent() returned error: %v", err)
	}
	if !exists {
		t.Errorf("exists = false for an oversized file, want true")
	}
	if content != nil {
		t.Errorf("content = %d bytes for an oversized file, want nil", len(content))
	}
}
