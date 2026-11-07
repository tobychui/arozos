package smbserver

import (
	"net"
	"time"
)

/*
	backend.go

	The small interface the protocol core calls. Only the aroz package
	implements it against ArozOS, so the core stays testable by itself, the
	same split as sftpserver.Access. Paths are relative to the share root, use
	forward slashes, have no leading slash, and "" is the root.
*/

// FileInfo describes a file or folder. A zero ID makes the core hash the path
// instead, and a zero BirthTime falls back to ModTime.
type FileInfo struct {
	Name      string
	Size      int64
	IsDir     bool
	ModTime   time.Time
	BirthTime time.Time
	ID        uint64
}

// File is an open file. Access is always positional, so requests of one
// client may run at the same time.
type File interface {
	ReadAt(b []byte, off int64) (int, error)
	WriteAt(b []byte, off int64) (int, error)
	Truncate(size int64) error
	Sync() error
	Close() error
}

// Share is one drive as one user sees it. CanRead and CanWrite are asked on
// every operation rather than once at tree connect, so a change of a drive's
// access list reaches sessions that are already open.
type Share interface {
	Name() string
	Comment() string

	//Key identifies the namespace behind the share. Two shares with the same
	//key are the same files, so their locks and share modes are one.
	Key() string

	ReadOnly() bool
	CanRead(path string) bool
	CanWrite(path string) bool

	Stat(path string) (FileInfo, error)
	ReadDir(path string) ([]FileInfo, error)
	Open(path string, flag int) (File, error)
	Mkdir(path string) error
	Remove(path string) error
	Rename(oldPath, newPath string) error
	SetModTime(path string, t time.Time) error

	//Usage returns the total and free bytes the user should see
	Usage() (total, free uint64)

	//HaveSpace reports whether a file may grow by this many bytes
	HaveSpace(extra int64) bool

	//FileChanged runs when an open that changed a file closes, for quotas
	//and ownership. oldSize is -1 for a file this open created.
	FileChanged(path string, oldSize, newSize int64)
}

// UserView is what one logged in user can reach. Shares is evaluated each time
// it is called.
type UserView interface {
	Username() string
	Shares() []Share
}

// Backend connects the server to the accounts of the host.
type Backend interface {
	//LookupHash returns the NT hash of an account and its real spelling. The
	//name is as the client typed it, so lookups should ignore case.
	LookupHash(username string) (name string, ntHash []byte, ok bool)

	//Login returns the view of a verified user
	Login(username string) (UserView, error)

	//Allow is asked for every new connection
	Allow(remote net.IP) bool

	//AuthLog records a login attempt from an ip:port address. For a failed one
	//it may return how long to hold the reply back, and zero leaves that to
	//Config.LoginDelay.
	AuthLog(username, remote string, ok bool) time.Duration
}
