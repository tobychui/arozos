package git

/*
	status.go

	Working tree status: the changed-file list that drives the GitApp sidebar,
	plus the ahead / behind counters shown on the "Push origin" button.
*/

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// maxAheadBehindWalk caps the history walk used for the ahead / behind counters
// so a huge repository cannot stall a status refresh.
const maxAheadBehindWalk = 5000

// Status returns a full snapshot of the repository at realpath.
func (m *Manager) Status(realpath string) (*RepoStatus, error) {
	repo, tree, err := m.worktree(realpath)
	if err != nil {
		return nil, err
	}

	status := &RepoStatus{
		Changes: []FileChange{},
		Remotes: []RemoteInfo{},
	}

	//Branch + HEAD. An unborn branch (fresh `git init`) is not an error: the
	//user should still see their untracked files so they can make a first commit.
	head, err := repo.Head()
	if err == nil {
		status.Detached = !head.Name().IsBranch()
		if head.Name().IsBranch() {
			status.Branch = head.Name().Short()
		}
		if commit, cerr := repo.CommitObject(head.Hash()); cerr == nil {
			status.Head = commitToInfo(commit)
		}
	} else if errors.Is(err, plumbing.ErrReferenceNotFound) {
		//Unborn branch: read the symbolic HEAD to learn the intended branch name
		if ref, rerr := repo.Reference(plumbing.HEAD, false); rerr == nil {
			status.Branch = ref.Target().Short()
		}
	} else {
		return nil, err
	}

	//Changed files
	worktreeStatus, err := tree.StatusWithOptions(gogit.StatusOptions{
		Strategy: gogit.Preload,
	})
	if err != nil {
		return nil, err
	}

	repoRoot := tree.Filesystem.Root()
	for path, fileStatus := range worktreeStatus {
		if fileStatus.Staging == gogit.Unmodified && fileStatus.Worktree == gogit.Unmodified {
			continue
		}
		status.Changes = append(status.Changes, buildFileChange(repoRoot, path, fileStatus))
	}

	sort.Slice(status.Changes, func(i, j int) bool {
		return status.Changes[i].Path < status.Changes[j].Path
	})

	status.Clean = len(status.Changes) == 0
	for _, change := range status.Changes {
		if change.Conflict {
			status.Conflicted = true
			break
		}
	}

	//Remotes
	if remotes, rerr := m.Remotes(realpath); rerr == nil {
		status.Remotes = remotes
	}

	//Upstream tracking + divergence. A missing upstream is normal (a branch that
	//was never pushed), so it is reported through Upstream being empty rather
	//than as an error.
	if status.Branch != "" {
		upstreamRef, upstreamName := resolveUpstream(repo, status.Branch)
		status.Upstream = upstreamName
		if upstreamRef != nil && status.Head != nil {
			ahead, behind, aerr := countAheadBehind(repo, plumbing.NewHash(status.Head.Hash), upstreamRef.Hash())
			if aerr == nil {
				status.Ahead = ahead
				status.Behind = behind
			}
		} else if upstreamName == "" && status.Head != nil {
			//Never pushed: every local commit counts as ahead so the UI can
			//offer "Publish branch" exactly like GitHub Desktop does.
			status.Ahead = countCommits(repo, plumbing.NewHash(status.Head.Hash))
		}
	}

	return status, nil
}

// buildFileChange converts one go-git status entry into the UI shape, adding
// the on-disk facts (size, binary-ness) the front-end needs to decide whether a
// diff can be rendered.
func buildFileChange(repoRoot string, path string, fileStatus *gogit.FileStatus) FileChange {
	change := FileChange{
		Path:     filepath.ToSlash(path),
		Staging:  statusCodeToString(fileStatus.Staging),
		Worktree: statusCodeToString(fileStatus.Worktree),
		Staged:   fileStatus.Staging != gogit.Unmodified && fileStatus.Staging != gogit.Untracked,
		Size:     -1,
		Preview:  PreviewKind(path),
	}

	if fileStatus.Extra != "" {
		change.OldPath = filepath.ToSlash(fileStatus.Extra)
	}

	//Summarised status: the working tree wins when it has something to say,
	//because that is the change the user is about to stage.
	change.Status = change.Worktree
	if change.Status == "unmodified" {
		change.Status = change.Staging
	}

	if fileStatus.Staging == gogit.UpdatedButUnmerged || fileStatus.Worktree == gogit.UpdatedButUnmerged {
		change.Conflict = true
		change.Status = "conflicted"
	}

	fullPath := filepath.Join(repoRoot, filepath.FromSlash(path))
	if info, err := os.Stat(fullPath); err == nil && !info.IsDir() {
		change.Size = info.Size()
		change.Binary = fileLooksBinary(fullPath)
	}

	return change
}

