package agi

/*
	AGI Git Library
	Author: tobychui

	This library gives AGI scripts version control over folders inside the
	user's virtual file system: clone, status, stage, commit, branch, diff,
	fetch, pull and push, plus a per-user encrypted store for HTTPS credentials.

	Everything is backed by mod/git, which uses go-git — no `git` binary is
	required on the host, so this works identically on every platform ArozOS
	builds for.

	Usage (from an AGI script):
		requirelib("git");
		if (git.isRepo("user:/Desktop/myproject")) {
			var status = git.status("user:/Desktop/myproject");
			console.log(status.branch, status.changes.length);
		}

	Path rules:
	  - Every path is an ArozOS virtual path and is permission checked.
	  - Read-only calls need read permission, mutating calls need write
	    permission on the repository path.
	  - The storage pool must be local: network-backed pools (WebDAV, SMB, S3, …)
	    cannot host a git working tree because git needs real random-access files.
*/

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/git"
	"imuslab.com/arozos/mod/info/logger"
	user "imuslab.com/arozos/mod/user"
)

func (g *Gateway) GitLibRegister() {
	err := g.RegisterLib("git", g.injectGitLibFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

func (g *Gateway) injectGitLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh
	manager := g.Option.GitManager

	// resolveRepo turns a virtual path into a real one after checking the
	// user's permission and that the storage pool can host a repository.
	resolveRepo := func(vpath string, needWrite bool) (string, error) {
		if manager == nil {
			return "", errors.New("git support is not enabled on this system")
		}
		if strings.TrimSpace(vpath) == "" {
			return "", errors.New("repository path cannot be empty")
		}

		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		if needWrite {
			if !u.CanWrite(vpath) {
				return "", errors.New("path access denied: " + vpath)
			}
		} else if !u.CanRead(vpath) {
			return "", errors.New("path access denied: " + vpath)
		}

		fsh, rpath, err := static.VirtualPathToRealPath(vpath, u)
		if err != nil {
			return "", err
		}
		if err := checkFshSupportsGit(fsh); err != nil {
			return "", err
		}

		return rpath, nil
	}

	// git.isRepo(vpath) -> bool
	vm.Set("_git_isrepo", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			return otto.FalseValue()
		}

		rpath, err := resolveRepo(vpath, false)
		if err != nil {
			return otto.FalseValue()
		}

		if manager.IsRepo(rpath) {
			return otto.TrueValue()
		}
		return otto.FalseValue()
	})

	// git.repoRoot(vpath) -> virtual path of the working tree root, or false
	vm.Set("_git_reporoot", func(call otto.FunctionCall) otto.Value {
		vpath, err := call.Argument(0).ToString()
		if err != nil {
			return otto.FalseValue()
		}
		vpath = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		rpath, err := resolveRepo(vpath, false)
		if err != nil {
			return otto.FalseValue()
		}

		realRoot, err := manager.RepoRoot(rpath)
		if err != nil {
			return otto.FalseValue()
		}

		//The root is mapped back by trimming the virtual path, never by
		//converting the real path: RepoRoot returns an absolute OS path while
		//the file system abstraction strips its storage root by prefix match,
		//so handing it back would leave the whole absolute path embedded in
		//the vpath and double it on the next translation.
		rootVpath, err := repoRootVirtualPath(vpath, rpath, realRoot)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		result, _ := vm.ToValue(rootVpath)
		return result
	})

	// git.init(vpath) -> {success, error}
	vm.Set("_git_init", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		rpath, err := resolveRepo(vpath, true)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		if err := manager.Init(rpath); err != nil {
			return gitOperationFailure(vm, err)
		}
		return gitOperationSuccess(vm, "")
	})

	// git.clone(url, destVpath, options) -> {success, error, authRequired}
	vm.Set("_git_clone", func(call otto.FunctionCall) otto.Value {
		url, _ := call.Argument(0).ToString()
		vpath, _ := call.Argument(1).ToString()
		options := exportOptions(call.Argument(2))

		rpath, err := resolveRepo(vpath, true)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		username, token := g.resolveGitCredential(u, url, options)
		err = manager.Clone(&git.CloneRequest{
			URL:      url,
			Dest:     rpath,
			Branch:   optionString(options, "branch"),
			Depth:    optionInt(options, "depth"),
			Username: username,
			Token:    token,
		})
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		//Remember the credential when the caller asked us to, now that we know
		//it actually works.
		g.rememberGitCredential(u, url, options)
		return gitOperationSuccess(vm, "cloned into "+vpath)
	})

	// git.status(vpath) -> status object
	vm.Set("_git_status", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		rpath, err := resolveRepo(vpath, false)
		if err != nil {
			return gitJSONError(vm, err)
		}

		status, err := manager.Status(rpath)
		if err != nil {
			return gitJSONError(vm, err)
		}
		status.Path = static.RelativeVpathRewrite(scriptFsh, vpath, vm, u)

		return gitJSONValue(vm, status)
	})

	// git.log(vpath, limit) -> [commit, ...]
	vm.Set("_git_log", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		limit := 0
		if !call.Argument(1).IsUndefined() {
			if parsed, err := call.Argument(1).ToInteger(); err == nil {
				limit = int(parsed)
			}
		}

		rpath, err := resolveRepo(vpath, false)
		if err != nil {
			return gitJSONError(vm, err)
		}

		commits, err := manager.Log(rpath, limit)
		if err != nil {
			return gitJSONError(vm, err)
		}
		return gitJSONValue(vm, commits)
	})

	// git.branches(vpath) -> [branch, ...]
	vm.Set("_git_branches", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		rpath, err := resolveRepo(vpath, false)
		if err != nil {
			return gitJSONError(vm, err)
		}

		branches, err := manager.Branches(rpath)
		if err != nil {
			return gitJSONError(vm, err)
		}
		return gitJSONValue(vm, branches)
	})

	// git.checkout(vpath, branch, create) -> {success, error}
	vm.Set("_git_checkout", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		branch, _ := call.Argument(1).ToString()
		create, _ := call.Argument(2).ToBoolean()

		rpath, err := resolveRepo(vpath, true)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		if err := manager.Checkout(rpath, branch, create); err != nil {
			return gitOperationFailure(vm, err)
		}
		return gitOperationSuccess(vm, "switched to "+branch)
	})

	// git.remotes(vpath) -> [remote, ...]
	vm.Set("_git_remotes", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		rpath, err := resolveRepo(vpath, false)
		if err != nil {
			return gitJSONError(vm, err)
		}

		remotes, err := manager.Remotes(rpath)
		if err != nil {
			return gitJSONError(vm, err)
		}
		return gitJSONValue(vm, remotes)
	})

	// git.addRemote(vpath, name, url) -> {success, error}
	vm.Set("_git_addremote", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		name, _ := call.Argument(1).ToString()
		url, _ := call.Argument(2).ToString()

		rpath, err := resolveRepo(vpath, true)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		if err := manager.AddRemote(rpath, name, url); err != nil {
			return gitOperationFailure(vm, err)
		}
		return gitOperationSuccess(vm, "remote "+name+" saved")
	})

	// git.removeRemote(vpath, name) -> {success, error}
	vm.Set("_git_removeremote", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		name, _ := call.Argument(1).ToString()

		rpath, err := resolveRepo(vpath, true)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		if err := manager.RemoveRemote(rpath, name); err != nil {
			return gitOperationFailure(vm, err)
		}
		return gitOperationSuccess(vm, "remote "+name+" removed")
	})

	// git.add(vpath, files) -> {success, error}
	vm.Set("_git_add", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		files := exportStringSlice(call.Argument(1))

		rpath, err := resolveRepo(vpath, true)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		if err := manager.Add(rpath, files); err != nil {
			return gitOperationFailure(vm, err)
		}
		return gitOperationSuccess(vm, "")
	})

	// git.addAll(vpath) -> {success, error}
	vm.Set("_git_addall", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		rpath, err := resolveRepo(vpath, true)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		if err := manager.AddAll(rpath); err != nil {
			return gitOperationFailure(vm, err)
		}
		return gitOperationSuccess(vm, "")
	})

	// git.unstage(vpath, files) -> {success, error}
	vm.Set("_git_unstage", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		files := exportStringSlice(call.Argument(1))

		rpath, err := resolveRepo(vpath, true)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		if err := manager.Unstage(rpath, files); err != nil {
			return gitOperationFailure(vm, err)
		}
		return gitOperationSuccess(vm, "")
	})

	// git.discard(vpath, files) -> {success, error}
	vm.Set("_git_discard", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		files := exportStringSlice(call.Argument(1))

		rpath, err := resolveRepo(vpath, true)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		if err := manager.Discard(rpath, files); err != nil {
			return gitOperationFailure(vm, err)
		}
		return gitOperationSuccess(vm, "")
	})

	// git.ignore(vpath, patterns) -> {success, error, message}
	vm.Set("_git_ignore", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		patterns := exportStringSlice(call.Argument(1))

		rpath, err := resolveRepo(vpath, true)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		added, err := manager.AddIgnoreRules(rpath, patterns)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		if len(added) == 0 {
			return gitOperationSuccess(vm, "already ignored")
		}
		return gitOperationSuccess(vm, "ignoring "+strings.Join(added, ", "))
	})

	// git.commit(vpath, message, files, options) -> {success, error, hash}
	vm.Set("_git_commit", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		message, _ := call.Argument(1).ToString()
		files := exportStringSlice(call.Argument(2))
		options := exportOptions(call.Argument(3))

		rpath, err := resolveRepo(vpath, true)
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		authorName := optionString(options, "name")
		if authorName == "" {
			authorName = u.Username
		}

		hash, err := manager.Commit(rpath, &git.CommitRequest{
			Message: message,
			Files:   files,
			Name:    authorName,
			Email:   optionString(options, "email"),
			All:     optionBool(options, "all"),
		})
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		return gitJSONValue(vm, git.OperationResult{
			Success: true,
			Hash:    hash,
			Message: "commit created",
		})
	})

	// git.diff(vpath, file) -> file diff
	vm.Set("_git_diff", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		file, _ := call.Argument(1).ToString()

		rpath, err := resolveRepo(vpath, false)
		if err != nil {
			return gitJSONError(vm, err)
		}

		diff, err := manager.Diff(rpath, file)
		if err != nil {
			return gitJSONError(vm, err)
		}
		return gitJSONValue(vm, diff)
	})

	// git.diffCommit(vpath, hash, file) -> file diff
	vm.Set("_git_diffcommit", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		hash, _ := call.Argument(1).ToString()
		file, _ := call.Argument(2).ToString()

		rpath, err := resolveRepo(vpath, false)
		if err != nil {
			return gitJSONError(vm, err)
		}

		diff, err := manager.DiffCommit(rpath, hash, file)
		if err != nil {
			return gitJSONError(vm, err)
		}
		return gitJSONValue(vm, diff)
	})

	// git.fileBlob(vpath, file, revision) -> {success, exists, base64, mime, kind, size}
	// Reads a file's content at a revision so the front-end can preview the
	// "before" side of a change that only exists in the object database.
	vm.Set("_git_fileblob", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		file, _ := call.Argument(1).ToString()
		revision, _ := call.Argument(2).ToString()

		rpath, err := resolveRepo(vpath, false)
		if err != nil {
			return gitJSONError(vm, err)
		}

		content, exists, err := manager.FileBlob(rpath, file, revision)
		if err != nil {
			return gitJSONError(vm, err)
		}

		payload := map[string]interface{}{
			"success": true,
			"exists":  exists,
			"mime":    git.PreviewMimeType(file),
			"kind":    git.PreviewKind(file),
			"size":    len(content),
		}
		if exists {
			payload["base64"] = base64.StdEncoding.EncodeToString(content)
		}
		return gitJSONValue(vm, payload)
	})

	// git.commitFiles(vpath, hash) -> [file, ...]
	vm.Set("_git_commitfiles", func(call otto.FunctionCall) otto.Value {
		vpath, _ := call.Argument(0).ToString()
		hash, _ := call.Argument(1).ToString()

		rpath, err := resolveRepo(vpath, false)
		if err != nil {
			return gitJSONError(vm, err)
		}

		files, err := manager.CommitFiles(rpath, hash)
		if err != nil {
			return gitJSONError(vm, err)
		}
		return gitJSONValue(vm, files)
	})

	// git.fetch(vpath, options) -> {success, error, authRequired}
	vm.Set("_git_fetch", func(call otto.FunctionCall) otto.Value {
		return g.runGitTransport(vm, u, call, resolveRepo, func(rpath string, request *git.TransportRequest) (string, error) {
			return "fetched", manager.Fetch(rpath, request)
		})
	})

	// git.pull(vpath, options) -> {success, error, authRequired}
	vm.Set("_git_pull", func(call otto.FunctionCall) otto.Value {
		return g.runGitTransport(vm, u, call, resolveRepo, func(rpath string, request *git.TransportRequest) (string, error) {
			return manager.Pull(rpath, request)
		})
	})

	// git.push(vpath, options) -> {success, error, authRequired}
	vm.Set("_git_push", func(call otto.FunctionCall) otto.Value {
		return g.runGitTransport(vm, u, call, resolveRepo, func(rpath string, request *git.TransportRequest) (string, error) {
			return manager.Push(rpath, request)
		})
	})

	// git.saveCredential(host, username, token) -> {success, error}
	vm.Set("_git_savecredential", func(call otto.FunctionCall) otto.Value {
		host, _ := call.Argument(0).ToString()
		remoteUser, _ := call.Argument(1).ToString()
		token, _ := call.Argument(2).ToString()

		store, err := g.gitCredentialStore()
		if err != nil {
			return gitOperationFailure(vm, err)
		}

		if err := store.Save(u.Username, host, remoteUser, token); err != nil {
			return gitOperationFailure(vm, err)
		}
		return gitOperationSuccess(vm, "credential saved")
	})

	// git.listCredentials() -> [{host, username}, ...]
	vm.Set("_git_listcredentials", func(call otto.FunctionCall) otto.Value {
		store, err := g.gitCredentialStore()
		if err != nil {
			return gitJSONError(vm, err)
		}
		return gitJSONValue(vm, store.List(u.Username))
	})

	// git.hasCredential(host) -> bool
	vm.Set("_git_hascredential", func(call otto.FunctionCall) otto.Value {
		host, _ := call.Argument(0).ToString()

		store, err := g.gitCredentialStore()
		if err != nil {
			return otto.FalseValue()
		}
		if _, found := store.Get(u.Username, host); found {
			return otto.TrueValue()
		}
		return otto.FalseValue()
	})

	// git.removeCredential(host) -> {success, error}
	vm.Set("_git_removecredential", func(call otto.FunctionCall) otto.Value {
		host, _ := call.Argument(0).ToString()

		store, err := g.gitCredentialStore()
		if err != nil {
			return gitOperationFailure(vm, err)
		}
		if err := store.Remove(u.Username, host); err != nil {
			return gitOperationFailure(vm, err)
		}
		return gitOperationSuccess(vm, "credential removed")
	})

	// git.remoteHost(url) -> host name used as the credential key
	vm.Set("_git_remotehost", func(call otto.FunctionCall) otto.Value {
		url, _ := call.Argument(0).ToString()
		result, _ := vm.ToValue(git.RemoteHost(url))
		return result
	})

	//Wrap the native functions into a git object. Everything that can carry
	//structured data crosses the boundary as JSON so the script always receives
	//plain JavaScript objects.
	vm.Run(gitLibJavaScript)
}

