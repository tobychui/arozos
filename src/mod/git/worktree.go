package git

/*
	worktree.go

	Index and working tree mutations: staging, unstaging, discarding and
	committing.

	The GitApp UI follows the GitHub Desktop model where the user ticks the files
	that belong in the next commit rather than maintaining a long lived staging
	area, so Commit accepts an explicit file list and stages it immediately
	before writing the commit object.
*/

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"

	"imuslab.com/arozos/mod/info/logger"
)

// Add stages the given repo-relative paths. Deleted paths are removed from the
// index, which is what go-git's Add already does for a missing file.
func (m *Manager) Add(realpath string, files []string) (out0 error) {
	defer logger.Out1(logger.In3("git", "Manager.Add", "m", m, "realpath", realpath, "files", files), &out0)
	_, tree, err := m.worktree(realpath)
	if err != nil {
		logger.DebugErr("git", err)
		return err
	}

	for _, file := range files {
		cleaned, err := cleanRepoPath(file)
		if err != nil {
			logger.DebugErr("git", err)
			return err
		}
		if _, err := tree.Add(cleaned); err != nil {
			logger.DebugErr("git", err)
			return errors.New("cannot stage " + cleaned + ": " + err.Error())
		}
	}
	return nil
}

// AddAll stages every change in the working tree, equivalent to `git add -A`.
func (m *Manager) AddAll(realpath string) (out0 error) {
	defer logger.Out1(logger.In2("git", "Manager.AddAll", "m", m, "realpath", realpath), &out0)
	_, tree, err := m.worktree(realpath)
	if err != nil {
		logger.DebugErr("git", err)
		return err
	}

	return tree.AddWithOptions(&gogit.AddOptions{All: true})
}

// Unstage removes the given paths from the index while leaving the working tree
// untouched, equivalent to `git restore --staged`.
func (m *Manager) Unstage(realpath string, files []string) (out0 error) {
	defer logger.Out1(logger.In3("git", "Manager.Unstage", "m", m, "realpath", realpath, "files", files), &out0)
	_, tree, err := m.worktree(realpath)
	if err != nil {
		logger.DebugErr("git", err)
		return err
	}

	cleanedFiles, err := cleanRepoPaths(files)
	if err != nil {
		logger.DebugErr("git", err)
		return err
	}
	if len(cleanedFiles) == 0 {
		return errors.New("no files given to unstage")
	}

	return tree.Restore(&gogit.RestoreOptions{
		Staged: true,
		Files:  cleanedFiles,
	})
}

// Discard throws away the working tree changes of the given paths, restoring
// them from the index (`git restore`). Untracked files have nothing to restore
// from, so they are deleted instead — the same thing GitHub Desktop's "Discard
// changes" does.
func (m *Manager) Discard(realpath string, files []string) (out0 error) {
	defer logger.Out1(logger.In3("git", "Manager.Discard", "m", m, "realpath", realpath, "files", files), &out0)
	_, tree, err := m.worktree(realpath)
	if err != nil {
		logger.DebugErr("git", err)
		return err
	}

	cleanedFiles, err := cleanRepoPaths(files)
	if err != nil {
		logger.DebugErr("git", err)
		return err
	}
	if len(cleanedFiles) == 0 {
		return errors.New("no files given to discard")
	}

	status, err := tree.Status()
	if err != nil {
		logger.DebugErr("git", err)
		return err
	}

	restorable := []string{}
	repoRoot := tree.Filesystem.Root()
	for _, file := range cleanedFiles {
		if fileStatus, ok := status[file]; ok && fileStatus.Worktree == gogit.Untracked {
			//Never tracked: removing the file is the only possible "discard"
			if err := os.Remove(filepath.Join(repoRoot, filepath.FromSlash(file))); err != nil && !os.IsNotExist(err) {
				return err
			}
			continue
		}
		restorable = append(restorable, file)
	}

	if len(restorable) == 0 {
		return nil
	}

	return tree.Restore(&gogit.RestoreOptions{
		Staged:   true,
		Worktree: true,
		Files:    restorable,
	})
}

