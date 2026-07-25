package git

/*
	history_actions.go

	The operations behind the History tab's commit context menu, matching what
	GitHub Desktop offers: checkout, reset, branch/tag creation, revert,
	cherry-pick and message amend.

	Revert and cherry-pick deserve a note. go-git has no merge engine, so instead
	of attempting a three-way merge that could silently produce a wrong result,
	this package uses a "clean or refuse" strategy: a change is applied only when
	the files it touches still hold the exact content it expects, and otherwise
	the whole operation is refused with a readable message. That safely covers
	the common cases (reverting the latest commit, or an older commit whose files
	were not touched since) and never fabricates a bad tree.
*/

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// maxApplyBytes caps the size of a single blob revert/cherry-pick will rewrite,
// so one enormous asset cannot exhaust memory.
const maxApplyBytes = 50 * 1024 * 1024

// CheckoutCommit checks a commit out in detached HEAD state. The working tree
// must be clean, so no uncommitted work is silently discarded.
func (m *Manager) CheckoutCommit(realpath string, hash string) error {
	repo, tree, err := m.worktree(realpath)
	if err != nil {
		return err
	}

	commit, err := resolveCommit(repo, hash)
	if err != nil {
		return err
	}
	if err := requireCleanWorktree(tree); err != nil {
		return err
	}

	return tree.Checkout(&gogit.CheckoutOptions{Hash: commit.Hash})
}

// ResetToCommit moves the current branch to a commit. mode is "soft" (move HEAD
// only), "mixed" (also reset the index) or "hard" (also reset the working tree).
func (m *Manager) ResetToCommit(realpath string, hash string, mode string) error {
	repo, tree, err := m.worktree(realpath)
	if err != nil {
		return err
	}

	commit, err := resolveCommit(repo, hash)
	if err != nil {
		return err
	}

	resetMode, err := parseResetMode(mode)
	if err != nil {
		return err
	}

	//A hard reset throws away working tree changes; guard so it cannot happen
	//by surprise when the user has uncommitted work they forgot about.
	if resetMode == gogit.HardReset {
		if err := requireCleanWorktree(tree); err != nil {
			return errors.New("hard reset would discard your uncommitted changes — commit or discard them first")
		}
	}

	return tree.Reset(&gogit.ResetOptions{
		Commit: commit.Hash,
		Mode:   resetMode,
	})
}

// CreateBranchAt creates a branch pointing at a commit and checks it out.
func (m *Manager) CreateBranchAt(realpath string, branch string, hash string) error {
	branch = strings.TrimSpace(branch)
	if err := validateBranchName(branch); err != nil {
		return err
	}

	repo, tree, err := m.worktree(realpath)
	if err != nil {
		return err
	}

	commit, err := resolveCommit(repo, hash)
	if err != nil {
		return err
	}

	referenceName := plumbing.NewBranchReferenceName(branch)
	if _, rerr := repo.Reference(referenceName, false); rerr == nil {
		return errors.New("a branch named " + branch + " already exists")
	}

	if err := repo.Storer.SetReference(plumbing.NewHashReference(referenceName, commit.Hash)); err != nil {
		return err
	}

	return tree.Checkout(&gogit.CheckoutOptions{
		Branch: referenceName,
		Keep:   true,
	})
}

// CreateTag creates a tag at a commit. A non-empty message produces an
// annotated tag (signed by name / email, falling back to the repository's git
// config), otherwise a lightweight one.
func (m *Manager) CreateTag(realpath string, tag string, hash string, message string, name string, email string) error {
	tag = strings.TrimSpace(tag)
	if err := validateTagName(tag); err != nil {
		return err
	}

	repo, err := m.open(realpath)
	if err != nil {
		return err
	}

	commit, err := resolveCommit(repo, hash)
	if err != nil {
		return err
	}

	var options *gogit.CreateTagOptions
	if strings.TrimSpace(message) != "" {
		signature, serr := resolveSignature(repo, name, email)
		if serr != nil {
			return serr
		}
		options = &gogit.CreateTagOptions{
			Tagger:  signature,
			Message: message,
		}
	}

	_, err = repo.CreateTag(tag, commit.Hash, options)
	if errors.Is(err, gogit.ErrTagExists) {
		return errors.New("a tag named " + tag + " already exists")
	}
	return err
}