// gitLibJavaScript is the in-VM wrapper that turns the native _git_* calls into
// the `git` object AGI scripts use. Kept as a package constant so a unit test
// can execute it and catch a syntax error before it reaches a user's script.
const gitLibJavaScript = `
		var git = {};
		var _git_parse = function(raw) {
			if (raw === false || raw === undefined || raw === null) {
				return {error: "git call failed"};
			}
			try { return JSON.parse(raw); } catch(e) { return {error: "malformed git response"}; }
		};

		git.isRepo = _git_isrepo;
		git.repoRoot = _git_reporoot;
		git.remoteHost = _git_remotehost;
		git.hasCredential = _git_hascredential;

		git.init = function(vpath) { return _git_parse(_git_init(vpath)); };
		git.clone = function(url, vpath, options) { return _git_parse(_git_clone(url, vpath, options || {})); };
		git.status = function(vpath) { return _git_parse(_git_status(vpath)); };
		git.log = function(vpath, limit) { return _git_parse(_git_log(vpath, limit)); };
		git.branches = function(vpath) { return _git_parse(_git_branches(vpath)); };
		git.checkout = function(vpath, branch, create) { return _git_parse(_git_checkout(vpath, branch, create === true)); };
		git.remotes = function(vpath) { return _git_parse(_git_remotes(vpath)); };
		git.addRemote = function(vpath, name, url) { return _git_parse(_git_addremote(vpath, name, url)); };
		git.removeRemote = function(vpath, name) { return _git_parse(_git_removeremote(vpath, name)); };
		git.add = function(vpath, files) { return _git_parse(_git_add(vpath, files || [])); };
		git.addAll = function(vpath) { return _git_parse(_git_addall(vpath)); };
		git.unstage = function(vpath, files) { return _git_parse(_git_unstage(vpath, files || [])); };
		git.discard = function(vpath, files) { return _git_parse(_git_discard(vpath, files || [])); };
		git.commit = function(vpath, message, files, options) { return _git_parse(_git_commit(vpath, message, files || [], options || {})); };
		git.ignore = function(vpath, patterns) { return _git_parse(_git_ignore(vpath, patterns || [])); };
		git.diff = function(vpath, file) { return _git_parse(_git_diff(vpath, file)); };
		git.diffCommit = function(vpath, hash, file) { return _git_parse(_git_diffcommit(vpath, hash, file)); };
		git.commitFiles = function(vpath, hash) { return _git_parse(_git_commitfiles(vpath, hash)); };
		git.fileBlob = function(vpath, file, revision) { return _git_parse(_git_fileblob(vpath, file, revision || "HEAD")); };
		git.fetch = function(vpath, options) { return _git_parse(_git_fetch(vpath, options || {})); };
		git.pull = function(vpath, options) { return _git_parse(_git_pull(vpath, options || {})); };
		git.push = function(vpath, options) { return _git_parse(_git_push(vpath, options || {})); };
		git.saveCredential = function(host, username, token) { return _git_parse(_git_savecredential(host, username, token)); };
		git.listCredentials = function() { return _git_parse(_git_listcredentials()); };
		git.removeCredential = function(host) { return _git_parse(_git_removecredential(host)); };
`

