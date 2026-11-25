package filesystem

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	debugfsa.go

	A FileSystemAbstraction that logs every call of the drive it wraps at the
	DEBUG level, and logs a panic inside a call with the drive, the operation,
	its paths and the stack before letting it go on. It is only put around
	drives opened while debug logging is on (-debug), so a normal run keeps the
	bare abstraction.

	What is logged:
	  - opening, writing, removing, renaming, listing, streaming, heartbeat
	    and close: every call, with its duration and error
	  - per-file queries (Stat, size, mod time, path translation): only when
	    they fail or take over a second, since a folder listing makes one per
	    file
	  - FileExists and IsDir: never, they cannot fail; a panic is still traced

	Code that needs the concrete abstraction, such as checking for a local
	disk, must look through the wrapper with UnwrapAbstraction.
*/

const debugSlowCall = time.Second //Queries slower than this are logged even when they succeed

type debugAbstraction struct {
	inner FileSystemAbstraction
	label string //"S1:/(smb)", names the drive in every line
}

// wrapForDebug puts the debug wrapper around fsa while debug logging is on
func wrapForDebug(uuid string, fstype string, fsa FileSystemAbstraction) FileSystemAbstraction {
	if !logger.IsDebug() || fsa == nil {
		return fsa
	}
	if _, wrapped := fsa.(*debugAbstraction); wrapped {
		return fsa
	}
	return &debugAbstraction{inner: fsa, label: uuid + ":/(" + fstype + ")"}
}

// UnwrapAbstraction returns the abstraction behind the debug wrapper, or fsa
// itself if it is not wrapped. Use it before a type assertion on a drive's
// abstraction.
func UnwrapAbstraction(fsa FileSystemAbstraction) FileSystemAbstraction {
	if d, ok := fsa.(*debugAbstraction); ok {
		return d.inner
	}
	return fsa
}

// run calls fn, logs the call and traces a panic in it. always logs a call
// that succeeded quickly too; otherwise only failed or slow calls are logged.
func (d *debugAbstraction) run(op string, args string, always bool, fn func() error) error {
	defer logger.TracePanic("Filesystem", d.label+" "+op+"("+args+")")
	start := time.Now()
	err := fn()
	took := time.Since(start)
	if always || err != nil || took >= debugSlowCall {
		result := "ok"
		if err != nil {
			result = "error: " + err.Error()
		}
		//Name the code that called the drive, two frames above: run, then
		//the wrapper method
		logger.DebugfDepth(2, "Filesystem", "%s %s(%s) %s in %s", d.label, op, args, result, took.Round(time.Microsecond))
	}
	return err
}

func q(s string) string {
	return fmt.Sprintf("%q", s)
}

func (d *debugAbstraction) Chmod(name string, mode os.FileMode) error {
	return d.run("Chmod", q(name)+", "+mode.String(), true, func() error { return d.inner.Chmod(name, mode) })
}

func (d *debugAbstraction) Chown(name string, uid int, gid int) error {
	return d.run("Chown", fmt.Sprintf("%q, %d, %d", name, uid, gid), true, func() error { return d.inner.Chown(name, uid, gid) })
}

func (d *debugAbstraction) Chtimes(name string, atime time.Time, mtime time.Time) error {
	return d.run("Chtimes", q(name), true, func() error { return d.inner.Chtimes(name, atime, mtime) })
}

func (d *debugAbstraction) Create(name string) (f arozfs.File, err error) {
	err = d.run("Create", q(name), true, func() error {
		f, err = d.inner.Create(name)
		return err
	})
	return f, err
}

func (d *debugAbstraction) Mkdir(name string, mode os.FileMode) error {
	return d.run("Mkdir", q(name), true, func() error { return d.inner.Mkdir(name, mode) })
}

func (d *debugAbstraction) MkdirAll(name string, mode os.FileMode) error {
	return d.run("MkdirAll", q(name), true, func() error { return d.inner.MkdirAll(name, mode) })
}

func (d *debugAbstraction) Name() string {
	return d.inner.Name()
}

func (d *debugAbstraction) Open(name string) (f arozfs.File, err error) {
	err = d.run("Open", q(name), true, func() error {
		f, err = d.inner.Open(name)
		return err
	})
	return f, err
}

