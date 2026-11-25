//go:build !(linux && mipsle) && !(windows && arm) && !(windows && 386)

package syncthingserv

/*
	Glue between Syncthing and the rest of ArozOS: its log, and the file
	system type the folders use.
*/

import (
	"context"
	"errors"
	"log"
	"log/slog"
	"os"
	"strings"

	stfs "github.com/syncthing/syncthing/lib/fs"
	"imuslab.com/arozos/mod/info/logger"
)

// fsTypeArozOS is Syncthing's local file system without symbolic links.
const fsTypeArozOS = "arozos"

// errSymlink is what a device that sends a symbolic link gets back.
var errSymlink = errors.New("symbolic links are not allowed on this server")

// noSymlinkFS refuses to create symbolic links. The local drives of ArozOS
// follow links, so a link a device sends (Syncthing recreates them on Linux
// and macOS) could otherwise open files outside the user's drive. Everything
// else is Syncthing's own local file system.
type noSymlinkFS struct {
	stfs.Filesystem
}

func (f *noSymlinkFS) CreateSymlink(target, name string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("fileservers/servers/syncthingserv", "noSymlinkFS.CreateSymlink: target=%.120q name=%.120q", target, name)
	}
	return errSymlink
}

func registerNoSymlinkFS() {
	logger.DebugTrace("fileservers/servers/syncthingserv", "registerNoSymlinkFS")
	stfs.RegisterFilesystemType(fsTypeArozOS, func(root string, opts ...stfs.Option) (stfs.Filesystem, error) {
		return &noSymlinkFS{Filesystem: stfs.NewFilesystem(stfs.FilesystemTypeBasic, root, opts...)}, nil
	})
}

// installLogBridge sends Syncthing's log to the system log. Syncthing makes
// its own handler the default of log/slog when it loads, and that also takes
// over the standard log package, which the system logger prints through.
// The handler below puts slog records into the system log, and the log
// package gets its own output back (os.Stderr, as before Syncthing loaded).
func installLogBridge() {
	logger.Debug("fileservers/servers/syncthingserv", "installLogBridge")
	slog.SetDefault(slog.New(&slogBridge{}))
	log.SetOutput(os.Stderr)
	log.SetFlags(log.LstdFlags)
}

// slogBridge writes slog records of Info and above to the system log.
type slogBridge struct {
	attrs  []slog.Attr
	groups []string
}

func (h *slogBridge) Enabled(_ context.Context, level slog.Level) bool {
	logger.DebugTrace("fileservers/servers/syncthingserv", "slogBridge.Enabled")
	return level >= slog.LevelInfo
}

func (h *slogBridge) Handle(_ context.Context, r slog.Record) error {
	logger.DebugTrace("fileservers/servers/syncthingserv", "slogBridge.Handle")
	var b strings.Builder
	switch {
	case r.Level >= slog.LevelError:
		b.WriteString("ERROR ")
	case r.Level >= slog.LevelWarn:
		b.WriteString("WARN ")
	}
	b.WriteString(r.Message)
	prefix := ""
	if len(h.groups) > 0 {
		prefix = strings.Join(h.groups, ".") + "."
	}
	write := func(a slog.Attr) {
		a.Value = a.Value.Resolve()
		if a.Equal(slog.Attr{}) {
			return
		}
		b.WriteString(" ")
		b.WriteString(prefix + a.Key)
		b.WriteString("=")
		b.WriteString(a.Value.String())
	}
	for _, a := range h.attrs {
		write(a)
	}
	r.Attrs(func(a slog.Attr) bool {
		write(a)
		return true
	})
	logger.PrintAndLog("Syncthing", b.String(), nil)
	return nil
}

func (h *slogBridge) WithAttrs(attrs []slog.Attr) slog.Handler {
	if logger.IsDebugTrace() {
		logger.DebugTracef("fileservers/servers/syncthingserv", "slogBridge.WithAttrs: len(attrs)=%d", len(attrs))
	}
	next := &slogBridge{groups: h.groups}
	next.attrs = append(append([]slog.Attr{}, h.attrs...), attrs...)
	return next
}

func (h *slogBridge) WithGroup(name string) slog.Handler {
	if logger.IsDebugTrace() {
		logger.DebugTracef("fileservers/servers/syncthingserv", "slogBridge.WithGroup: name=%.120q", name)
	}
	if name == "" {
		return h
	}
	return &slogBridge{attrs: h.attrs, groups: append(append([]string{}, h.groups...), name)}
}