// gitTransportRunner is the shape of the fetch / pull / push bodies, letting the
// three of them share credential resolution and error reporting.
type gitTransportRunner func(rpath string, request *git.TransportRequest) (string, error)

// runGitTransport wires a transport call: resolve the path, work out which
// credential to use, run the operation and translate the outcome.
func (g *Gateway) runGitTransport(vm *otto.Otto, u *user.User, call otto.FunctionCall,
	resolveRepo func(string, bool) (string, error), run gitTransportRunner) otto.Value {

	vpath, _ := call.Argument(0).ToString()
	options := exportOptions(call.Argument(1))

	//Fetching only rewrites remote-tracking refs inside .git, but that is still
	//a write to the repository folder.
	rpath, err := resolveRepo(vpath, true)
	if err != nil {
		return gitOperationFailure(vm, err)
	}

	remote := optionString(options, "remote")
	remoteURL, urlErr := g.Option.GitManager.RemoteURLForName(rpath, remote)
	if urlErr != nil {
		return gitOperationFailure(vm, urlErr)
	}

	username, token := g.resolveGitCredential(u, remoteURL, options)
	message, err := run(rpath, &git.TransportRequest{
		Remote:      remote,
		Branch:      optionString(options, "branch"),
		Username:    username,
		Token:       token,
		Force:       optionBool(options, "force"),
		SetUpstream: optionBool(options, "setUpstream"),
	})
	if err != nil {
		return gitOperationFailure(vm, err)
	}

	g.rememberGitCredential(u, remoteURL, options)
	return gitOperationSuccess(vm, message)
}