// statusCodeToString maps go-git's single-character status codes onto the
// vocabulary used across the AGI API and the front-end.
func statusCodeToString(code gogit.StatusCode) string {
	switch code {
	case gogit.Unmodified:
		return "unmodified"
	case gogit.Untracked:
		return "untracked"
	case gogit.Modified:
		return "modified"
	case gogit.Added:
		return "added"
	case gogit.Deleted:
		return "deleted"
	case gogit.Renamed:
		return "renamed"
	case gogit.Copied:
		return "copied"
	case gogit.UpdatedButUnmerged:
		return "conflicted"
	default:
		return "unknown"
	}
}

// resolveUpstream finds the remote tracking reference for a local branch,
// returning the reference and its display name (e.g. "origin/master"). Both are
// zero when the branch has no upstream configured.
func resolveUpstream(repo *gogit.Repository, branch string) (*plumbing.Reference, string) {
	cfg, err := repo.Config()
	if err != nil {
		return nil, ""
	}

	branchCfg, ok := cfg.Branches[branch]
	remoteName := "origin"
	if ok && branchCfg.Remote != "" {
		remoteName = branchCfg.Remote
	}

	trackingName := plumbing.NewRemoteReferenceName(remoteName, branch)
	ref, err := repo.Reference(trackingName, true)
	if err != nil {
		return nil, ""
	}
	return ref, remoteName + "/" + branch
}

// countAheadBehind implements `git rev-list --left-right --count local...remote`
// by diffing the two ancestor sets.
func countAheadBehind(repo *gogit.Repository, local plumbing.Hash, remote plumbing.Hash) (int, int, error) {
	localSet, err := ancestorSet(repo, local)
	if err != nil {
		return 0, 0, err
	}
	remoteSet, err := ancestorSet(repo, remote)
	if err != nil {
		return 0, 0, err
	}

	ahead := 0
	for hash := range localSet {
		if _, shared := remoteSet[hash]; !shared {
			ahead++
		}
	}

	behind := 0
	for hash := range remoteSet {
		if _, shared := localSet[hash]; !shared {
			behind++
		}
	}

	return ahead, behind, nil
}

// ancestorSet collects the hashes reachable from start, bounded by
// maxAheadBehindWalk.
func ancestorSet(repo *gogit.Repository, start plumbing.Hash) (map[plumbing.Hash]struct{}, error) {
	seen := map[plumbing.Hash]struct{}{}
	if start.IsZero() {
		return seen, nil
	}

	commit, err := repo.CommitObject(start)
	if err != nil {
		return seen, err
	}

	iter := object.NewCommitPreorderIter(commit, nil, nil)
	defer iter.Close()

	count := 0
	err = iter.ForEach(func(c *object.Commit) error {
		seen[c.Hash] = struct{}{}
		count++
		if count >= maxAheadBehindWalk {
			return storerStop
		}
		return nil
	})
	if err != nil && !errors.Is(err, storerStop) {
		return seen, err
	}
	return seen, nil
}

// countCommits returns the number of commits reachable from start, capped by
// maxAheadBehindWalk.
func countCommits(repo *gogit.Repository, start plumbing.Hash) int {
	set, err := ancestorSet(repo, start)
	if err != nil {
		return 0
	}
	return len(set)
}

// storerStop terminates a commit walk early without being treated as a failure.
var storerStop = errors.New("walk limit reached")

// fileLooksBinary applies the heuristic git itself uses: a NUL byte inside the
// first 8000 bytes means "binary".
func fileLooksBinary(fullPath string) bool {
	file, err := os.Open(fullPath)
	if err != nil {
		return false
	}
	defer file.Close()

	buffer := make([]byte, 8000)
	read, err := file.Read(buffer)
	if err != nil && read == 0 {
		return false
	}
	return strings.IndexByte(string(buffer[:read]), 0) >= 0
}

// commitToInfo converts a go-git commit into the wire type.
func commitToInfo(commit *object.Commit) *CommitInfo {
	if commit == nil {
		return nil
	}

	parents := []string{}
	for _, parent := range commit.ParentHashes {
		parents = append(parents, parent.String())
	}

	hash := commit.Hash.String()
	shortHash := hash
	if len(shortHash) > 7 {
		shortHash = shortHash[:7]
	}

	message := commit.Message
	subject := message
	if index := strings.IndexByte(subject, '\n'); index >= 0 {
		subject = subject[:index]
	}

	return &CommitInfo{
		Hash:        hash,
		ShortHash:   shortHash,
		Message:     message,
		Subject:     strings.TrimSpace(subject),
		AuthorName:  commit.Author.Name,
		AuthorEmail: commit.Author.Email,
		Timestamp:   commit.Author.When.Unix(),
		Parents:     parents,
	}
}
