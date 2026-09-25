package agi

import (
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/user"
)

/*
	The Office suite's working copies

	An open document's pictures are extracted next to the server
	(office.loadDocument), and pictures dropped into an editor are uploaded
	before the document is saved. Both are working copies of one editor
	window, kept under the user's tmp:/ where the nightly tmp sweep removes
	whatever nobody has touched for a day:

	    tmp:/.appdata/Office/cache/<window>/    pictures of the open documents
	    tmp:/.appdata/Office/uploads/<window>/  pictures dropped in, not saved yet
	    tmp:/.appdata/Office/tmp/               request payloads, consumed at once

	An editor deletes its own folders when it closes (office.releaseWorkdir)
	and refreshes them while it stays open (office.touchWorkdir), so a
	document left open overnight does not lose the files its links point at.
	office.saveDocument refuses to save rather than silently drop a picture
	whose working copy has gone anyway.

	Earlier versions kept the same folders under user:/.appdata/Office/,
	where nothing ever removed them; those are swept by age.
*/

// officeTempRoot is where an editor window's working copies live
const officeTempRoot = "tmp:/.appdata/Office/"

// officeLegacyWorkdirs held the working copies before they moved to tmp:/
var officeLegacyWorkdirs = []string{
	"user:/.appdata/Office/cache/",
	"user:/.appdata/Office/uploads/",
	"user:/.appdata/Office/tmp/",
}

// cleanOfficeVpath normalises a vpath for the prefix checks below and
// rejects anything that climbs out with ".."
func cleanOfficeVpath(vp string) (string, bool) {
	vp = strings.ReplaceAll(vp, "\\", "/")
	for _, seg := range strings.Split(vp, "/") {
		if seg == ".." {
			return "", false
		}
	}
	i := strings.Index(vp, ":/")
	if i <= 0 {
		return "", false
	}
	root, rest := vp[:i+2], path.Clean("/"+vp[i+2:])
	return root + strings.TrimPrefix(rest, "/"), true
}

// isOfficeWorkdir reports whether vp is one of the suite's working copies
// (strictly inside one of their folders): the only places the workdir
// functions may touch or delete, and the links a save must not lose
func isOfficeWorkdir(vp string) bool {
	clean, ok := cleanOfficeVpath(vp)
	if !ok {
		return false
	}
	for _, root := range append([]string{officeTempRoot}, officeLegacyWorkdirs...) {
		if strings.HasPrefix(clean, root) && len(clean) > len(root) {
			return true
		}
	}
	return false
}

// isOfficeWorkdirRoot reports whether vp is one of the working roots
// themselves (tmp:/.appdata/Office/cache, the legacy user:/ folders, ...):
// those may be swept by age but never touched or deleted whole
func isOfficeWorkdirRoot(vp string) bool {
	clean, ok := cleanOfficeVpath(vp)
	if !ok {
		return false
	}
	clean = strings.TrimSuffix(clean, "/") + "/"
	for _, root := range officeLegacyWorkdirs {
		if clean == root {
			return true
		}
	}
	for _, sub := range []string{"cache/", "uploads/", "tmp/"} {
		if clean == officeTempRoot+sub {
			return true
		}
	}
	return false
}

// newestModTime is the most recent modification time in a tree
func newestModTime(fsa filesystem.FileSystemAbstraction, rpath string) time.Time {
	var newest time.Time
	fsa.Walk(rpath, func(p string, info os.FileInfo, err error) error {
		if err == nil && info != nil && info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		return nil
	})
	return newest
}

func (g *Gateway) injectOfficeWorkdirFunctions(vm *otto.Otto, u *user.User, scriptFsh *filesystem.FileSystemHandler) {
	// resolve checks and resolves one workdir argument
	resolve := func(raw string, sweep bool) (*filesystem.FileSystemHandler, string, string) {
		vp := static.RelativeVpathRewrite(scriptFsh, raw, vm, u)
		clean, ok := cleanOfficeVpath(vp)
		// a working root is only ever swept by age, never deleted whole
		if ok && isOfficeWorkdirRoot(clean) && !sweep {
			ok = false
		}
		if !ok || !(isOfficeWorkdir(clean) || (sweep && isOfficeWorkdirRoot(clean))) {
			panic(vm.MakeCustomError("PermissionDenied", "not an Office working folder: "+raw))
		}
		if !u.CanWrite(clean) {
			panic(vm.MakeCustomError("PermissionDenied", "Write access denied: "+clean))
		}
		fsh, rpath, err := static.VirtualPathToRealPath(clean, u)
		if err != nil {
			panic(vm.MakeCustomError("PathError", err.Error()))
		}
		return fsh, rpath, clean
	}

	// touchWorkdir(vpath, ...) => true: refresh the modification time of
	// each folder, everything in it and every folder above it up to the
	// root of its storage, so the nightly tmp sweep (which removes a folder
	// by its own age) leaves an open editor's working copies alone
	vm.Set("_office_touchWorkdir", func(call otto.FunctionCall) otto.Value {
		now := time.Now()
		for _, arg := range call.ArgumentList {
			raw, err := arg.ToString()
			if err != nil || raw == "" {
				continue
			}
			fsh, rpath, clean := resolve(raw, false)
			fsa := fsh.FileSystemAbstraction
			if !fsa.FileExists(rpath) {
				continue
			}
			fsa.Walk(rpath, func(p string, info os.FileInfo, err error) error {
				if err == nil {
					fsa.Chtimes(p, now, now)
				}
				return nil
			})
			root := clean[:strings.Index(clean, ":/")+2]
			_, rootR, err := static.VirtualPathToRealPath(root, u)
			if err != nil {
				continue
			}
			rootR = filepath.Clean(rootR)
			for dir := filepath.Dir(filepath.Clean(rpath)); len(dir) >= len(rootR) &&
				strings.HasPrefix(dir, rootR); dir = filepath.Dir(dir) {
				fsa.Chtimes(dir, now, now)
				if dir == rootR || filepath.Dir(dir) == dir {
					break
				}
			}
		}
		return otto.TrueValue()
	})

	// releaseWorkdir(vpath [, olderThanSeconds]) => true: delete a working
	// folder with everything in it; with an age, delete only the entries in
	// it whose newest file is older than that (a sweep of stale leftovers)
	vm.Set("_office_releaseWorkdir", func(call otto.FunctionCall) otto.Value {
		raw, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		age, _ := call.Argument(1).ToInteger()
		fsh, rpath, _ := resolve(raw, age > 0)
		fsa := fsh.FileSystemAbstraction
		if !fsa.FileExists(rpath) {
			return otto.TrueValue()
		}
		if age <= 0 {
			if err := fsa.RemoveAll(rpath); err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
			return otto.TrueValue()
		}
		cutoff := time.Now().Add(-time.Duration(age) * time.Second)
		entries, err := fsa.ReadDir(rpath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		for _, e := range entries {
			child := filepath.Join(rpath, e.Name())
			if newestModTime(fsa, child).Before(cutoff) {
				fsa.RemoveAll(child)
			}
		}
		return otto.TrueValue()
	})
}
