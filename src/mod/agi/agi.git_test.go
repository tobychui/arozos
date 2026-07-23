package agi

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/git"
)

func TestExportStringSlice(t *testing.T) {
	vm := otto.New()

	tests := []struct {
		name       string
		expression string
		want       []string
	}{
		{name: "array of strings", expression: `["a.txt", "b/c.go"]`, want: []string{"a.txt", "b/c.go"}},
		{name: "empty array", expression: `[]`, want: []string{}},
		{name: "single string", expression: `"only.txt"`, want: []string{"only.txt"}},
		{name: "empty string", expression: `""`, want: []string{}},
		{name: "undefined", expression: `undefined`, want: []string{}},
		{name: "null", expression: `null`, want: []string{}},
		{name: "mixed types keep only strings", expression: `["a.txt", 5, null, "b.txt"]`, want: []string{"a.txt", "b.txt"}},
		{name: "number", expression: `42`, want: []string{}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value, err := vm.Run(test.expression)
			if err != nil {
				t.Fatalf("cannot evaluate %q: %v", test.expression, err)
			}

			got := exportStringSlice(value)
			if len(got) != len(test.want) {
				t.Fatalf("exportStringSlice(%s) = %v, want %v", test.expression, got, test.want)
			}
			for i := range got {
				if got[i] != test.want[i] {
					t.Errorf("exportStringSlice(%s)[%d] = %q, want %q", test.expression, i, got[i], test.want[i])
				}
			}
		})
	}
}

func TestExportOptions(t *testing.T) {
	vm := otto.New()

	tests := []struct {
		name        string
		expression  string
		wantEntries int
	}{
		{name: "populated object", expression: `({username: "toby", remember: true})`, wantEntries: 2},
		{name: "empty object", expression: `({})`, wantEntries: 0},
		{name: "undefined", expression: `undefined`, wantEntries: 0},
		{name: "string is not an object", expression: `"nope"`, wantEntries: 0},
		{name: "number is not an object", expression: `7`, wantEntries: 0},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value, err := vm.Run(test.expression)
			if err != nil {
				t.Fatalf("cannot evaluate %q: %v", test.expression, err)
			}

			options := exportOptions(value)
			if options == nil {
				t.Fatalf("exportOptions(%s) = nil, want a usable map", test.expression)
			}
			if len(options) != test.wantEntries {
				t.Errorf("exportOptions(%s) = %d entries, want %d", test.expression, len(options), test.wantEntries)
			}
		})
	}
}

func TestOptionString(t *testing.T) {
	options := map[string]interface{}{
		"username": "tobychui",
		"padded":   "  spaced  ",
		"number":   42.0,
		"nothing":  nil,
	}

	tests := []struct {
		name string
		key  string
		want string
	}{
		{name: "plain value", key: "username", want: "tobychui"},
		{name: "value is trimmed", key: "padded", want: "spaced"},
		{name: "wrong type", key: "number", want: ""},
		{name: "nil value", key: "nothing", want: ""},
		{name: "missing key", key: "absent", want: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := optionString(options, test.key); got != test.want {
				t.Errorf("optionString(%q) = %q, want %q", test.key, got, test.want)
			}
		})
	}
}

func TestOptionBool(t *testing.T) {
	options := map[string]interface{}{
		"yes":       true,
		"no":        false,
		"textTrue":  "true",
		"textUpper": "TRUE",
		"textFalse": "false",
		"number":    1.0,
		"nothing":   nil,
	}

	tests := []struct {
		name string
		key  string
		want bool
	}{
		{name: "boolean true", key: "yes", want: true},
		{name: "boolean false", key: "no", want: false},
		{name: "string true", key: "textTrue", want: true},
		{name: "string true uppercase", key: "textUpper", want: true},
		{name: "string false", key: "textFalse", want: false},
		{name: "number is not truthy", key: "number", want: false},
		{name: "nil value", key: "nothing", want: false},
		{name: "missing key", key: "absent", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := optionBool(options, test.key); got != test.want {
				t.Errorf("optionBool(%q) = %v, want %v", test.key, got, test.want)
			}
		})
	}
}

