package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// headHash returns the current HEAD commit hash of a repository.
func headHash(t *testing.T, manager *Manager, repoPath string) string {
	t.Helper()
	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}
	if status.Head == nil {
		t.Fatalf("HEAD is unborn, want a commit")
	}
	return status.Head.Hash
}

func TestCheckoutCommitDetachesHead(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	first := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")
	commitFile(t, manager, repoPath, "a.txt", "two\n", "second")

	if err := manager.CheckoutCommit(repoPath, first); err != nil {
		t.Fatalf("CheckoutCommit() returned error: %v", err)
	}

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}
	if !status.Detached {
		t.Errorf("Detached = false after checking out a commit, want true")
	}
	if status.Head.Hash != first {
		t.Errorf("HEAD = %q, want %q", status.Head.Hash, first)
	}

	//The working tree must reflect the older commit
	content, _ := os.ReadFile(filepath.Join(repoPath, "a.txt"))
	if string(content) != "one\n" {
		t.Errorf("working tree = %q, want the first commit's content", string(content))
	}
}

func TestCheckoutCommitRefusesDirtyTree(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	first := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")
	commitFile(t, manager, repoPath, "a.txt", "two\n", "second")

	writeFile(t, repoPath, "a.txt", "uncommitted\n")
	if err := manager.CheckoutCommit(repoPath, first); err == nil {
		t.Errorf("CheckoutCommit() with a dirty tree = nil error, want a refusal")
	}
}

func TestResetToCommitModes(t *testing.T) {
	tests := []struct {
		name           string
		mode           string
		wantWorktree   string // file content after reset
		wantChangeSeen bool   // is the reverted change reported as pending?
	}{
		//soft/mixed keep the newer file on disk, so the difference reappears as
		//an uncommitted change; hard rewinds the file too.
		{name: "soft", mode: "soft", wantWorktree: "two\n", wantChangeSeen: true},
		{name: "mixed", mode: "mixed", wantWorktree: "two\n", wantChangeSeen: true},
		{name: "hard", mode: "hard", wantWorktree: "one\n", wantChangeSeen: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manager := newTestManager(t)
			repoPath := newTestRepo(t, manager)
			first := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")
			commitFile(t, manager, repoPath, "a.txt", "two\n", "second")

			if err := manager.ResetToCommit(repoPath, first, test.mode); err != nil {
				t.Fatalf("ResetToCommit(%s) returned error: %v", test.mode, err)
			}

			if got := headHash(t, manager, repoPath); got != first {
				t.Errorf("HEAD = %q, want the first commit %q", got, first)
			}

			content, _ := os.ReadFile(filepath.Join(repoPath, "a.txt"))
			if string(content) != test.wantWorktree {
				t.Errorf("working tree = %q, want %q", string(content), test.wantWorktree)
			}

			status, _ := manager.Status(repoPath)
			if status.Clean == test.wantChangeSeen {
				t.Errorf("Clean = %v, want %v", status.Clean, !test.wantChangeSeen)
			}
		})
	}
}

func TestResetHardRefusesDirtyTree(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	first := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")
	commitFile(t, manager, repoPath, "a.txt", "two\n", "second")

	writeFile(t, repoPath, "b.txt", "unsaved work\n")
	if err := manager.ResetToCommit(repoPath, first, "hard"); err == nil {
		t.Errorf("hard reset with a dirty tree = nil error, want a refusal")
	}
}

func TestResetToCommitValidation(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	hash := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	if err := manager.ResetToCommit(repoPath, hash, "sideways"); err == nil {
		t.Errorf("ResetToCommit() with an unknown mode = nil error, want an error")
	}
	if err := manager.ResetToCommit(repoPath, "abc1234", "mixed"); err == nil {
		t.Errorf("ResetToCommit() with a short hash = nil error, want an error")
	}
}