// gitCredentialStore returns the credential store or a readable error when git
// support was started without a database.
func (g *Gateway) gitCredentialStore() (*git.CredentialStore, error) {
	if g.Option.GitManager == nil {
		return nil, errors.New("git support is not enabled on this system")
	}
	store := g.Option.GitManager.Credentials()
	if store == nil {
		return nil, errors.New("git credential storage is not available")
	}
	return store, nil
}

// resolveGitCredential decides which username / token a transport call should
// use: the ones passed in the options win, otherwise the user's stored
// credential for that host is used, otherwise the call proceeds anonymously.
func (g *Gateway) resolveGitCredential(u *user.User, remoteURL string, options map[string]interface{}) (string, string) {
	username := optionString(options, "username")
	token := optionString(options, "token")
	if token != "" {
		return username, token
	}

	store, err := g.gitCredentialStore()
	if err != nil {
		return username, token
	}

	credential, found := store.ResolveForRemote(u.Username, remoteURL)
	if !found {
		return username, token
	}

	if username == "" {
		username = credential.Username
	}
	return username, credential.Token
}

// rememberGitCredential persists the credential that was just proven to work,
// but only when the caller explicitly asked for it (options.remember).
func (g *Gateway) rememberGitCredential(u *user.User, remoteURL string, options map[string]interface{}) {
	if !optionBool(options, "remember") {
		return
	}

	token := optionString(options, "token")
	if token == "" {
		return
	}

	store, err := g.gitCredentialStore()
	if err != nil {
		return
	}

	host := git.RemoteHost(remoteURL)
	if host == "" {
		return
	}

	if err := store.Save(u.Username, host, optionString(options, "username"), token); err != nil {
		logger.PrintAndLog("Agi", "[AGI] Unable to store git credential for "+host, err)
	}
}

