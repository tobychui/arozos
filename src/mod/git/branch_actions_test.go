package git

import (
	"errors"
	"path/filepath"
	"testing"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
)

// newBareRemote creates an empty bare repository to act as a push target, so the
// network code paths (delete / rename on a remote) can be exercised without a
// real server.
func newBareRemote(t *testing.T) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "remote.git")
	if _, err := gogit.PlainInit(path, true); err != nil {
		t.Fatalf("cannot create the bare remote: %v", err)
	}
	return path
}

// bareHasBranch reports whether the bare repository holds a given branch.
func bareHasBranch(t *testing.T, barePath string, branch string) bool {
	t.Helper()

	repo, err := gogit.PlainOpen(barePath)
	if err != nil {
		t.Fatalf("cannot open the bare remote: %v", err)
	}
	_, err = repo.Reference(plumbing.NewBranchReferenceName(branch), false)
	return err == nil
}

// hasLocalRef reports whether a reference exists in a working repository.
func hasLocalRef(t *testing.T, manager *Manager, repoPath string, name plumbing.ReferenceName) bool {
	t.Helper()

	repo, err := manager.open(repoPath)
	if err != nil {
		t.Fatalf("open() returned error: %v", err)
	}
	_, err = repo.Reference(name, false)
	return err == nil
}