// TagsForCommit returns the names of tags pointing at a commit, resolving
// annotated tag objects to the commit they wrap.
func (m *Manager) TagsForCommit(realpath string, hash string) ([]string, error) {
	repo, err := m.open(realpath)
	if err != nil {
		return nil, err
	}
	commit, err := resolveCommit(repo, hash)
	if err != nil {
		return nil, err
	}

	tagMap, err := buildTagMap(repo)
	if err != nil {
		return nil, err
	}
	return tagMap[commit.Hash], nil
}

// RevertCommit creates a new commit that undoes a commit's changes. It is the
// reverse transition: from the commit's tree back to its parent's tree.
func (m *Manager) RevertCommit(realpath string, hash string, req *CommitRequest) (string, error) {
	repo, tree, err := m.worktree(realpath)
	if err != nil {
		return "", err
	}

	commit, err := resolveCommit(repo, hash)
	if err != nil {
		return "", err
	}
	if err := requireCleanWorktree(tree); err != nil {
		return "", errors.New("commit or discard your changes before reverting")
	}

	commitTree, err := commit.Tree()
	if err != nil {
		return "", err
	}

	//Reverting the changes means going from the commit back to its parent. The
	//root commit has no parent, so its parent state is the empty tree.
	var parentTree *object.Tree
	if commit.NumParents() > 0 {
		parent, perr := commit.Parent(0)
		if perr != nil {
			return "", perr
		}
		if parentTree, err = parent.Tree(); err != nil {
			return "", err
		}
	}

	if err := m.applyTransition(tree, commitTree, parentTree); err != nil {
		return "", err
	}

	message := req.Message
	if strings.TrimSpace(message) == "" {
		message = "Revert \"" + commitSubject(commit) + "\"\n\nThis reverts commit " + commit.Hash.String() + "."
	}

	return m.commitStaged(repo, tree, message, req, nil)
}

// CherryPickCommit applies a commit's changes onto the current HEAD. It is the
// forward transition: from the commit's parent tree to the commit's tree.
func (m *Manager) CherryPickCommit(realpath string, hash string, req *CommitRequest) (string, error) {
	repo, tree, err := m.worktree(realpath)
	if err != nil {
		return "", err
	}

	commit, err := resolveCommit(repo, hash)
	if err != nil {
		return "", err
	}
	if err := requireCleanWorktree(tree); err != nil {
		return "", errors.New("commit or discard your changes before cherry-picking")
	}

	commitTree, err := commit.Tree()
	if err != nil {
		return "", err
	}

	var parentTree *object.Tree
	if commit.NumParents() > 0 {
		parent, perr := commit.Parent(0)
		if perr != nil {
			return "", perr
		}
		if parentTree, err = parent.Tree(); err != nil {
			return "", err
		}
	}

	if err := m.applyTransition(tree, parentTree, commitTree); err != nil {
		return "", err
	}

	message := req.Message
	if strings.TrimSpace(message) == "" {
		message = commit.Message
	}

	//A cherry-pick keeps the original author but records the current user as the
	//committer, exactly like git does.
	originalAuthor := commit.Author
	return m.commitStaged(repo, tree, message, req, &originalAuthor)
}

