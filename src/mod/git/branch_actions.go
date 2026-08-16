package git

/*
	branch_actions.go

	Deleting and renaming branches, both local and on a remote.

	Local operations are pure ref manipulation. Remote ones are network pushes:
	a delete is a push with an empty source refspec, and a rename is a push of
	the new name followed by a delete of the old, because git has no notion of
	renaming a ref on a server. That two-step is done in the safe order — the new
	name is created first — so a failure never leaves the branch missing.
*/

import (
	"errors"
	"strings"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
)

const (
	//branchRefPrefix is the ref namespace holding local branches.
	branchRefPrefix = "refs/heads/"

	//remoteRefPrefix is the ref namespace holding remote-tracking branches.
	remoteRefPrefix = "refs/remotes/"
)

// DeleteBranch removes a local branch.
//
// The checked-out branch is never deleted. A branch holding commits that are not
// reachable from HEAD returns ErrUnmergedBranch unless force is set, so the
// caller can confirm before losing work — the same protection `git branch -d`
// gives over `-D`.
func (m *Manager) DeleteBranch(realpath string, branch string, force bool) error {
	branch = strings.TrimSpace(branch)
	if err := validateBranchName(branch); err != nil {
		return err
	}

	repo, err := m.open(realpath)
	if err != nil {
		return err
	}

	referenceName := plumbing.NewBranchReferenceName(branch)
	branchRef, err := repo.Reference(referenceName, false)
	if err != nil {
		return errors.New("no such local branch: " + branch)
	}

	if head, herr := repo.Head(); herr == nil && head.Name() == referenceName {
		return errors.New("cannot delete " + branch + " because it is the current branch — switch to another branch first")
	}

	if !force {
		merged, cerr := branchIsMerged(repo, branchRef.Hash())
		//A failed reachability check is not a reason to block the delete; only a
		//definite "not merged" answer is.
		if cerr == nil && !merged {
			return ErrUnmergedBranch
		}
	}

	if err := repo.Storer.RemoveReference(referenceName); err != nil {
		return err
	}

	//Drop the tracking configuration so a future branch reusing the name does
	//not silently inherit this one's upstream.
	removeBranchConfig(repo, branch)
	return nil
}

// RenameBranch renames a local branch, carrying its upstream configuration over
// and following HEAD when the renamed branch is the checked-out one.
func (m *Manager) RenameBranch(realpath string, oldName string, newName string) error {
	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)

	if err := validateBranchName(oldName); err != nil {
		return err
	}
	if err := validateBranchName(newName); err != nil {
		return err
	}
	if oldName == newName {
		return errors.New("the new name is the same as the current one")
	}

	repo, err := m.open(realpath)
	if err != nil {
		return err
	}

	oldReferenceName := plumbing.NewBranchReferenceName(oldName)
	newReferenceName := plumbing.NewBranchReferenceName(newName)

	oldRef, err := repo.Reference(oldReferenceName, false)
	if err != nil {
		return errors.New("no such local branch: " + oldName)
	}
	if _, err := repo.Reference(newReferenceName, false); err == nil {
		return errors.New("a branch named " + newName + " already exists")
	}

	//Whether this is the current branch has to be settled before the old ref
	//disappears, otherwise HEAD can no longer be resolved.
	isCurrent := false
	if head, herr := repo.Head(); herr == nil && head.Name() == oldReferenceName {
		isCurrent = true
	}

	if err := repo.Storer.SetReference(plumbing.NewHashReference(newReferenceName, oldRef.Hash())); err != nil {
		return err
	}

	moveBranchConfig(repo, oldName, newName)

	if isCurrent {
		if err := repo.Storer.SetReference(plumbing.NewSymbolicReference(plumbing.HEAD, newReferenceName)); err != nil {
			return err
		}
	}

	return repo.Storer.RemoveReference(oldReferenceName)
}

// DeleteRemoteBranch deletes a branch on the remote and prunes the local
// remote-tracking ref so it stops showing in the branch list.
func (m *Manager) DeleteRemoteBranch(realpath string, remote string, branch string, req *TransportRequest) error {
	branch = strings.TrimSpace(branch)
	if err := validateBranchName(branch); err != nil {
		return err
	}
	if req == nil {
		req = &TransportRequest{}
	}
	remote = remoteOrName(remote)

	repo, err := m.open(realpath)
	if err != nil {
		return err
	}
	if _, rerr := repo.Remote(remote); rerr != nil {
		return ErrNoRemote
	}

	//An empty source is git's "delete this ref on the remote" refspec
	err = repo.Push(&gogit.PushOptions{
		RemoteName: remote,
		RefSpecs:   []config.RefSpec{config.RefSpec(":" + branchRefPrefix + branch)},
		Auth:       buildAuth(req.Username, req.Token),
	})
	if err != nil && !errors.Is(err, gogit.NoErrAlreadyUpToDate) {
		return classifyError(err)
	}

	//Pruning is best effort: the branch is already gone on the server, so a
	//stale local pointer must not turn a success into a failure.
	repo.Storer.RemoveReference(plumbing.NewRemoteReferenceName(remote, branch))
	return nil
}