/*
newRepoWithRemote builds a working repository wired to a fresh bare remote, with
master pushed and a second branch pushed under the given name. It returns the
working repository path, the bare remote path and the default branch name.
*/
func newRepoWithRemote(t *testing.T, manager *Manager, extraBranch string) (string, string, string) {
	t.Helper()

	bare := newBareRemote(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	if err := manager.AddRemote(repoPath, "origin", bare); err != nil {
		t.Fatalf("AddRemote() returned error: %v", err)
	}

	branches, _ := manager.Branches(repoPath)
	defaultBranch := branches[0].Name

	if _, err := manager.Push(repoPath, &TransportRequest{SetUpstream: true}); err != nil {
		t.Fatalf("Push() of the default branch returned error: %v", err)
	}

	if extraBranch != "" {
		if err := manager.Checkout(repoPath, extraBranch, true); err != nil {
			t.Fatalf("Checkout(create %s) returned error: %v", extraBranch, err)
		}
		commitFile(t, manager, repoPath, "b.txt", "two\n", "on "+extraBranch)

		if _, err := manager.Push(repoPath, &TransportRequest{SetUpstream: true}); err != nil {
			t.Fatalf("Push() of %s returned error: %v", extraBranch, err)
		}
		//Return to the default branch so the extra one can be operated on
		if err := manager.Checkout(repoPath, defaultBranch, false); err != nil {
			t.Fatalf("Checkout(%s) returned error: %v", defaultBranch, err)
		}
	}

	return repoPath, bare, defaultBranch
}

/* ── Local branch deletion ────────────────────────────────────────────── */

func TestDeleteBranchRemovesMergedBranch(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	branches, _ := manager.Branches(repoPath)
	defaultBranch := branches[0].Name

	//A branch created at HEAD with no extra commits is fully merged
	if err := manager.Checkout(repoPath, "scratch", true); err != nil {
		t.Fatalf("Checkout(create) returned error: %v", err)
	}
	if err := manager.Checkout(repoPath, defaultBranch, false); err != nil {
		t.Fatalf("Checkout(back) returned error: %v", err)
	}

	if err := manager.DeleteBranch(repoPath, "scratch", false); err != nil {
		t.Fatalf("DeleteBranch() returned error: %v", err)
	}

	if hasLocalRef(t, manager, repoPath, plumbing.NewBranchReferenceName("scratch")) {
		t.Errorf("the branch ref still exists after DeleteBranch()")
	}

	after, _ := manager.Branches(repoPath)
	for _, branch := range after {
		if branch.Name == "scratch" {
			t.Errorf("Branches() still lists the deleted branch")
		}
	}
}

func TestDeleteBranchRefusesCurrentBranch(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	branches, _ := manager.Branches(repoPath)
	current := branches[0].Name

	if err := manager.DeleteBranch(repoPath, current, false); err == nil {
		t.Errorf("DeleteBranch() on the current branch = nil error, want a refusal")
	}
	//Even forcing must not remove the branch HEAD points at
	if err := manager.DeleteBranch(repoPath, current, true); err == nil {
		t.Errorf("DeleteBranch(force) on the current branch = nil error, want a refusal")
	}
	if !hasLocalRef(t, manager, repoPath, plumbing.NewBranchReferenceName(current)) {
		t.Errorf("the current branch was deleted despite the refusal")
	}
}

func TestDeleteBranchUnmergedNeedsForce(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	branches, _ := manager.Branches(repoPath)
	defaultBranch := branches[0].Name

	//A commit that exists only on the feature branch makes it unmerged
	if err := manager.Checkout(repoPath, "feature", true); err != nil {
		t.Fatalf("Checkout(create) returned error: %v", err)
	}
	commitFile(t, manager, repoPath, "feature.txt", "work\n", "feature work")
	if err := manager.Checkout(repoPath, defaultBranch, false); err != nil {
		t.Fatalf("Checkout(back) returned error: %v", err)
	}

	err := manager.DeleteBranch(repoPath, "feature", false)
	if !errors.Is(err, ErrUnmergedBranch) {
		t.Fatalf("DeleteBranch() of an unmerged branch = %v, want ErrUnmergedBranch", err)
	}
	if !hasLocalRef(t, manager, repoPath, plumbing.NewBranchReferenceName("feature")) {
		t.Fatalf("the branch was deleted even though the call was refused")
	}

	//Forcing must go through
	if err := manager.DeleteBranch(repoPath, "feature", true); err != nil {
		t.Fatalf("DeleteBranch(force) returned error: %v", err)
	}
	if hasLocalRef(t, manager, repoPath, plumbing.NewBranchReferenceName("feature")) {
		t.Errorf("the branch survived a forced delete")
	}
}

func TestDeleteBranchDropsTrackingConfig(t *testing.T) {
	manager := newTestManager(t)
	repoPath, _, defaultBranch := newRepoWithRemote(t, manager, "feature")

	repo, err := manager.open(repoPath)
	if err != nil {
		t.Fatalf("open() returned error: %v", err)
	}
	cfg, _ := repo.Config()
	if _, ok := cfg.Branches["feature"]; !ok {
		t.Fatalf("the pushed branch has no tracking config to begin with")
	}

	//Force is needed: the feature branch carries its own commit
	if defaultBranch == "feature" {
		t.Fatalf("unexpected default branch name for this test")
	}
	if err := manager.DeleteBranch(repoPath, "feature", true); err != nil {
		t.Fatalf("DeleteBranch() returned error: %v", err)
	}

	repo, _ = manager.open(repoPath)
	cfg, _ = repo.Config()
	if _, ok := cfg.Branches["feature"]; ok {
		t.Errorf("the tracking config survived the branch delete")
	}
}

func TestDeleteBranchValidation(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	tests := []struct {
		name   string
		branch string
	}{
		{name: "no such branch", branch: "nonexistent"},
		{name: "empty name", branch: ""},
		{name: "invalid name", branch: "bad name"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := manager.DeleteBranch(repoPath, test.branch, false); err == nil {
				t.Errorf("DeleteBranch(%q) = nil error, want an error", test.branch)
			}
		})
	}
}

/* ── Local branch rename ──────────────────────────────────────────────── */

func TestRenameBranchNotCurrent(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	branches, _ := manager.Branches(repoPath)
	defaultBranch := branches[0].Name

	if err := manager.Checkout(repoPath, "old-name", true); err != nil {
		t.Fatalf("Checkout(create) returned error: %v", err)
	}
	if err := manager.Checkout(repoPath, defaultBranch, false); err != nil {
		t.Fatalf("Checkout(back) returned error: %v", err)
	}

	if err := manager.RenameBranch(repoPath, "old-name", "new-name"); err != nil {
		t.Fatalf("RenameBranch() returned error: %v", err)
	}

	if hasLocalRef(t, manager, repoPath, plumbing.NewBranchReferenceName("old-name")) {
		t.Errorf("the old branch ref still exists")
	}
	if !hasLocalRef(t, manager, repoPath, plumbing.NewBranchReferenceName("new-name")) {
		t.Errorf("the new branch ref was not created")
	}

	//The current branch must not have changed
	status, _ := manager.Status(repoPath)
	if status.Branch != defaultBranch {
		t.Errorf("current branch = %q, want %q", status.Branch, defaultBranch)
	}
}