// AmendCommitMessage rewrites the message of the HEAD commit, keeping its tree,
// parents and author. Only a branch tip can be amended.
func (m *Manager) AmendCommitMessage(realpath string, message string, req *CommitRequest) (string, error) {
	if strings.TrimSpace(message) == "" {
		return "", errors.New("commit message cannot be empty")
	}

	repo, err := m.open(realpath)
	if err != nil {
		return "", err
	}

	head, err := repo.Head()
	if err != nil {
		if errors.Is(err, plumbing.ErrReferenceNotFound) {
			return "", ErrUnbornBranch
		}
		return "", err
	}
	if !head.Name().IsBranch() {
		return "", errors.New("HEAD is detached — check out a branch before amending")
	}

	headCommit, err := repo.CommitObject(head.Hash())
	if err != nil {
		return "", err
	}

	committer, err := resolveSignature(repo, req.Name, req.Email)
	if err != nil {
		return "", err
	}

	amended := &object.Commit{
		Author:       headCommit.Author,
		Committer:    *committer,
		Message:      message,
		TreeHash:     headCommit.TreeHash,
		ParentHashes: headCommit.ParentHashes,
	}

	encoded := repo.Storer.NewEncodedObject()
	if err := amended.Encode(encoded); err != nil {
		return "", err
	}
	newHash, err := repo.Storer.SetEncodedObject(encoded)
	if err != nil {
		return "", err
	}

	if err := repo.Storer.SetReference(plumbing.NewHashReference(head.Name(), newHash)); err != nil {
		return "", err
	}
	return newHash.String(), nil
}

/*
applyTransition rewrites the working tree so that, for every path whose content
differs between fromTree and toTree, the file becomes its toTree version.

Before touching a file it checks the current (clean) working tree still matches
the fromTree version. If any file has diverged the whole operation is refused,
so a revert or cherry-pick either applies cleanly in full or not at all.
*/
func (m *Manager) applyTransition(tree *gogit.Worktree, fromTree *object.Tree, toTree *object.Tree) error {
	paths, err := unionTreePaths(fromTree, toTree)
	if err != nil {
		return err
	}

	repoRoot := tree.Filesystem.Root()
	applied := 0

	for _, path := range paths {
		fromContent, fromExists, ferr := treeBytes(fromTree, path)
		if ferr != nil {
			return ferr
		}
		toContent, toExists, terr := treeBytes(toTree, path)
		if terr != nil {
			return terr
		}

		//Unchanged by this transition — nothing to do
		if fromExists == toExists && bytes.Equal(fromContent, toContent) {
			continue
		}

		//The clean working tree must still hold the "from" version, otherwise
		//applying the change would need a real merge.
		currentContent, currentExists, cerr := worktreeBytes(repoRoot, path)
		if cerr != nil {
			return cerr
		}
		if currentExists != fromExists || !bytes.Equal(currentContent, fromContent) {
			return errors.New("cannot apply cleanly — " + path + " has changed since that commit; a manual merge is needed")
		}

		fullPath := filepath.Join(repoRoot, filepath.FromSlash(path))
		if toExists {
			if err := os.MkdirAll(filepath.Dir(fullPath), 0775); err != nil {
				return err
			}
			if err := os.WriteFile(fullPath, toContent, 0664); err != nil {
				return err
			}
		} else if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
			return err
		}

		if _, err := tree.Add(path); err != nil {
			return errors.New("cannot stage " + path + ": " + err.Error())
		}
		applied++
	}

	if applied == 0 {
		return errors.New("this commit introduces no change to apply")
	}
	return nil
}

// commitStaged writes a commit from the current index. author is used when the
// original author should be preserved (cherry-pick), otherwise the caller's or
// the repository's identity is used for both roles.
func (m *Manager) commitStaged(repo *gogit.Repository, tree *gogit.Worktree, message string, req *CommitRequest, author *object.Signature) (string, error) {
	if req == nil {
		req = &CommitRequest{}
	}

	committer, err := resolveSignature(repo, req.Name, req.Email)
	if err != nil {
		return "", err
	}

	commitAuthor := committer
	if author != nil {
		//Preserve the original author identity and date
		authorCopy := *author
		commitAuthor = &authorCopy
	}

	hash, err := tree.Commit(message, &gogit.CommitOptions{
		Author:    commitAuthor,
		Committer: committer,
	})
	if err != nil {
		if errors.Is(err, gogit.ErrEmptyCommit) {
			return "", errors.New("nothing to commit — the change is already present")
		}
		return "", err
	}
	return hash.String(), nil
}

// resolveCommit validates a hash and loads its commit object.
func resolveCommit(repo *gogit.Repository, hash string) (*object.Commit, error) {
	hash = strings.TrimSpace(hash)
	if !commitHashPattern.MatchString(hash) {
		return nil, errors.New("not a commit hash: " + hash)
	}
	commit, err := repo.CommitObject(plumbing.NewHash(hash))
	if err != nil {
		return nil, errors.New("no such commit: " + hash)
	}
	return commit, nil
}