func TestOptionInt(t *testing.T) {
	options := map[string]interface{}{
		"float":    5.0,
		"integer":  7,
		"text":     "12",
		"notANum":  "abc",
		"nothing":  nil,
		"boolean":  true,
		"negative": -3.0,
	}

	tests := []struct {
		name string
		key  string
		want int
	}{
		{name: "float from otto", key: "float", want: 5},
		{name: "native int", key: "integer", want: 7},
		{name: "numeric string", key: "text", want: 12},
		{name: "non numeric string", key: "notANum", want: 0},
		{name: "nil value", key: "nothing", want: 0},
		{name: "wrong type", key: "boolean", want: 0},
		{name: "negative number", key: "negative", want: -3},
		{name: "missing key", key: "absent", want: 0},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := optionInt(options, test.key); got != test.want {
				t.Errorf("optionInt(%q) = %d, want %d", test.key, got, test.want)
			}
		})
	}
}

func TestTrimVirtualPathSegments(t *testing.T) {
	tests := []struct {
		name      string
		vpath     string
		count     int
		want      string
		wantError bool
	}{
		{name: "nothing to trim", vpath: "user:/Code/QuickSend_PHP", count: 0, want: "user:/Code/QuickSend_PHP"},
		{name: "trim one level", vpath: "user:/Code/QuickSend_PHP/src", count: 1, want: "user:/Code/QuickSend_PHP"},
		{name: "trim two levels", vpath: "user:/Code/repo/a/b", count: 2, want: "user:/Code/repo"},
		{name: "trailing slash tolerated", vpath: "user:/Code/repo/src/", count: 1, want: "user:/Code/repo"},
		{name: "trim down to the storage root", vpath: "user:/repo", count: 1, want: "user:/"},
		{name: "storage root itself", vpath: "user:/", count: 0, want: "user:/"},
		{name: "uuid style root", vpath: "extuuid:/Projects/repo/src", count: 1, want: "extuuid:/Projects/repo"},
		{name: "trims past the root", vpath: "user:/repo", count: 2, wantError: true},
		{name: "not a virtual path", vpath: "/absolute/path", count: 1, wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := trimVirtualPathSegments(test.vpath, test.count)
			if test.wantError {
				if err == nil {
					t.Fatalf("trimVirtualPathSegments(%q, %d) = %q, want an error", test.vpath, test.count, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("trimVirtualPathSegments(%q, %d) returned error: %v", test.vpath, test.count, err)
			}
			if got != test.want {
				t.Errorf("trimVirtualPathSegments(%q, %d) = %q, want %q", test.vpath, test.count, got, test.want)
			}
		})
	}
}

/*
TestRepoRootVirtualPath covers the regression behind the doubled path bug:
RepoRoot answers with an absolute OS path, and feeding that to the file system
abstraction produced virtual paths like

	user:/D:/Github/arozos/src/files/users/TC/Code/QuickSend_PHP

which then resolved to the storage root joined with the absolute path again.
The mapping must be driven by the virtual path instead, and must never let an
absolute real path leak into the result.
*/
func TestRepoRootVirtualPath(t *testing.T) {
	//The real paths mirror what VirtualPathToRealPath produces on this project:
	//a path relative to the binary, under ./files/users/<user>/
	base := filepath.Join("files", "users", "TC")

	tests := []struct {
		name      string
		vpath     string
		rpath     string
		realRoot  string
		want      string
		wantError bool
	}{
		{
			name:     "path is the repository root",
			vpath:    "user:/Code/QuickSend_PHP",
			rpath:    filepath.Join(base, "Code", "QuickSend_PHP"),
			realRoot: absolutePath(t, filepath.Join(base, "Code", "QuickSend_PHP")),
			want:     "user:/Code/QuickSend_PHP",
		},
		{
			name:     "path is one level inside the repository",
			vpath:    "user:/Code/QuickSend_PHP/src",
			rpath:    filepath.Join(base, "Code", "QuickSend_PHP", "src"),
			realRoot: absolutePath(t, filepath.Join(base, "Code", "QuickSend_PHP")),
			want:     "user:/Code/QuickSend_PHP",
		},
		{
			name:     "path is deep inside the repository",
			vpath:    "user:/Code/QuickSend_PHP/src/mod/git",
			rpath:    filepath.Join(base, "Code", "QuickSend_PHP", "src", "mod", "git"),
			realRoot: absolutePath(t, filepath.Join(base, "Code", "QuickSend_PHP")),
			want:     "user:/Code/QuickSend_PHP",
		},
		{
			name:     "repository directly under the storage root",
			vpath:    "user:/QuickSend_PHP/src",
			rpath:    filepath.Join(base, "QuickSend_PHP", "src"),
			realRoot: absolutePath(t, filepath.Join(base, "QuickSend_PHP")),
			want:     "user:/QuickSend_PHP",
		},
		{
			name:      "root is not an ancestor",
			vpath:     "user:/Code/QuickSend_PHP",
			rpath:     filepath.Join(base, "Code", "QuickSend_PHP"),
			realRoot:  absolutePath(t, filepath.Join(base, "Elsewhere")),
			wantError: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := repoRootVirtualPath(test.vpath, test.rpath, test.realRoot)
			if test.wantError {
				if err == nil {
					t.Fatalf("repoRootVirtualPath() = %q, want an error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("repoRootVirtualPath() returned error: %v", err)
			}
			if got != test.want {
				t.Errorf("repoRootVirtualPath() = %q, want %q", got, test.want)
			}

			//No absolute real path may ever appear in a virtual path
			if strings.Contains(got, ":\\") || strings.Contains(got, "files/users") {
				t.Errorf("repoRootVirtualPath() leaked a real path into %q", got)
			}
			if strings.Count(got, ":/") != 1 {
				t.Errorf("repoRootVirtualPath() = %q, want exactly one virtual root marker", got)
			}
		})
	}
}

// absolutePath is the helper the RepoRootVirtualPath table uses to build the
// absolute roots RepoRoot would return.
func absolutePath(t *testing.T, path string) string {
	t.Helper()

	absolute, err := filepath.Abs(path)
	if err != nil {
		t.Fatalf("cannot absolutise %s: %v", path, err)
	}
	return filepath.ToSlash(absolute)
}

func TestCheckFshSupportsGit(t *testing.T) {
	tests := []struct {
		name      string
		fsh       *filesystem.FileSystemHandler
		wantError bool
	}{
		{
			name: "local read write pool",
			fsh:  &filesystem.FileSystemHandler{Name: "User", RequireBuffer: false, ReadOnly: false},
		},
		{
			name:      "nil handler",
			fsh:       nil,
			wantError: true,
		},
		{
			name:      "network backed pool",
			fsh:       &filesystem.FileSystemHandler{Name: "WebDAV Drive", RequireBuffer: true},
			wantError: true,
		},
		{
			name:      "read only pool",
			fsh:       &filesystem.FileSystemHandler{Name: "Backup", ReadOnly: true},
			wantError: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := checkFshSupportsGit(test.fsh)
			if test.wantError && err == nil {
				t.Errorf("checkFshSupportsGit() = nil, want an error")
			}
			if !test.wantError && err != nil {
				t.Errorf("checkFshSupportsGit() = %v, want nil", err)
			}
		})
	}
}

func TestGitOperationEnvelopes(t *testing.T) {
	vm := otto.New()

	tests := []struct {
		name             string
		value            otto.Value
		wantSuccess      bool
		wantAuthRequired bool
		wantMessage      string
		wantError        string
	}{
		{
			name:        "success envelope",
			value:       gitOperationSuccess(vm, "pushed to origin/master"),
			wantSuccess: true,
			wantMessage: "pushed to origin/master",
		},
		{
			name:      "plain failure",
			value:     gitOperationFailure(vm, errors.New("connection refused")),
			wantError: "connection refused",
		},
		{
			name:             "authentication failure is flagged",
			value:            gitOperationFailure(vm, git.ErrAuthRequired),
			wantAuthRequired: true,
			wantError:        git.ErrAuthRequired.Error(),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			raw, err := test.value.ToString()
			if err != nil {
				t.Fatalf("cannot read the returned value: %v", err)
			}

			result := git.OperationResult{}
			if err := json.Unmarshal([]byte(raw), &result); err != nil {
				t.Fatalf("returned value is not valid JSON (%s): %v", raw, err)
			}

			if result.Success != test.wantSuccess {
				t.Errorf("Success = %v, want %v", result.Success, test.wantSuccess)
			}
			if result.AuthRequired != test.wantAuthRequired {
				t.Errorf("AuthRequired = %v, want %v", result.AuthRequired, test.wantAuthRequired)
			}
			if result.Message != test.wantMessage {
				t.Errorf("Message = %q, want %q", result.Message, test.wantMessage)
			}
			if result.Error != test.wantError {
				t.Errorf("Error = %q, want %q", result.Error, test.wantError)
			}
		})
	}
}