func TestRenameCurrentBranchFollowsHead(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	branches, _ := manager.Branches(repoPath)
	current := branches[0].Name

	if err := manager.RenameBranch(repoPath, current, "renamed-main"); err != nil {
		t.Fatalf("RenameBranch() returned error: %v", err)
	}

	status, err := manager.Status(repoPath)
	if err != nil {
		t.Fatalf("Status() returned error: %v", err)
	}
	if status.Branch != "renamed-main" {
		t.Errorf("current branch = %q, want %q", status.Branch, "renamed-main")
	}
	if status.Detached {
		t.Errorf("HEAD became detached after renaming the current branch")
	}
	if status.Head == nil {
		t.Errorf("HEAD no longer resolves to a commit after the rename")
	}

	//A commit must still be possible on the renamed branch
	commitFile(t, manager, repoPath, "b.txt", "two\n", "after rename")
}

func TestRenameBranchCarriesUpstreamConfig(t *testing.T) {
	manager := newTestManager(t)
	repoPath, _, _ := newRepoWithRemote(t, manager, "feature")

	if err := manager.RenameBranch(repoPath, "feature", "feature-renamed"); err != nil {
		t.Fatalf("RenameBranch() returned error: %v", err)
	}

	repo, err := manager.open(repoPath)
	if err != nil {
		t.Fatalf("open() returned error: %v", err)
	}
	cfg, _ := repo.Config()

	if _, ok := cfg.Branches["feature"]; ok {
		t.Errorf("the old branch config was left behind")
	}
	renamed, ok := cfg.Branches["feature-renamed"]
	if !ok {
		t.Fatalf("the renamed branch has no tracking config")
	}
	if renamed.Name != "feature-renamed" {
		t.Errorf("config Name = %q, want %q", renamed.Name, "feature-renamed")
	}
	if renamed.Remote != "origin" {
		t.Errorf("config Remote = %q, want origin", renamed.Remote)
	}
}

func TestRenameBranchValidation(t *testing.T) {
	manager := newTestManager(t)
	repoPath := newTestRepo(t, manager)
	commitFile(t, manager, repoPath, "a.txt", "one\n", "first")

	branches, _ := manager.Branches(repoPath)
	existing := branches[0].Name

	if err := manager.Checkout(repoPath, "other", true); err != nil {
		t.Fatalf("Checkout(create) returned error: %v", err)
	}
	if err := manager.Checkout(repoPath, existing, false); err != nil {
		t.Fatalf("Checkout(back) returned error: %v", err)
	}

	tests := []struct {
		name    string
		oldName string
		newName string
	}{
		{name: "source missing", oldName: "nonexistent", newName: "whatever"},
		{name: "target already exists", oldName: "other", newName: existing},
		{name: "same name", oldName: "other", newName: "other"},
		{name: "invalid target", oldName: "other", newName: "bad name"},
		{name: "empty target", oldName: "other", newName: ""},
		{name: "empty source", oldName: "", newName: "fine"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := manager.RenameBranch(repoPath, test.oldName, test.newName); err == nil {
				t.Errorf("RenameBranch(%q, %q) = nil error, want an error", test.oldName, test.newName)
			}
		})
	}

	//None of the refused calls may have changed anything
	if !hasLocalRef(t, manager, repoPath, plumbing.NewBranchReferenceName("other")) {
		t.Errorf("a refused rename removed the source branch")
	}
}

/* ── Remote branch deletion ───────────────────────────────────────────── */

