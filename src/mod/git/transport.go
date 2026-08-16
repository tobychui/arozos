package git

/*
	transport.go

	Network operations — fetch, pull and push — plus the HTTPS basic-auth
	construction shared by all of them and by Clone.

	Only HTTPS (and plain HTTP) with a username + token/password is supported in
	this version; that covers personal access tokens on GitHub, GitLab, Gitea and
	Bitbucket. Failures are run through classifyError so the caller can tell an
	"ask the user for credentials" case apart from a real network error.
*/

import (
	"errors"
	"net/url"
	"strings"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/transport"
	githttp "github.com/go-git/go-git/v5/plumbing/transport/http"
)

// defaultRemote is used whenever a request does not name one.
const defaultRemote = "origin"

// buildAuth returns the go-git auth method for a username / token pair, or nil
// when neither is set (anonymous access to a public repository).
func buildAuth(username string, token string) transport.AuthMethod {
	username = strings.TrimSpace(username)
	token = strings.TrimSpace(token)

	if username == "" && token == "" {
		return nil
	}

	//Token-only is valid for several hosts (GitHub accepts any non-empty user
	//name alongside a PAT), so fill in a placeholder rather than failing.
	if username == "" {
		username = "git"
	}

	return &githttp.BasicAuth{
		Username: username,
		Password: token,
	}
}

// Fetch updates the remote-tracking refs without touching the working tree.
func (m *Manager) Fetch(realpath string, req *TransportRequest) error {
	repo, err := m.open(realpath)
	if err != nil {
		return err
	}

	remoteName := remoteOrDefault(req)
	err = repo.Fetch(&gogit.FetchOptions{
		RemoteName: remoteName,
		Auth:       buildAuth(req.Username, req.Token),
		Tags:       gogit.TagFollowing,
	})

	if errors.Is(err, gogit.NoErrAlreadyUpToDate) {
		return nil
	}
	if errors.Is(err, gogit.ErrRemoteNotFound) {
		return ErrNoRemote
	}
	return classifyError(err)
}

// Pull fetches and merges the upstream branch into the working tree. go-git
// only performs fast-forward merges, so a diverged branch surfaces as a
// non-fast-forward error which is passed through verbatim.
func (m *Manager) Pull(realpath string, req *TransportRequest) (string, error) {
	_, tree, err := m.worktree(realpath)
	if err != nil {
		return "", err
	}

	options := &gogit.PullOptions{
		RemoteName: remoteOrDefault(req),
		Auth:       buildAuth(req.Username, req.Token),
	}
	if req.Branch != "" {
		if err := validateBranchName(req.Branch); err != nil {
			return "", err
		}
		options.ReferenceName = plumbing.NewBranchReferenceName(req.Branch)
	}

	err = tree.Pull(options)
	if errors.Is(err, gogit.NoErrAlreadyUpToDate) {
		return "already up to date", nil
	}
	if errors.Is(err, gogit.ErrRemoteNotFound) {
		return "", ErrNoRemote
	}
	if err != nil {
		if errors.Is(err, gogit.ErrNonFastForwardUpdate) {
			return "", errors.New("local and remote branches have diverged — merge manually before pulling")
		}
		return "", classifyError(err)
	}

	return "pulled successfully", nil
}

// Push sends the current (or named) branch to the remote. When SetUpstream is
// set the branch is configured to track the remote afterwards, so the next
// status call can report ahead / behind counters.
func (m *Manager) Push(realpath string, req *TransportRequest) (string, error) {
	repo, err := m.open(realpath)
	if err != nil {
		return "", err
	}

	branch := strings.TrimSpace(req.Branch)
	if branch == "" {
		head, herr := repo.Head()
		if herr != nil {
			return "", ErrUnbornBranch
		}
		if !head.Name().IsBranch() {
			return "", errors.New("HEAD is detached — check out a branch before pushing")
		}
		branch = head.Name().Short()
	}
	if err := validateBranchName(branch); err != nil {
		return "", err
	}

	remoteName := remoteOrDefault(req)
	refSpec := config.RefSpec("refs/heads/" + branch + ":refs/heads/" + branch)
	if req.Force {
		refSpec = config.RefSpec("+" + refSpec.String())
	}

	err = repo.Push(&gogit.PushOptions{
		RemoteName: remoteName,
		RefSpecs:   []config.RefSpec{refSpec},
		Auth:       buildAuth(req.Username, req.Token),
		Force:      req.Force,
	})

	if errors.Is(err, gogit.NoErrAlreadyUpToDate) {
		return "everything up to date", nil
	}
	if errors.Is(err, gogit.ErrRemoteNotFound) {
		return "", ErrNoRemote
	}
	if err != nil {
		if errors.Is(err, gogit.ErrNonFastForwardUpdate) {
			return "", errors.New("remote has commits you do not have locally — pull first")
		}
		return "", classifyError(err)
	}

	if req.SetUpstream {
		if terr := setUpstream(repo, branch, remoteName); terr != nil {
			//Tracking is a convenience; a successful push should not be
			//reported as a failure because the config write did not stick.
			return "pushed to " + remoteName + "/" + branch, nil
		}
	}

	return "pushed to " + remoteName + "/" + branch, nil
}

// setUpstream records branch.<name>.remote / .merge so the branch tracks the
// remote, mirroring `git push -u`.
func setUpstream(repo *gogit.Repository, branch string, remoteName string) error {
	cfg, err := repo.Config()
	if err != nil {
		return err
	}

	if cfg.Branches == nil {
		cfg.Branches = map[string]*config.Branch{}
	}
	cfg.Branches[branch] = &config.Branch{
		Name:   branch,
		Remote: remoteName,
		Merge:  plumbing.NewBranchReferenceName(branch),
	}

	return repo.SetConfig(cfg)
}

// remoteOrDefault reads the remote name from a request, defaulting to "origin".
func remoteOrDefault(req *TransportRequest) string {
	if req == nil || strings.TrimSpace(req.Remote) == "" {
		return defaultRemote
	}
	return strings.TrimSpace(req.Remote)
}

// RemoteHost extracts the host of a git remote URL so credentials can be stored
// and looked up per hosting service. SCP-style addresses (git@host:owner/repo)
// are understood as well as regular URLs.
func RemoteHost(remoteURL string) string {
	remoteURL = strings.TrimSpace(remoteURL)
	if remoteURL == "" {
		return ""
	}

	if parsed, err := url.Parse(remoteURL); err == nil && parsed.Host != "" {
		return strings.ToLower(parsed.Hostname())
	}

	//scp-like syntax: [user@]host:path
	trimmed := remoteURL
	if index := strings.Index(trimmed, "@"); index >= 0 {
		trimmed = trimmed[index+1:]
	}
	if index := strings.Index(trimmed, ":"); index >= 0 {
		trimmed = trimmed[:index]
	}
	return strings.ToLower(strings.TrimSpace(trimmed))
}

// RemoteURLForName returns the first configured URL of a remote, used to work
// out which stored credential applies to an operation.
func (m *Manager) RemoteURLForName(realpath string, name string) (string, error) {
	remotes, err := m.Remotes(realpath)
	if err != nil {
		return "", err
	}
	if name == "" {
		name = defaultRemote
	}

	for _, remote := range remotes {
		if remote.Name == name && len(remote.URLs) > 0 {
			return remote.URLs[0], nil
		}
	}
	return "", ErrNoRemote
}