/*
repoRootVirtualPath maps a working tree root back onto the caller's virtual path.

It works out how many folder levels the requested path sits below the repository
root on the real file system, then trims that many trailing segments off the
virtual path. Doing it this way avoids a real-to-virtual conversion entirely,
which matters because RepoRoot answers with an absolute OS path while the file
system abstraction removes its storage root by prefix match against a relative
one — the mismatch used to leave the absolute path embedded in the result.
*/
func repoRootVirtualPath(vpath string, rpath string, realRoot string) (string, error) {
	absPath, err := filepath.Abs(rpath)
	if err != nil {
		return "", err
	}
	absRoot, err := filepath.Abs(realRoot)
	if err != nil {
		return "", err
	}

	relative, err := filepath.Rel(absRoot, absPath)
	if err != nil {
		return "", err
	}
	relative = filepath.ToSlash(relative)

	if relative == "." || relative == "" {
		//The requested path is the working tree root itself
		return vpath, nil
	}
	if relative == ".." || strings.HasPrefix(relative, "../") {
		return "", errors.New("repository root is not an ancestor of " + vpath)
	}

	return trimVirtualPathSegments(vpath, len(strings.Split(relative, "/")))
}

/*
trimVirtualPathSegments removes count trailing segments from a virtual path.

Virtual paths are handled as plain strings rather than through path/filepath:
on Windows filepath.Clean treats the "uuid:" prefix as a volume name and
mangles it.
*/
func trimVirtualPathSegments(vpath string, count int) (string, error) {
	separator := strings.Index(vpath, ":/")
	if separator < 0 {
		return "", errors.New("not a virtual path: " + vpath)
	}

	root := vpath[:separator+2]
	body := strings.Trim(vpath[separator+2:], "/")

	segments := []string{}
	if body != "" {
		segments = strings.Split(body, "/")
	}
	if count > len(segments) {
		return "", errors.New("repository root lies outside " + vpath)
	}

	return root + strings.Join(segments[:len(segments)-count], "/"), nil
}