/*
RenameRemoteBranch renames a branch on the remote.

Git cannot rename a remote ref, so this pushes the branch under its new name and
then deletes the old one. The order matters: if the second push fails the branch
still exists under both names, which is recoverable, whereas deleting first could
lose it entirely.
*/
func (m *Manager) RenameRemoteBranch(realpath string, remote string, oldName string, newName string, req *TransportRequest) error {
	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)

	if err := validateBranchName(oldName); err != nil {
		return err
	}
	if err := validateBranchName(newName); err != nil {
		return err
	}
	if oldName == newName {
		return errors.New("the new name is the same as the current one")
	}
	if req == nil {
		req = &TransportRequest{}
	}
	remote = remoteOrName(remote)

	repo, err := m.open(realpath)
	if err != nil {
		return err
	}
	if _, rerr := repo.Remote(remote); rerr != nil {
		return ErrNoRemote
	}

	//The remote-tracking ref is the local record of what the remote holds, and
	//is a valid push source.
	sourceName := plumbing.NewRemoteReferenceName(remote, oldName)
	if _, rerr := repo.Reference(sourceName, false); rerr != nil {
		return errors.New("no such branch on " + remote + ": " + oldName)
	}

	auth := buildAuth(req.Username, req.Token)

	err = repo.Push(&gogit.PushOptions{
		RemoteName: remote,
		RefSpecs:   []config.RefSpec{config.RefSpec(sourceName.String() + ":" + branchRefPrefix + newName)},
		Auth:       auth,
	})
	if err != nil && !errors.Is(err, gogit.NoErrAlreadyUpToDate) {
		return classifyError(err)
	}

	//The new name now exists on the server; remove the old one.
	err = repo.Push(&gogit.PushOptions{
		RemoteName: remote,
		RefSpecs:   []config.RefSpec{config.RefSpec(":" + branchRefPrefix + oldName)},
		Auth:       auth,
	})
	if err != nil && !errors.Is(err, gogit.NoErrAlreadyUpToDate) {
		return errors.New(newName + " was created on " + remote +
			", but the old branch could not be removed: " + err.Error())
	}

	//Mirror the change locally so the branch list is correct without a fetch
	if oldRef, rerr := repo.Reference(sourceName, false); rerr == nil {
		repo.Storer.SetReference(plumbing.NewHashReference(
			plumbing.NewRemoteReferenceName(remote, newName), oldRef.Hash()))
		repo.Storer.RemoveReference(sourceName)
	}

	return nil
}

// branchIsMerged reports whether a branch tip is reachable from HEAD, i.e. its
// commits are already contained in the current branch.
func branchIsMerged(repo *gogit.Repository, branchHash plumbing.Hash) (bool, error) {
	head, err := repo.Head()
	if err != nil {
		//Nothing checked out to compare against
		return false, err
	}
	if head.Hash() == branchHash {
		return true, nil
	}

	//The walk is bounded (see maxAheadBehindWalk), so on a very large history a
	//long-since-merged branch may be reported as unmerged. That only costs the
	//user a confirmation prompt, never data.
	reachable, err := ancestorSet(repo, head.Hash())
	if err != nil {
		return false, err
	}

	_, merged := reachable[branchHash]
	return merged, nil
}

// removeBranchConfig deletes a branch's tracking configuration.
func removeBranchConfig(repo *gogit.Repository, branch string) {
	cfg, err := repo.Config()
	if err != nil || cfg.Branches == nil {
		return
	}
	if _, ok := cfg.Branches[branch]; !ok {
		return
	}

	delete(cfg.Branches, branch)
	repo.SetConfig(cfg)
}

// moveBranchConfig re-keys a branch's tracking configuration under a new name.
func moveBranchConfig(repo *gogit.Repository, oldName string, newName string) {
	cfg, err := repo.Config()
	if err != nil || cfg.Branches == nil {
		return
	}

	branchCfg, ok := cfg.Branches[oldName]
	if !ok {
		return
	}

	renamed := *branchCfg
	renamed.Name = newName
	cfg.Branches[newName] = &renamed
	delete(cfg.Branches, oldName)

	if err := cfg.Validate(); err != nil {
		//A config that will not validate must not be written back
		return
	}
	repo.SetConfig(cfg)
}

// splitRemoteRef breaks a remote-tracking ref into its remote and branch parts.
// "refs/remotes/origin/feature/login" yields ("origin", "feature/login").
func splitRemoteRef(fullRef string) (string, string) {
	trimmed := strings.TrimPrefix(fullRef, remoteRefPrefix)
	if trimmed == fullRef {
		//Not a remote-tracking ref
		return "", strings.TrimPrefix(fullRef, branchRefPrefix)
	}

	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) != 2 {
		return "", trimmed
	}
	return parts[0], parts[1]
}

// remoteOrName defaults a remote name to "origin".
func remoteOrName(remote string) string {
	remote = strings.TrimSpace(remote)
	if remote == "" {
		return defaultRemote
	}
	return remote
}