// requireCleanWorktree refuses when there are uncommitted changes.
func requireCleanWorktree(tree *gogit.Worktree) error {
	status, err := tree.Status()
	if err != nil {
		return err
	}
	if !status.IsClean() {
		return errors.New("the working tree has uncommitted changes")
	}
	return nil
}

// parseResetMode maps the front-end vocabulary onto go-git's reset modes.
func parseResetMode(mode string) (gogit.ResetMode, error) {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "", "mixed":
		return gogit.MixedReset, nil
	case "soft":
		return gogit.SoftReset, nil
	case "hard":
		return gogit.HardReset, nil
	default:
		return gogit.MixedReset, errors.New("unknown reset mode: " + mode)
	}
}

// validateTagName rejects the ref-name characters git forbids in a tag.
func validateTagName(tag string) error {
	if tag == "" {
		return errors.New("tag name cannot be empty")
	}
	if err := plumbing.NewTagReferenceName(tag).Validate(); err != nil {
		return errors.New("invalid tag name: " + tag)
	}
	return nil
}

// commitSubject returns the first line of a commit message.
func commitSubject(commit *object.Commit) string {
	subject := commit.Message
	if index := strings.IndexByte(subject, '\n'); index >= 0 {
		subject = subject[:index]
	}
	return strings.TrimSpace(subject)
}

// buildTagMap indexes every tag by the commit hash it ultimately points at,
// following annotated tag objects to their target.
func buildTagMap(repo *gogit.Repository) (map[plumbing.Hash][]string, error) {
	tagMap := map[plumbing.Hash][]string{}

	iter, err := repo.Tags()
	if err != nil {
		return tagMap, err
	}
	defer iter.Close()

	err = iter.ForEach(func(ref *plumbing.Reference) error {
		name := ref.Name().Short()

		//Annotated tags are their own object wrapping the commit; lightweight
		//tags point straight at it.
		if tagObject, terr := repo.TagObject(ref.Hash()); terr == nil {
			if commit, cerr := tagObject.Commit(); cerr == nil {
				tagMap[commit.Hash] = append(tagMap[commit.Hash], name)
				return nil
			}
		}
		tagMap[ref.Hash()] = append(tagMap[ref.Hash()], name)
		return nil
	})
	return tagMap, err
}

// unionTreePaths lists every file path present in either tree.
func unionTreePaths(a *object.Tree, b *object.Tree) ([]string, error) {
	seen := map[string]struct{}{}

	for _, tree := range []*object.Tree{a, b} {
		if tree == nil {
			continue
		}
		iter := tree.Files()
		err := iter.ForEach(func(file *object.File) error {
			seen[file.Name] = struct{}{}
			return nil
		})
		iter.Close()
		if err != nil {
			return nil, err
		}
	}

	paths := make([]string, 0, len(seen))
	for path := range seen {
		paths = append(paths, path)
	}
	return paths, nil
}

// treeBytes reads a path from a tree, reporting whether it exists.
func treeBytes(tree *object.Tree, path string) ([]byte, bool, error) {
	if tree == nil {
		return nil, false, nil
	}

	file, err := tree.File(path)
	if err != nil {
		return nil, false, nil
	}
	if file.Size > maxApplyBytes {
		return nil, true, fmt.Errorf("%s is too large to apply", path)
	}

	reader, err := file.Reader()
	if err != nil {
		return nil, true, err
	}
	defer reader.Close()

	content, err := io.ReadAll(reader)
	if err != nil {
		return nil, true, err
	}
	return content, true, nil
}

// worktreeBytes reads a path from the working tree, reporting whether it exists.
func worktreeBytes(repoRoot string, path string) ([]byte, bool, error) {
	fullPath := filepath.Join(repoRoot, filepath.FromSlash(path))

	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, err
	}
	if info.IsDir() {
		return nil, false, nil
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, false, err
	}
	return content, true, nil
}