func TestGitJSONErrorFlagsAuthRequired(t *testing.T) {
	vm := otto.New()

	tests := []struct {
		name             string
		err              error
		wantAuthRequired bool
	}{
		{name: "plain error", err: errors.New("not a git repository"), wantAuthRequired: false},
		{name: "auth error", err: git.ErrAuthRequired, wantAuthRequired: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			raw, err := gitJSONError(vm, test.err).ToString()
			if err != nil {
				t.Fatalf("cannot read the returned value: %v", err)
			}

			payload := map[string]interface{}{}
			if err := json.Unmarshal([]byte(raw), &payload); err != nil {
				t.Fatalf("returned value is not valid JSON (%s): %v", raw, err)
			}

			if payload["error"] != test.err.Error() {
				t.Errorf("error = %v, want %q", payload["error"], test.err.Error())
			}

			_, flagged := payload["authRequired"]
			if flagged != test.wantAuthRequired {
				t.Errorf("authRequired present = %v, want %v", flagged, test.wantAuthRequired)
			}
		})
	}
}

func TestGitJSONValueIsParseableInTheVM(t *testing.T) {
	vm := otto.New()

	status := &git.RepoStatus{
		Branch:  "master",
		Clean:   false,
		Changes: []git.FileChange{{Path: "a.txt", Status: "modified"}},
	}

	value := gitJSONValue(vm, status)
	raw, err := value.ToString()
	if err != nil {
		t.Fatalf("cannot read the returned value: %v", err)
	}

	//The JS wrapper JSON.parses whatever the native call returns, so make sure
	//the round trip works inside the VM itself.
	if err := vm.Set("_payload", raw); err != nil {
		t.Fatalf("cannot inject the payload: %v", err)
	}
	result, err := vm.Run(`JSON.parse(_payload).changes[0].path`)
	if err != nil {
		t.Fatalf("the payload is not parseable in the VM: %v", err)
	}

	parsed, _ := result.ToString()
	if parsed != "a.txt" {
		t.Errorf("parsed path = %q, want %q", parsed, "a.txt")
	}
}