func TestCreateBranchAt(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	first := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")
	commitFile(t, manager, repoPath, "a.txt", "two\n", "second")

	if err := manager.CreateBranchAt(repoPath, "legacy", first); err != nil {
		t.Fatalf("CreateBranchAt() returned error: %v", err)
	}

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}
	if status.Branch != "legacy" {
		t.Errorf("current branch = %q, want %q", status.Branch, "legacy")
	}
	if status.Head.Hash != first {
		t.Errorf("new branch points at %q, want the first commit %q", status.Head.Hash, first)
	}
}

func TestCreateBranchAtRejectsExistingName(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	hash := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	branches, _ := manager.Branches(repoPath)
	existing := branches[0].Name

	if err := manager.CreateBranchAt(repoPath, existing, hash); err == nil {
		t.Errorf("CreateBranchAt() with an existing name = nil error, want an error")
	}
	if err := manager.CreateBranchAt(repoPath, "bad name", hash); err == nil {
		t.Errorf("CreateBranchAt() with an invalid name = nil error, want an error")
	}
}

func TestCreateTagLightweightAndAnnotated(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	hash := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	if err := manager.CreateTag(repoPath, "v1.0", hash, "", "T", "t@e.com"); err != nil {
		t.Fatalf("CreateTag() lightweight returned error: %v", err)
	}
	if err := manager.CreateTag(repoPath, "v1.0-annotated", hash, "first release", "T", "t@e.com"); err != nil {
		t.Fatalf("CreateTag() annotated returned error: %v", err)
	}

	tags, err := manager.TagsForCommit(repoPath, hash)
	if err != nil {
		t.Fatalf("TagsForCommit() returned error: %v", err)
	}
	if len(tags) != 2 {
		t.Fatalf("TagsForCommit() = %v, want two tags", tags)
	}

	found := map[string]bool{}
	for _, tag := range tags {
		found[tag] = true
	}
	if !found["v1.0"] || !found["v1.0-annotated"] {
		t.Errorf("TagsForCommit() = %v, want both the lightweight and annotated tags", tags)
	}
}

func TestCreateTagValidation(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	hash := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	if err := manager.CreateTag(repoPath, "v1.0", hash, "", "T", "t@e.com"); err != nil {
		t.Fatalf("CreateTag() returned error: %v", err)
	}

	tests := []struct {
		name string
		tag  string
	}{
		{name: "duplicate", tag: "v1.0"},
		{name: "empty", tag: ""},
		{name: "with space", tag: "v 1.0"},
		{name: "with tilde", tag: "v~1"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := manager.CreateTag(repoPath, test.tag, hash, "", "T", "t@e.com"); err == nil {
				t.Errorf("CreateTag(%q) = nil error, want an error", test.tag)
			}
		})
	}
}

func TestTagsForCommitEmpty(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	hash := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	tags, err := manager.TagsForCommit(repoPath, hash)
	if err != nil {
		t.Fatalf("TagsForCommit() returned error: %v", err)
	}
	if len(tags) != 0 {
		t.Errorf("TagsForCommit() = %v, want none", tags)
	}
}

func TestRevertLatestCommit(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "original\n", "first")
	commitFile(t, manager, repoPath, "a.txt", "changed\n", "second")
	second := headHash(t, manager, repoPath)

	revertHash, err := manager.RevertCommit(repoPath, second, &CommitRequest{
		Name:  "Test User",
		Email: "test@arozos.local",
	})
	if err != nil {
		t.Fatalf("RevertCommit() returned error: %v", err)
	}
	if revertHash == "" {
		t.Fatalf("RevertCommit() returned an empty hash")
	}

	//The file must be back to its state before the reverted commit
	content, _ := os.ReadFile(filepath.Join(repoPath, "a.txt"))
	if string(content) != "original\n" {
		t.Errorf("after revert a.txt = %q, want %q", string(content), "original\n")
	}

	status, _ := manager.Status(repoPath)
	if !status.Clean {
		t.Errorf("working tree is not clean after revert: %+v", status.Changes)
	}
	if status.Head.Subject != `Revert "second"` {
		t.Errorf("revert commit subject = %q, want %q", status.Head.Subject, `Revert "second"`)
	}
}