// checkFshSupportsGit rejects storage pools that cannot host a working tree.
// Network-backed pools only expose streaming reads and writes, while git needs
// ordinary random-access files.
func checkFshSupportsGit(fsh *filesystem.FileSystemHandler) error {
	if fsh == nil {
		return errors.New("unable to resolve the storage pool for this path")
	}
	if fsh.RequireBuffer {
		return errors.New("git repositories must live on a local storage pool, not on " + fsh.Name)
	}
	if fsh.ReadOnly {
		return errors.New("storage pool " + fsh.Name + " is read only")
	}
	return nil
}

// gitJSONValue marshals a value and hands it to the VM as a JSON string.
func gitJSONValue(vm *otto.Otto, value interface{}) otto.Value {
	encoded, err := json.Marshal(value)
	if err != nil {
		return gitJSONError(vm, err)
	}
	result, err := vm.ToValue(string(encoded))
	if err != nil {
		return otto.FalseValue()
	}
	return result
}

// gitJSONError returns an {error: "..."} object for the read-only calls, which
// return their payload directly rather than a success envelope.
func gitJSONError(vm *otto.Otto, err error) otto.Value {
	payload := map[string]interface{}{"error": err.Error()}
	if errors.Is(err, git.ErrAuthRequired) {
		payload["authRequired"] = true
	}

	encoded, _ := json.Marshal(payload)
	result, merr := vm.ToValue(string(encoded))
	if merr != nil {
		return otto.FalseValue()
	}
	return result
}