// TestGitLibJavaScriptWrapper runs the in-VM wrapper against stub natives, so a
// syntax error or a typo in a function name fails the build instead of a user's
// script at runtime.
func TestGitLibJavaScriptWrapper(t *testing.T) {
	vm := otto.New()

	//Every native the wrapper references, echoing back a JSON payload that
	//names the function that was called.
	natives := []string{
		"_git_isrepo", "_git_reporoot", "_git_remotehost", "_git_hascredential",
		"_git_init", "_git_clone", "_git_status", "_git_log", "_git_branches",
		"_git_checkout", "_git_remotes", "_git_addremote", "_git_removeremote",
		"_git_add", "_git_addall", "_git_unstage", "_git_discard", "_git_commit",
		"_git_diff", "_git_diffcommit", "_git_commitfiles", "_git_fetch",
		"_git_pull", "_git_push", "_git_savecredential", "_git_listcredentials",
		"_git_removecredential", "_git_ignore",
	}
	for _, native := range natives {
		name := native
		if err := vm.Set(name, func(call otto.FunctionCall) otto.Value {
			value, _ := vm.ToValue(`{"success":true,"message":"` + name + `"}`)
			return value
		}); err != nil {
			t.Fatalf("cannot inject %s: %v", name, err)
		}
	}

	if _, err := vm.Run(gitLibJavaScript); err != nil {
		t.Fatalf("the git library wrapper does not evaluate: %v", err)
	}

	//Each wrapped call must reach its native and hand back a parsed object
	calls := []struct {
		name       string
		expression string
	}{
		{name: "init", expression: `git.init("user:/repo").message`},
		{name: "clone", expression: `git.clone("https://example.com/a.git", "user:/repo").message`},
		{name: "status", expression: `git.status("user:/repo").message`},
		{name: "log", expression: `git.log("user:/repo", 10).message`},
		{name: "branches", expression: `git.branches("user:/repo").message`},
		{name: "checkout", expression: `git.checkout("user:/repo", "master").message`},
		{name: "remotes", expression: `git.remotes("user:/repo").message`},
		{name: "addRemote", expression: `git.addRemote("user:/repo", "origin", "url").message`},
		{name: "removeRemote", expression: `git.removeRemote("user:/repo", "origin").message`},
		{name: "add", expression: `git.add("user:/repo", ["a.txt"]).message`},
		{name: "addAll", expression: `git.addAll("user:/repo").message`},
		{name: "unstage", expression: `git.unstage("user:/repo", ["a.txt"]).message`},
		{name: "discard", expression: `git.discard("user:/repo", ["a.txt"]).message`},
		{name: "commit", expression: `git.commit("user:/repo", "message", ["a.txt"]).message`},
		{name: "ignore", expression: `git.ignore("user:/repo", ["*.log"]).message`},
		{name: "diff", expression: `git.diff("user:/repo", "a.txt").message`},
		{name: "diffCommit", expression: `git.diffCommit("user:/repo", "abc", "a.txt").message`},
		{name: "commitFiles", expression: `git.commitFiles("user:/repo", "abc").message`},
		{name: "fetch", expression: `git.fetch("user:/repo").message`},
		{name: "pull", expression: `git.pull("user:/repo").message`},
		{name: "push", expression: `git.push("user:/repo").message`},
		{name: "saveCredential", expression: `git.saveCredential("github.com", "u", "t").message`},
		{name: "listCredentials", expression: `git.listCredentials().message`},
		{name: "removeCredential", expression: `git.removeCredential("github.com").message`},
	}

	for _, call := range calls {
		t.Run(call.name, func(t *testing.T) {
			value, err := vm.Run(call.expression)
			if err != nil {
				t.Fatalf("%s failed to evaluate: %v", call.expression, err)
			}
			got, _ := value.ToString()
			want := "_git_" + strings.ToLower(call.name)
			if got != want {
				t.Errorf("%s reached %q, want %q", call.name, got, want)
			}
		})
	}
}