func TestRevertAddedFileDeletesIt(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "keep.txt", "keep\n", "first")
	commitFile(t, manager, repoPath, "added.txt", "new file\n", "add a file")
	second := headHash(t, manager, repoPath)

	if _, err := manager.RevertCommit(repoPath, second, &CommitRequest{Name: "T", Email: "t@e.com"}); err != nil {
		t.Fatalf("RevertCommit() returned error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(repoPath, "added.txt")); !os.IsNotExist(err) {
		t.Errorf("reverting the commit that added the file did not remove it")
	}
	if _, err := os.Stat(filepath.Join(repoPath, "keep.txt")); err != nil {
		t.Errorf("revert removed an unrelated file: %v", err)
	}
}

func TestRevertOlderUntouchedCommit(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "aaa\n", "add a")
	addACommit := headHash(t, manager, repoPath)
	commitFile(t, manager, repoPath, "b.txt", "bbb\n", "add b unrelated")

	//Reverting the older commit that added a.txt is clean because nothing has
	//touched a.txt since.
	if _, err := manager.RevertCommit(repoPath, addACommit, &CommitRequest{Name: "T", Email: "t@e.com"}); err != nil {
		t.Fatalf("RevertCommit() of an older untouched commit returned error: %v", err)
	}

	if _, err := os.Stat(filepath.Join(repoPath, "a.txt")); !os.IsNotExist(err) {
		t.Errorf("a.txt should be gone after reverting the commit that added it")
	}
	//The unrelated later file must be untouched
	content, _ := os.ReadFile(filepath.Join(repoPath, "b.txt"))
	if string(content) != "bbb\n" {
		t.Errorf("b.txt = %q, want it left alone", string(content))
	}
}

func TestRevertRefusesWhenFileChangedSince(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "v1\n", "first")
	target := headHash(t, manager, repoPath)
	commitFile(t, manager, repoPath, "a.txt", "v2\n", "second touches the same file")

	//a.txt was changed again after the target commit, so a clean revert is
	//impossible and the operation must refuse rather than corrupt the file.
	if _, err := manager.RevertCommit(repoPath, target, &CommitRequest{Name: "T", Email: "t@e.com"}); err == nil {
		t.Errorf("RevertCommit() of a commit whose file changed since = nil error, want a refusal")
	}

	//Nothing should have been written
	status, _ := manager.Status(repoPath)
	if !status.Clean {
		t.Errorf("a refused revert left the tree dirty: %+v", status.Changes)
	}
}

func TestRevertRefusesDirtyTree(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")
	hash := headHash(t, manager, repoPath)
	writeFile(t, repoPath, "a.txt", "uncommitted\n")

	if _, err := manager.RevertCommit(repoPath, hash, &CommitRequest{Name: "T", Email: "t@e.com"}); err == nil {
		t.Errorf("RevertCommit() with a dirty tree = nil error, want a refusal")
	}
}

func TestCherryPickAppliesToAnotherBranch(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	base := commitFile(t, manager, repoPath, "a.txt", "base\n", "base")

	//A feature commit that adds a file, on a branch off the base
	if err := manager.Checkout(repoPath, "feature", true); err != nil {
		t.Fatalf("Checkout(create) returned error: %v", err)
	}
	commitFile(t, manager, repoPath, "feature.txt", "feature work\n", "add feature")
	featureCommit := headHash(t, manager, repoPath)

	//Back to the base branch, cherry-pick the feature commit
	if err := manager.CheckoutCommit(repoPath, base); err != nil {
		t.Fatalf("CheckoutCommit(base) returned error: %v", err)
	}
	if err := manager.Checkout(repoPath, "main-line", true); err != nil {
		t.Fatalf("Checkout(create main-line) returned error: %v", err)
	}

	pickHash, err := manager.CherryPickCommit(repoPath, featureCommit, &CommitRequest{Name: "T", Email: "t@e.com"})
	if err != nil {
		t.Fatalf("CherryPickCommit() returned error: %v", err)
	}
	if pickHash == "" {
		t.Fatalf("CherryPickCommit() returned an empty hash")
	}

	content, err := os.ReadFile(filepath.Join(repoPath, "feature.txt"))
	if err != nil {
		t.Fatalf("the cherry-picked file is missing: %v", err)
	}
	if string(content) != "feature work\n" {
		t.Errorf("feature.txt = %q, want the cherry-picked content", string(content))
	}

	//The original commit message is preserved
	status, _ := manager.Status(repoPath)
	if status.Head.Subject != "add feature" {
		t.Errorf("cherry-pick subject = %q, want %q", status.Head.Subject, "add feature")
	}
}