// gitOperationSuccess builds the standard success envelope.
func gitOperationSuccess(vm *otto.Otto, message string) otto.Value {
	return gitJSONValue(vm, git.OperationResult{
		Success: true,
		Message: message,
	})
}

// gitOperationFailure builds the standard failure envelope, flagging
// credential problems so the front-end knows to open its sign-in dialog.
func gitOperationFailure(vm *otto.Otto, err error) otto.Value {
	return gitJSONValue(vm, git.OperationResult{
		Success:      false,
		Error:        err.Error(),
		AuthRequired: errors.Is(err, git.ErrAuthRequired),
	})
}

// exportOptions converts a JavaScript options object into a Go map. A missing
// or non-object argument yields an empty map so callers never need nil checks.
func exportOptions(value otto.Value) map[string]interface{} {
	if !value.IsObject() {
		return map[string]interface{}{}
	}

	exported, err := value.Export()
	if err != nil {
		return map[string]interface{}{}
	}

	options, ok := exported.(map[string]interface{})
	if !ok {
		return map[string]interface{}{}
	}
	return options
}

// exportStringSlice converts a JavaScript array (or a single string) into a
// string slice.
func exportStringSlice(value otto.Value) []string {
	results := []string{}
	if value.IsUndefined() || value.IsNull() {
		return results
	}

	if value.IsString() {
		single, err := value.ToString()
		if err == nil && single != "" {
			results = append(results, single)
		}
		return results
	}

	exported, err := value.Export()
	if err != nil {
		return results
	}

	switch typed := exported.(type) {
	case []string:
		return typed
	case []interface{}:
		for _, item := range typed {
			if text, ok := item.(string); ok && text != "" {
				results = append(results, text)
			}
		}
	}
	return results
}

// optionString reads a string field from an options map.
func optionString(options map[string]interface{}, key string) string {
	value, ok := options[key]
	if !ok || value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

// optionBool reads a boolean field from an options map, accepting the string
// "true" as well so form values work unchanged.
func optionBool(options map[string]interface{}, key string) bool {
	value, ok := options[key]
	if !ok || value == nil {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true")
	}
	return false
}

// optionInt reads a numeric field from an options map. Otto hands numbers back
// as float64, and form values arrive as strings.
func optionInt(options map[string]interface{}, key string) int {
	value, ok := options[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed := 0
		if _, err := fmt.Sscanf(strings.TrimSpace(typed), "%d", &parsed); err != nil {
			return 0
		}
		return parsed
	}
	return 0
}