func TestGitLibJavaScriptHandlesMalformedNativeResponse(t *testing.T) {
	vm := otto.New()

	//A native that fails returns false; the wrapper must turn that into an
	//error object rather than throwing inside the user's script.
	if err := vm.Set("_git_status", func(call otto.FunctionCall) otto.Value {
		return otto.FalseValue()
	}); err != nil {
		t.Fatalf("cannot inject the stub: %v", err)
	}
	if err := vm.Set("_git_log", func(call otto.FunctionCall) otto.Value {
		value, _ := vm.ToValue("this is not json")
		return value
	}); err != nil {
		t.Fatalf("cannot inject the stub: %v", err)
	}
	for _, name := range []string{"_git_isrepo", "_git_reporoot", "_git_remotehost", "_git_hascredential",
		"_git_init", "_git_clone", "_git_branches", "_git_checkout", "_git_remotes",
		"_git_addremote", "_git_removeremote", "_git_add", "_git_addall", "_git_unstage",
		"_git_discard", "_git_commit", "_git_ignore", "_git_diff", "_git_diffcommit", "_git_commitfiles",
		"_git_fetch", "_git_pull", "_git_push", "_git_savecredential", "_git_listcredentials",
		"_git_removecredential"} {
		vm.Set(name, func(call otto.FunctionCall) otto.Value { return otto.FalseValue() })
	}

	if _, err := vm.Run(gitLibJavaScript); err != nil {
		t.Fatalf("the git library wrapper does not evaluate: %v", err)
	}

	tests := []struct {
		name       string
		expression string
	}{
		{name: "native returned false", expression: `git.status("user:/repo").error`},
		{name: "native returned garbage", expression: `git.log("user:/repo").error`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value, err := vm.Run(test.expression)
			if err != nil {
				t.Fatalf("%s failed to evaluate: %v", test.expression, err)
			}
			message, _ := value.ToString()
			if message == "" || message == "undefined" {
				t.Errorf("%s = %q, want a populated error message", test.expression, message)
			}
		})
	}
}

func TestGitCredentialStoreRequiresManager(t *testing.T) {
	gateway := &Gateway{Option: &AgiSysInfo{}}

	if _, err := gateway.gitCredentialStore(); err == nil {
		t.Errorf("gitCredentialStore() without a manager = nil error, want an error")
	}
}

func TestResolveGitCredentialPrefersExplicitOptions(t *testing.T) {
	gateway := &Gateway{Option: &AgiSysInfo{}}

	username, token := gateway.resolveGitCredential(nil, "https://github.com/a/b.git", map[string]interface{}{
		"username": "tobychui",
		"token":    "ghp_explicit",
	})

	if username != "tobychui" || token != "ghp_explicit" {
		t.Errorf("resolveGitCredential() = (%q, %q), want the values passed in the options", username, token)
	}
}