func TestDeleteRemoteBranch(t *testing.T) {
	manager := newTestManager(t)
	repoPath, bare, _ := newRepoWithRemote(t, manager, "feature")

	if !bareHasBranch(t, bare, "feature") {
		t.Fatalf("the remote does not have the feature branch to begin with")
	}

	if err := manager.DeleteRemoteBranch(repoPath, "origin", "feature", &TransportRequest{}); err != nil {
		t.Fatalf("DeleteRemoteBranch() returned error: %v", err)
	}

	if bareHasBranch(t, bare, "feature") {
		t.Errorf("the branch still exists on the remote")
	}

	//The local tracking ref must be pruned so the UI stops listing it
	if hasLocalRef(t, manager, repoPath, plumbing.NewRemoteReferenceName("origin", "feature")) {
		t.Errorf("the remote-tracking ref was not pruned")
	}

	after, _ := manager.Branches(repoPath)
	for _, branch := range after {
		if branch.IsRemote && branch.Short == "feature" {
			t.Errorf("Branches() still lists the deleted remote branch")
		}
	}

	//The local branch of the same name is a separate thing and must survive
	if !hasLocalRef(t, manager, repoPath, plumbing.NewBranchReferenceName("feature")) {
		t.Errorf("deleting the remote branch also removed the local branch")
	}
}

func TestDeleteRemoteBranchValidation(t *testing.T) {
	manager := newTestManager(t)
	repoPath, _, _ := newRepoWithRemote(t, manager, "feature")

	if err := manager.DeleteRemoteBranch(repoPath, "nosuchremote", "feature", &TransportRequest{}); !errors.Is(err, ErrNoRemote) {
		t.Errorf("DeleteRemoteBranch() with an unknown remote = %v, want ErrNoRemote", err)
	}
	if err := manager.DeleteRemoteBranch(repoPath, "origin", "bad name", &TransportRequest{}); err == nil {
		t.Errorf("DeleteRemoteBranch() with an invalid branch name = nil error, want an error")
	}
	if err := manager.DeleteRemoteBranch(repoPath, "origin", "", &TransportRequest{}); err == nil {
		t.Errorf("DeleteRemoteBranch() with an empty branch name = nil error, want an error")
	}
}

/* ── Remote branch rename ─────────────────────────────────────────────── */

func TestRenameRemoteBranch(t *testing.T) {
	manager := newTestManager(t)
	repoPath, bare, _ := newRepoWithRemote(t, manager, "feature")

	if err := manager.RenameRemoteBranch(repoPath, "origin", "feature", "feature-v2", &TransportRequest{}); err != nil {
		t.Fatalf("RenameRemoteBranch() returned error: %v", err)
	}

	if !bareHasBranch(t, bare, "feature-v2") {
		t.Errorf("the new branch name was not created on the remote")
	}
	if bareHasBranch(t, bare, "feature") {
		t.Errorf("the old branch name still exists on the remote")
	}

	//The local tracking refs must mirror the change without needing a fetch
	if !hasLocalRef(t, manager, repoPath, plumbing.NewRemoteReferenceName("origin", "feature-v2")) {
		t.Errorf("the new remote-tracking ref was not created locally")
	}
	if hasLocalRef(t, manager, repoPath, plumbing.NewRemoteReferenceName("origin", "feature")) {
		t.Errorf("the old remote-tracking ref was not removed locally")
	}
}

func TestRenameRemoteBranchPreservesCommits(t *testing.T) {
	manager := newTestManager(t)
	repoPath, bare, _ := newRepoWithRemote(t, manager, "feature")

	//Record what the remote branch pointed at before the rename
	repo, _ := manager.open(repoPath)
	before, err := repo.Reference(plumbing.NewRemoteReferenceName("origin", "feature"), false)
	if err != nil {
		t.Fatalf("cannot read the remote-tracking ref: %v", err)
	}

	if err := manager.RenameRemoteBranch(repoPath, "origin", "feature", "feature-v2", &TransportRequest{}); err != nil {
		t.Fatalf("RenameRemoteBranch() returned error: %v", err)
	}

	bareRepo, err := gogit.PlainOpen(bare)
	if err != nil {
		t.Fatalf("cannot open the bare remote: %v", err)
	}
	after, err := bareRepo.Reference(plumbing.NewBranchReferenceName("feature-v2"), false)
	if err != nil {
		t.Fatalf("the renamed branch is missing on the remote: %v", err)
	}

	if after.Hash() != before.Hash() {
		t.Errorf("renamed branch points at %s, want the original commit %s", after.Hash(), before.Hash())
	}
}