// Commit stages req.Files (or every tracked change when req.All is set) and
// writes a commit. The new commit hash is returned.
func (m *Manager) Commit(realpath string, req *CommitRequest) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("git", "Manager.Commit", "m", m, "realpath", realpath, "req", req), &out0, &out1)
	if req == nil || strings.TrimSpace(req.Message) == "" {
		return "", errors.New("commit message cannot be empty")
	}

	repo, tree, err := m.worktree(realpath)
	if err != nil {
		logger.DebugErr("git", err)
		return "", err
	}

	if req.All {
		if err := tree.AddWithOptions(&gogit.AddOptions{All: true}); err != nil {
			logger.DebugErr("git", err)
			return "", err
		}
	} else if len(req.Files) > 0 {
		if err := m.Add(realpath, req.Files); err != nil {
			logger.DebugErr("git", err)
			return "", err
		}
	}

	signature, err := resolveSignature(repo, req.Name, req.Email)
	if err != nil {
		logger.DebugErr("git", err)
		return "", err
	}

	hash, err := tree.Commit(req.Message, &gogit.CommitOptions{
		Author:    signature,
		Committer: signature,
	})
	if err != nil {
		logger.DebugErr("git", err)
		if errors.Is(err, gogit.ErrEmptyCommit) {
			return "", errors.New("nothing to commit — select at least one changed file")
		}
		return "", err
	}

	return hash.String(), nil
}

// resolveSignature builds the author signature, preferring the values passed by
// the caller and falling back to the repository's own git config. go-git
// refuses to commit without an author, so an explicit error beats its generic
// validation message.
func resolveSignature(repo *gogit.Repository, name string, email string) (out0 *object.Signature, out1 error) {
	defer logger.Out2(logger.In3("git", "resolveSignature", "repo", repo, "name", name, "email", email), &out0, &out1)
	name = strings.TrimSpace(name)
	email = strings.TrimSpace(email)

	if name == "" || email == "" {
		//Only the repository's own config is consulted. Reading the host's
		//global gitconfig would leak the identity of whoever runs the ArozOS
		//process into every user's commits.
		if cfg, err := repo.Config(); err == nil {
			if name == "" {
				name = cfg.User.Name
			}
			if email == "" {
				email = cfg.User.Email
			}
		}
	}

	if name == "" {
		return nil, errors.New("commit author name is required — set it in GitApp settings")
	}
	if email == "" {
		//An address is mandatory in the commit object format; synthesise a
		//local one rather than blocking the commit.
		email = sanitiseLocalEmail(name)
	}

	return &object.Signature{
		Name:  name,
		Email: email,
		When:  time.Now(),
	}, nil
}

// sanitiseLocalEmail turns an author name into a usable placeholder address for
// users who never configured one.
func sanitiseLocalEmail(name string) (out0 string) {
	defer logger.Out1(logger.In1("git", "sanitiseLocalEmail", "name", name), &out0)
	local := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			return r
		case r >= 'A' && r <= 'Z':
			return r + 32
		default:
			return -1
		}
	}, name)

	if local == "" {
		local = "user"
	}
	return local + "@arozos.local"
}

// cleanRepoPaths normalises a list of repo-relative paths, dropping empties.
func cleanRepoPaths(files []string) (out0 []string, out1 error) {
	defer logger.Out2(logger.In1("git", "cleanRepoPaths", "files", files), &out0, &out1)
	results := []string{}
	for _, file := range files {
		if strings.TrimSpace(file) == "" {
			continue
		}
		cleaned, err := cleanRepoPath(file)
		if err != nil {
			logger.DebugErr("git", err)
			return nil, err
		}
		results = append(results, cleaned)
	}
	return results, nil
}

// cleanRepoPath validates that a path stays inside the repository. Paths come
// from the browser, so a "../" escape must never reach the filesystem.
func cleanRepoPath(file string) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("git", "cleanRepoPath", "file", file), &out0, &out1)
	//Treat backslashes as separators on every platform. filepath.Clean only
	//knows the host separator, so a Windows-style path would otherwise slip
	//through unchanged on Linux and fail the cross-platform checks below.
	normalized := strings.ReplaceAll(strings.TrimSpace(file), "\\", "/")
	cleaned := filepath.ToSlash(filepath.Clean(normalized))
	cleaned = strings.TrimPrefix(cleaned, "./")

	if cleaned == "" || cleaned == "." {
		return "", errors.New("empty file path")
	}
	if strings.HasPrefix(cleaned, "../") || cleaned == ".." || strings.HasPrefix(cleaned, "/") {
		return "", errors.New("path escapes the repository: " + file)
	}
	if filepath.IsAbs(cleaned) {
		return "", errors.New("absolute paths are not accepted: " + file)
	}

	return cleaned, nil
}