func TestCherryPickPreservesOriginalAuthor(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	base := commitFile(t, manager, repoPath, "a.txt", "base\n", "base")

	if err := manager.Checkout(repoPath, "feature", true); err != nil {
		t.Fatalf("Checkout(create) returned error: %v", err)
	}
	writeFile(t, repoPath, "feature.txt", "work\n")
	if _, err := manager.Commit(repoPath, &CommitRequest{
		Message: "feature commit",
		Files:   []string{"feature.txt"},
		Name:    "Original Author",
		Email:   "original@example.com",
	}); err != nil {
		t.Fatalf("Commit() returned error: %v", err)
	}
	featureCommit := headHash(t, manager, repoPath)

	if err := manager.CheckoutCommit(repoPath, base); err != nil {
		t.Fatalf("CheckoutCommit(base) returned error: %v", err)
	}
	if err := manager.Checkout(repoPath, "target", true); err != nil {
		t.Fatalf("Checkout(create) returned error: %v", err)
	}

	if _, err := manager.CherryPickCommit(repoPath, featureCommit, &CommitRequest{
		Name:  "Picker",
		Email: "picker@example.com",
	}); err != nil {
		t.Fatalf("CherryPickCommit() returned error: %v", err)
	}

	status, _ := manager.Status(repoPath)
	if status.Head.AuthorName != "Original Author" {
		t.Errorf("author = %q, want the original author preserved", status.Head.AuthorName)
	}
	if status.Head.AuthorEmail != "original@example.com" {
		t.Errorf("author email = %q, want the original preserved", status.Head.AuthorEmail)
	}
}

func TestCherryPickRefusesConflict(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	base := commitFile(t, manager, repoPath, "shared.txt", "base\n", "base")

	//Feature edits shared.txt
	if err := manager.Checkout(repoPath, "feature", true); err != nil {
		t.Fatalf("Checkout(create) returned error: %v", err)
	}
	commitFile(t, manager, repoPath, "shared.txt", "feature edit\n", "feature edits shared")
	featureCommit := headHash(t, manager, repoPath)

	//Target branch edits shared.txt differently, so the pre-image no longer
	//matches and a clean cherry-pick is impossible.
	if err := manager.CheckoutCommit(repoPath, base); err != nil {
		t.Fatalf("CheckoutCommit(base) returned error: %v", err)
	}
	if err := manager.Checkout(repoPath, "target", true); err != nil {
		t.Fatalf("Checkout(create) returned error: %v", err)
	}
	commitFile(t, manager, repoPath, "shared.txt", "target edit\n", "target edits shared")

	if _, err := manager.CherryPickCommit(repoPath, featureCommit, &CommitRequest{Name: "T", Email: "t@e.com"}); err == nil {
		t.Errorf("CherryPickCommit() onto a diverged file = nil error, want a refusal")
	}

	status, _ := manager.Status(repoPath)
	if !status.Clean {
		t.Errorf("a refused cherry-pick left the tree dirty: %+v", status.Changes)
	}
}