func (d *debugAbstraction) OpenFile(name string, flag int, perm os.FileMode) (f arozfs.File, err error) {
	err = d.run("OpenFile", fmt.Sprintf("%q, flag=%#x", name, flag), true, func() error {
		f, err = d.inner.OpenFile(name, flag, perm)
		return err
	})
	return f, err
}

func (d *debugAbstraction) Remove(name string) error {
	return d.run("Remove", q(name), true, func() error { return d.inner.Remove(name) })
}

func (d *debugAbstraction) RemoveAll(name string) error {
	return d.run("RemoveAll", q(name), true, func() error { return d.inner.RemoveAll(name) })
}

func (d *debugAbstraction) Rename(oldname string, newname string) error {
	return d.run("Rename", q(oldname)+" -> "+q(newname), true, func() error { return d.inner.Rename(oldname, newname) })
}

func (d *debugAbstraction) Stat(name string) (info os.FileInfo, err error) {
	err = d.run("Stat", q(name), false, func() error {
		info, err = d.inner.Stat(name)
		return err
	})
	return info, err
}

func (d *debugAbstraction) Close() error {
	return d.run("Close", "", true, func() error { return d.inner.Close() })
}

func (d *debugAbstraction) VirtualPathToRealPath(subpath string, username string) (rpath string, err error) {
	err = d.run("VirtualPathToRealPath", q(subpath)+", user="+q(username), false, func() error {
		rpath, err = d.inner.VirtualPathToRealPath(subpath, username)
		return err
	})
	return rpath, err
}

func (d *debugAbstraction) RealPathToVirtualPath(rpath string, username string) (vpath string, err error) {
	err = d.run("RealPathToVirtualPath", q(rpath)+", user="+q(username), false, func() error {
		vpath, err = d.inner.RealPathToVirtualPath(rpath, username)
		return err
	})
	return vpath, err
}

func (d *debugAbstraction) FileExists(name string) (exists bool) {
	d.run("FileExists", q(name), false, func() error {
		exists = d.inner.FileExists(name)
		return nil
	})
	return exists
}

func (d *debugAbstraction) IsDir(name string) (isDir bool) {
	d.run("IsDir", q(name), false, func() error {
		isDir = d.inner.IsDir(name)
		return nil
	})
	return isDir
}

func (d *debugAbstraction) Glob(pattern string) (matches []string, err error) {
	err = d.run("Glob", q(pattern), true, func() error {
		matches, err = d.inner.Glob(pattern)
		return err
	})
	return matches, err
}

func (d *debugAbstraction) GetFileSize(name string) (size int64) {
	d.run("GetFileSize", q(name), false, func() error {
		size = d.inner.GetFileSize(name)
		return nil
	})
	return size
}

func (d *debugAbstraction) GetModTime(name string) (modtime int64, err error) {
	err = d.run("GetModTime", q(name), false, func() error {
		modtime, err = d.inner.GetModTime(name)
		return err
	})
	return modtime, err
}

func (d *debugAbstraction) WriteFile(name string, data []byte, perm os.FileMode) error {
	return d.run("WriteFile", fmt.Sprintf("%q, %d bytes", name, len(data)), true, func() error { return d.inner.WriteFile(name, data, perm) })
}

func (d *debugAbstraction) ReadFile(name string) (data []byte, err error) {
	err = d.run("ReadFile", q(name), true, func() error {
		data, err = d.inner.ReadFile(name)
		return err
	})
	return data, err
}

func (d *debugAbstraction) ReadDir(name string) (entries []fs.DirEntry, err error) {
	err = d.run("ReadDir", q(name), true, func() error {
		entries, err = d.inner.ReadDir(name)
		return err
	})
	return entries, err
}

func (d *debugAbstraction) WriteStream(name string, stream io.Reader, mode os.FileMode) error {
	return d.run("WriteStream", q(name), true, func() error { return d.inner.WriteStream(name, stream, mode) })
}

func (d *debugAbstraction) ReadStream(name string) (rc io.ReadCloser, err error) {
	err = d.run("ReadStream", q(name), true, func() error {
		rc, err = d.inner.ReadStream(name)
		return err
	})
	return rc, err
}

func (d *debugAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	return d.run("Walk", q(root), true, func() error { return d.inner.Walk(root, walkFn) })
}

func (d *debugAbstraction) Heartbeat() error {
	return d.run("Heartbeat", "", true, func() error { return d.inner.Heartbeat() })
}
