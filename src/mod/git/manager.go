package git

/*
	manager.go

	Core Manager type plus repository discovery / creation.

	Everything in this package is built on go-git (pure Go, already a direct
	dependency of the project — see mod/modules/installer.go). No `git` binary is
	ever invoked, so the feature cross-compiles to every target in the Makefile
	and needs no host package installed.
*/

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"imuslab.com/arozos/mod/info/logger"
)

// Options configures a Manager.
type Options struct {
	//Database is the ArozOS system database used to persist credentials.
	//A nil Database disables the credential store (operations still work with
	//credentials passed per call).
	Database CredentialDatabase

	//KeyStorePath is the folder holding the AES key that encrypts stored
	//credentials, e.g. "./system/git". Created on demand.
	KeyStorePath string

	//Logger is the system-wide logger. Optional.
	Logger *logger.Logger
}

// Manager is the entry point for all git operations. It is stateless with
// respect to repositories: every call resolves the repository from the real
// path it is given, so concurrent operations on different repos never contend.
type Manager struct {
	options     *Options
	credentials *CredentialStore
}

// NewManager builds a Manager. It only fails when the credential store cannot
// be initialised; git operations themselves have no host prerequisites.
func NewManager(options Options) (*Manager, error) {
	manager := &Manager{options: &options}

	if options.Database != nil {
		store, err := newCredentialStore(options.Database, options.KeyStorePath)
		if err != nil {
			return nil, err
		}
		manager.credentials = store
	}

	return manager, nil
}

// Credentials exposes the credential store. Returns nil when no database was
// wired in.
func (m *Manager) Credentials() *CredentialStore {
	return m.credentials
}

// IsRepo reports whether realpath is inside a git working tree. A bare .git
// folder counts, a plain folder does not.
func (m *Manager) IsRepo(realpath string) bool {
	_, err := m.open(realpath)
	return err == nil
}

// RepoRoot returns the working tree root containing realpath. Used so the UI can
// accept any folder inside a repository and still operate on the whole repo.
func (m *Manager) RepoRoot(realpath string) (string, error) {
	current, err := filepath.Abs(realpath)
	if err != nil {
		return "", err
	}

	for {
		if isDir(filepath.Join(current, ".git")) || isFile(filepath.Join(current, ".git")) {
			return filepath.ToSlash(current), nil
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", ErrNotARepo
		}
		current = parent
	}
}

// Init creates an empty repository at realpath, creating the folder when it
// does not exist yet.
func (m *Manager) Init(realpath string) error {
	if err := os.MkdirAll(realpath, 0775); err != nil {
		return err
	}

	if m.IsRepo(realpath) {
		return errors.New("a git repository already exists at this location")
	}

	_, err := gogit.PlainInit(realpath, false)
	return err
}

// Clone clones req.URL into req.Dest. The destination must not exist or must be
// an empty folder — go-git refuses to clone into a populated directory, and we
// check up front so the caller gets a readable message instead of a low level
// one.
func (m *Manager) Clone(req *CloneRequest) error {
	if strings.TrimSpace(req.URL) == "" {
		return errors.New("remote URL cannot be empty")
	}
	if strings.TrimSpace(req.Dest) == "" {
		return errors.New("clone destination cannot be empty")
	}

	empty, err := dirIsEmpty(req.Dest)
	if err != nil {
		return err
	}
	if !empty {
		return errors.New("clone destination is not empty")
	}

	//Remember whether the folder was already there: a failed clone should clean
	//up after itself without deleting a folder the user created.
	destExisted := isDir(req.Dest)

	if err := os.MkdirAll(req.Dest, 0775); err != nil {
		return err
	}

	cloneOptions := &gogit.CloneOptions{
		URL:   req.URL,
		Depth: req.Depth,
		Auth:  buildAuth(req.Username, req.Token),
	}

	if req.Branch != "" {
		cloneOptions.ReferenceName = plumbing.NewBranchReferenceName(req.Branch)
		cloneOptions.SingleBranch = true
	}

	if _, err := gogit.PlainClone(req.Dest, false, cloneOptions); err != nil {
		//A failed clone leaves a half written folder behind. Clear it so the
		//user can retry into the same path (e.g. after fixing credentials).
		if destExisted {
			emptyDir(req.Dest)
		} else {
			os.RemoveAll(req.Dest)
		}
		return classifyError(err)
	}

	return nil
}

// Remotes lists the configured remotes of the repository at realpath.
func (m *Manager) Remotes(realpath string) ([]RemoteInfo, error) {
	repo, err := m.open(realpath)
	if err != nil {
		return nil, err
	}

	remotes, err := repo.Remotes()
	if err != nil {
		return nil, err
	}

	results := []RemoteInfo{}
	for _, remote := range remotes {
		cfg := remote.Config()
		results = append(results, RemoteInfo{
			Name: cfg.Name,
			URLs: cfg.URLs,
		})
	}
	return results, nil
}

// AddRemote registers a new remote. Passing an existing name replaces its URLs.
func (m *Manager) AddRemote(realpath string, name string, url string) error {
	if strings.TrimSpace(name) == "" || strings.TrimSpace(url) == "" {
		return errors.New("remote name and URL are both required")
	}

	repo, err := m.open(realpath)
	if err != nil {
		return err
	}

	if _, err := repo.Remote(name); err == nil {
		if err := repo.DeleteRemote(name); err != nil {
			return err
		}
	}

	_, err = repo.CreateRemote(&config.RemoteConfig{
		Name: name,
		URLs: []string{url},
	})
	return err
}

// RemoveRemote deletes a remote by name.
func (m *Manager) RemoveRemote(realpath string, name string) error {
	repo, err := m.open(realpath)
	if err != nil {
		return err
	}
	return repo.DeleteRemote(name)
}

// open resolves realpath to a repository, walking up to the working tree root
// so callers may pass any path inside the repo.
func (m *Manager) open(realpath string) (*gogit.Repository, error) {
	repo, err := gogit.PlainOpenWithOptions(realpath, &gogit.PlainOpenOptions{
		DetectDotGit: true,
	})
	if err != nil {
		if errors.Is(err, gogit.ErrRepositoryNotExists) {
			return nil, ErrNotARepo
		}
		return nil, err
	}
	return repo, nil
}

// worktree resolves realpath to a repository and its working tree in one go.
func (m *Manager) worktree(realpath string) (*gogit.Repository, *gogit.Worktree, error) {
	repo, err := m.open(realpath)
	if err != nil {
		return nil, nil, err
	}

	tree, err := repo.Worktree()
	if err != nil {
		return nil, nil, err
	}
	return repo, tree, nil
}

// dirIsEmpty reports whether path is absent or an empty directory.
func dirIsEmpty(path string) (bool, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		if os.IsNotExist(err) {
			return true, nil
		}
		return false, err
	}
	return len(entries) == 0, nil
}

// emptyDir removes everything inside path but keeps the folder itself.
func emptyDir(path string) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return
	}
	for _, entry := range entries {
		os.RemoveAll(filepath.Join(path, entry.Name()))
	}
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