func TestAmendCommitMessage(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "typo in mesage")
	original := headHash(t, manager, repoPath)

	newHash, err := manager.AmendCommitMessage(repoPath, "fixed message", &CommitRequest{
		Name:  "T",
		Email: "t@e.com",
	})
	if err != nil {
		t.Fatalf("AmendCommitMessage() returned error: %v", err)
	}
	if newHash == original {
		t.Errorf("amend produced the same hash %q, want a new commit object", newHash)
	}

	status, _ := manager.Status(repoPath)
	if status.Head.Subject != "fixed message" {
		t.Errorf("HEAD subject = %q, want the amended message", status.Head.Subject)
	}
	if status.Head.Hash != newHash {
		t.Errorf("HEAD = %q, want the amended commit %q", status.Head.Hash, newHash)
	}

	//The file content, i.e. the tree, must be unchanged
	content, _ := os.ReadFile(filepath.Join(repoPath, "a.txt"))
	if string(content) != "one\n" {
		t.Errorf("amend altered the tree, a.txt = %q", string(content))
	}

	//Only one commit should exist — amend replaces, not appends
	log, _ := manager.Log(repoPath, 10)
	if len(log) != 1 {
		t.Errorf("log has %d commits after amend, want 1", len(log))
	}
}

func TestAmendPreservesAuthorAcrossMessageChange(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	writeFile(t, repoPath, "a.txt", "one\n")
	if _, err := manager.Commit(repoPath, &CommitRequest{
		Message: "original",
		Files:   []string{"a.txt"},
		Name:    "First Author",
		Email:   "first@example.com",
	}); err != nil {
		t.Fatalf("Commit() returned error: %v", err)
	}

	if _, err := manager.AmendCommitMessage(repoPath, "reworded", &CommitRequest{
		Name:  "Someone Else",
		Email: "else@example.com",
	}); err != nil {
		t.Fatalf("AmendCommitMessage() returned error: %v", err)
	}

	status, _ := manager.Status(repoPath)
	if status.Head.AuthorName != "First Author" {
		t.Errorf("author = %q, want the original author preserved through amend", status.Head.AuthorName)
	}
}

func TestAmendValidation(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	if _, err := manager.AmendCommitMessage(repoPath, "  ", &CommitRequest{}); err == nil {
		t.Errorf("AmendCommitMessage() with a blank message = nil error, want an error")
	}
}

func TestAmendRefusesDetachedHead(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	first := commitFile(t, manager, repoPath, "a.txt", "one\n", "first")
	commitFile(t, manager, repoPath, "a.txt", "two\n", "second")

	if err := manager.CheckoutCommit(repoPath, first); err != nil {
		t.Fatalf("CheckoutCommit() returned error: %v", err)
	}
	if _, err := manager.AmendCommitMessage(repoPath, "new message", &CommitRequest{}); err == nil {
		t.Errorf("AmendCommitMessage() on a detached HEAD = nil error, want an error")
	}
}

func TestParseResetMode(t *testing.T) {
	tests := []struct {
		name      string
		mode      string
		wantError bool
	}{
		{name: "soft", mode: "soft"},
		{name: "mixed", mode: "mixed"},
		{name: "hard", mode: "hard"},
		{name: "empty defaults to mixed", mode: ""},
		{name: "uppercase", mode: "HARD"},
		{name: "padded", mode: "  soft  "},
		{name: "unknown", mode: "medium", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := parseResetMode(test.mode)
			if test.wantError && err == nil {
				t.Errorf("parseResetMode(%q) = nil error, want an error", test.mode)
			}
			if !test.wantError && err != nil {
				t.Errorf("parseResetMode(%q) returned error: %v", test.mode, err)
			}
		})
	}
}

func TestHistoryActionsOnNonRepo(t *testing.T) {
	manager := newTestManager(t)
	plain := t.TempDir()
	dummy := strings.Repeat("a", 40)

	if err := manager.CheckoutCommit(plain, dummy); err != ErrNotARepo {
		t.Errorf("CheckoutCommit() on a plain folder = %v, want ErrNotARepo", err)
	}
	if err := manager.CreateTag(plain, "v1", dummy, "", "T", "t@e.com"); err != ErrNotARepo {
		t.Errorf("CreateTag() on a plain folder = %v, want ErrNotARepo", err)
	}
	if _, err := manager.TagsForCommit(plain, dummy); err != ErrNotARepo {
		t.Errorf("TagsForCommit() on a plain folder = %v, want ErrNotARepo", err)
	}
}