func TestRenameRemoteBranchValidation(t *testing.T) {
	manager := newTestManager(t)
	repoPath, _, _ := newRepoWithRemote(t, manager, "feature")

	tests := []struct {
		name    string
		remote  string
		oldName string
		newName string
	}{
		{name: "unknown remote", remote: "nosuchremote", oldName: "feature", newName: "x"},
		{name: "source missing on remote", remote: "origin", oldName: "nonexistent", newName: "x"},
		{name: "same name", remote: "origin", oldName: "feature", newName: "feature"},
		{name: "invalid target", remote: "origin", oldName: "feature", newName: "bad name"},
		{name: "empty target", remote: "origin", oldName: "feature", newName: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := manager.RenameRemoteBranch(repoPath, test.remote, test.oldName, test.newName, &TransportRequest{}); err == nil {
				t.Errorf("RenameRemoteBranch() with %s = nil error, want an error", test.name)
			}
		})
	}
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

func TestSplitRemoteRef(t *testing.T) {
	tests := []struct {
		name       string
		fullRef    string
		wantRemote string
		wantShort  string
	}{
		{name: "simple remote branch", fullRef: "refs/remotes/origin/master", wantRemote: "origin", wantShort: "master"},
		{name: "nested branch name", fullRef: "refs/remotes/origin/feature/login", wantRemote: "origin", wantShort: "feature/login"},
		{name: "non-origin remote", fullRef: "refs/remotes/upstream/dev", wantRemote: "upstream", wantShort: "dev"},
		{name: "local branch", fullRef: "refs/heads/master", wantRemote: "", wantShort: "master"},
		{name: "local nested branch", fullRef: "refs/heads/feature/login", wantRemote: "", wantShort: "feature/login"},
		{name: "remote with no branch part", fullRef: "refs/remotes/origin", wantRemote: "", wantShort: "origin"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			remote, short := splitRemoteRef(test.fullRef)
			if remote != test.wantRemote {
				t.Errorf("splitRemoteRef(%q) remote = %q, want %q", test.fullRef, remote, test.wantRemote)
			}
			if short != test.wantShort {
				t.Errorf("splitRemoteRef(%q) short = %q, want %q", test.fullRef, short, test.wantShort)
			}
		})
	}
}

func TestRemoteOrName(t *testing.T) {
	tests := []struct {
		name   string
		remote string
		want   string
	}{
		{name: "explicit", remote: "upstream", want: "upstream"},
		{name: "empty defaults to origin", remote: "", want: "origin"},
		{name: "whitespace defaults to origin", remote: "   ", want: "origin"},
		{name: "padded", remote: " upstream ", want: "upstream"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := remoteOrName(test.remote); got != test.want {
				t.Errorf("remoteOrName(%q) = %q, want %q", test.remote, got, test.want)
			}
		})
	}
}

// TestBranchesReportRemoteAndShort checks the fields the front-end needs to
// address a remote branch unambiguously.
func TestBranchesReportRemoteAndShort(t *testing.T) {
	manager := newTestManager(t)
	repoPath, _, defaultBranch := newRepoWithRemote(t, manager, "feature")

	branches, err := manager.Branches(repoPath)
	if err != nil {
		t.Fatalf("Branches() returned error: %v", err)
	}

	sawLocal, sawRemote := false, false
	for _, branch := range branches {
		if !branch.IsRemote && branch.Name == defaultBranch {
			sawLocal = true
			if branch.Short != defaultBranch {
				t.Errorf("local branch Short = %q, want %q", branch.Short, defaultBranch)
			}
			if branch.Remote != "" {
				t.Errorf("local branch Remote = %q, want empty", branch.Remote)
			}
		}
		if branch.IsRemote && branch.Short == "feature" {
			sawRemote = true
			if branch.Remote != "origin" {
				t.Errorf("remote branch Remote = %q, want origin", branch.Remote)
			}
			if branch.Name != "origin/feature" {
				t.Errorf("remote branch Name = %q, want origin/feature", branch.Name)
			}
		}
	}

	if !sawLocal {
		t.Errorf("Branches() did not report the local default branch")
	}
	if !sawRemote {
		t.Errorf("Branches() did not report the remote feature branch")
	}
}
