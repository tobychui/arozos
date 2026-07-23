package git

/*
	history.go

	Read-only history queries plus branch management: the data behind the
	History tab and the branch switcher in the GitApp toolbar.
*/

import (
	"errors"
	"sort"
	"strings"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// defaultLogLimit bounds Log when the caller passes a non-positive limit.
const defaultLogLimit = 50

// Log returns up to limit commits reachable from HEAD, newest first.
func (m *Manager) Log(realpath string, limit int) ([]CommitInfo, error) {
	if limit <= 0 {
		limit = defaultLogLimit
	}

	repo, err := m.open(realpath)
	if err != nil {
		return nil, err
	}

	head, err := repo.Head()
	if err != nil {
		if errors.Is(err, plumbing.ErrReferenceNotFound) {
			//An unborn branch simply has no history yet
			return []CommitInfo{}, nil
		}
		return nil, err
	}

	iter, err := repo.Log(&gogit.LogOptions{From: head.Hash()})
	if err != nil {
		return nil, err
	}
	defer iter.Close()

	commits := []CommitInfo{}
	err = iter.ForEach(func(commit *object.Commit) error {
		commits = append(commits, *commitToInfo(commit))
		if len(commits) >= limit {
			return storerStop
		}
		return nil
	})
	if err != nil && !errors.Is(err, storerStop) {
		return nil, err
	}

	return commits, nil
}

// Branches lists local and remote-tracking branches. The current branch is
// flagged so the switcher can render it as selected.
func (m *Manager) Branches(realpath string) ([]BranchInfo, error) {
	repo, err := m.open(realpath)
	if err != nil {
		return nil, err
	}

	currentBranch := ""
	if head, herr := repo.Head(); herr == nil && head.Name().IsBranch() {
		currentBranch = head.Name().Short()
	}

	branches := []BranchInfo{}

	localIter, err := repo.Branches()
	if err != nil {
		return nil, err
	}
	err = localIter.ForEach(func(ref *plumbing.Reference) error {
		branches = append(branches, BranchInfo{
			Name:      ref.Name().Short(),
			FullRef:   ref.Name().String(),
			Hash:      ref.Hash().String(),
			IsRemote:  false,
			IsCurrent: ref.Name().Short() == currentBranch,
		})
		return nil
	})
	localIter.Close()
	if err != nil {
		return nil, err
	}

	remoteIter, err := repo.References()
	if err != nil {
		return nil, err
	}
	err = remoteIter.ForEach(func(ref *plumbing.Reference) error {
		if !ref.Name().IsRemote() || ref.Type() == plumbing.SymbolicReference {
			return nil
		}
		//HEAD pointers such as refs/remotes/origin/HEAD are not branches
		if strings.HasSuffix(ref.Name().Short(), "/HEAD") {
			return nil
		}
		branches = append(branches, BranchInfo{
			Name:     ref.Name().Short(),
			FullRef:  ref.Name().String(),
			Hash:     ref.Hash().String(),
			IsRemote: true,
		})
		return nil
	})
	remoteIter.Close()
	if err != nil {
		return nil, err
	}

	sort.Slice(branches, func(i, j int) bool {
		if branches[i].IsRemote != branches[j].IsRemote {
			return !branches[i].IsRemote
		}
		return branches[i].Name < branches[j].Name
	})

	return branches, nil
}

// Checkout switches to an existing branch, or creates it from the current HEAD
// when create is set.
func (m *Manager) Checkout(realpath string, branch string, create bool) error {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return errors.New("branch name cannot be empty")
	}
	if err := validateBranchName(branch); err != nil {
		return err
	}

	repo, tree, err := m.worktree(realpath)
	if err != nil {
		return err
	}

	options := &gogit.CheckoutOptions{
		Branch: plumbing.NewBranchReferenceName(branch),
		Create: create,
		Keep:   true,
	}

	//Checking out a remote-tracking branch by its "origin/x" name creates the
	//matching local branch, which is what a user picking it from the dropdown
	//expects.
	if !create {
		if _, rerr := repo.Reference(plumbing.NewBranchReferenceName(branch), true); rerr != nil {
			if remoteRef, terr := findRemoteBranch(repo, branch); terr == nil {
				options.Branch = plumbing.NewBranchReferenceName(shortLocalName(branch))
				options.Create = true
				options.Hash = remoteRef.Hash()
			}
		}
	}

	return tree.Checkout(options)
}

// findRemoteBranch resolves a "remote/branch" style name to its reference.
func findRemoteBranch(repo *gogit.Repository, name string) (*plumbing.Reference, error) {
	parts := strings.SplitN(name, "/", 2)
	if len(parts) != 2 {
		return nil, errors.New("not a remote branch name")
	}
	return repo.Reference(plumbing.NewRemoteReferenceName(parts[0], parts[1]), true)
}

// shortLocalName strips the remote prefix so "origin/feature" becomes "feature".
func shortLocalName(name string) string {
	parts := strings.SplitN(name, "/", 2)
	if len(parts) == 2 {
		return parts[1]
	}
	return name
}

// validateBranchName rejects the ref name characters git itself forbids, since
// the value arrives from a browser text field.
func validateBranchName(branch string) error {
	if strings.HasPrefix(branch, "-") || strings.HasPrefix(branch, "/") || strings.HasSuffix(branch, "/") {
		return errors.New("invalid branch name: " + branch)
	}
	if strings.Contains(branch, "..") || strings.Contains(branch, "@{") {
		return errors.New("invalid branch name: " + branch)
	}
	for _, forbidden := range []string{" ", "~", "^", ":", "?", "*", "[", "\\", "\x7f"} {
		if strings.Contains(branch, forbidden) {
			return errors.New("invalid branch name: " + branch)
		}
	}
	for _, r := range branch {
		if r < 0x20 {
			return errors.New("invalid branch name: " + branch)
		}
	}
	return nil
}
