// Package aroz is the backend of the SMB server (github.com/tobychui/smbsrv)
// over ArozOS accounts and drives. It is the only part of the SMB server that
// imports ArozOS packages.
package aroz

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/tobychui/smbsrv"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
)

// ErrOutsideDrive is returned for a link that leads off the drive.
var ErrOutsideDrive = os.ErrPermission

// internalFolder is the folder ArozOS keeps its own data in, in every folder
// of a drive. smbsrv hides it and refuses writes into it (InternalFolder).
const internalFolder = ".metadata"

// Account is what a session asks of a user. *user.User provides the first
// three. CanRead and CanWrite are asked on every operation, so that a change of
// a drive's access list reaches sessions that are already open.
type Account interface {
	GetAllFileSystemHandler() []*filesystem.FileSystemHandler
	CanRead(vpath string) bool
	CanWrite(vpath string) bool
}

// Quota is the storage quota of a user. *quota.QuotaHandler provides it.
type Quota interface {
	HaveSpace(size int64) bool
	AllocateSpace(filesize int64) error
	ReclaimSpace(filesize int64) error
}

// CapacityFunc reports the size of the drive behind a virtual path.
type CapacityFunc func(username, vpath string) (total, free uint64, ok bool)

// Options connects a Backend to the rest of the system.
type Options struct {
	//Credentials is the source of NT hashes
	Credentials CredentialStore

	//LookupUser returns the account and quota of a verified user
	LookupUser func(username string) (Account, Quota, error)

	//Capacity is optional
	Capacity CapacityFunc

	//AllowIP is optional and is asked after the private network rule
	AllowIP func(ip string) bool

	//LogAuth is optional
	LogAuth func(username, remote string, ok bool)

	//FailureDelay is optional and sets how long a failed login waits
	FailureDelay func(username, remote string, ok bool) time.Duration

	//AllowPublicAddresses turns off the private network rule. Port 445 must
	//not reach the internet, so this is off unless an admin asks for it.
	AllowPublicAddresses bool

	//StageDir holds the local copies of files on buffered drives. Empty uses
	//the drive's buffer folder, else the system temp folder.
	StageDir string

	//KeepDir receives the local copy of a file whose upload failed, so it
	//must survive a restart. Empty is a "failed" folder in the stage folder.
	KeepDir string

	//StageLimit returns the largest file of a buffered drive SMB serves. It is
	//asked on every open, so a change applies at once. Nil or zero is
	//DefaultStageLimit, and a negative number has no limit.
	StageLimit func() int64

	//TimeMachine returns the drive a user picked for Time Machine backups and
	//the most they may take, 0 for no limit. It is asked at every login and
	//whenever a Mac asks for the free space, so a new limit applies at once.
	//Nil, or ok false, gives the user no TimeMachine share (timemachine.go)
	TimeMachine func(username string) (drive string, maxSize uint64, ok bool)

	//UseTrash reports whether deleted files go to the trash bin, asked on
	//every delete. Trash moves one file there the way the File Manager does,
	//and returns ErrTrashFull when the user's bin has no room left.
	UseTrash func() bool
	Trash    func(fsh *filesystem.FileSystemHandler, subpath, rpath, username string) error
}

// ErrTrashFull is what Trash returns when the bin is over its size limit. The
// file is then deleted for good, as Samba's recycle module does, because an
// SMB client cannot be asked what to do instead.
var ErrTrashFull = errors.New("smbserver/aroz: the trash bin is full")

// Backend implements smbsrv.Backend.
type Backend struct {
	opt Options
}

// New returns a Backend.
func New(opt Options) (*Backend, error) {
	if opt.Credentials == nil || opt.LookupUser == nil {
		return nil, errors.New("smbserver/aroz: credentials and a user lookup are required")
	}
	return &Backend{opt: opt}, nil
}

// LookupHash implements smbsrv.Backend.
func (b *Backend) LookupHash(username string) (string, []byte, bool) {
	return b.opt.Credentials.Lookup(username)
}

// Login implements smbsrv.Backend.
func (b *Backend) Login(username string) (smbsrv.UserView, error) {
	account, quota, err := b.opt.LookupUser(username)
	if err != nil {
		logger.Debugf("SMB", "Login(%q): user not looked up: %v", username, err)
		return nil, err
	}
	logger.Debugf("SMB", "Login(%q): account set=%v, quota set=%v", username, account != nil, quota != nil)
	return &view{username: username, account: account, quota: quota, capacity: b.opt.Capacity, opt: &b.opt}, nil
}

// Allow implements smbsrv.Backend.
func (b *Backend) Allow(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if !b.opt.AllowPublicAddresses && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
		return false
	}
	if b.opt.AllowIP != nil {
		return b.opt.AllowIP(ip.String())
	}
	return true
}

// AuthLog implements smbsrv.Backend.
func (b *Backend) AuthLog(username, remote string, ok bool) time.Duration {
	if b.opt.LogAuth != nil {
		b.opt.LogAuth(username, remote, ok)
	}
	if b.opt.FailureDelay != nil {
		return b.opt.FailureDelay(username, remote, ok)
	}
	return 0
}

type view struct {
	username string
	account  Account
	quota    Quota
	capacity CapacityFunc
	opt      *Options

	usageMu sync.Mutex
	usage   map[string]usageEntry
}

// usageEntry remembers a drive's size. Finding it can start a process, and
// Explorer asks for the free space all the time.
type usageEntry struct {
	total, free uint64
	loaded      time.Time
}

const usageCacheTTL = 5 * time.Second

func (v *view) Username() string { return v.username }

// Shares lists one share per drive.
func (v *view) Shares() []smbsrv.Share {
	out := []smbsrv.Share{}
	for _, fsh := range v.account.GetAllFileSystemHandler() {
		if fsh.Closed {
			continue
		}
		//The share keeps this handler: after a pool reload it still points at
		//the old, closed one until the client lists the shares again
		logger.Debugf("SMB", "Shares(%q): %s", v.username, fsh.Describe())
		out = append(out, newShare(fsh, v))
	}
	if tm := v.timeMachineShare(); tm != nil {
		out = append(out, tm)
	}
	return out
}

// share is one drive for one user.
type share struct {
	fsh   *filesystem.FileSystemHandler
	v     *view
	local bool

	rootOnce sync.Once
	root     string //The real location of the share root, links resolved

	//sub is the folder of the drive the share starts at, "" for the drive
	//root. Only the TimeMachine share has one
	sub         string
	timeMachine bool
	tmMaxSize   uint64
}

func newShare(fsh *filesystem.FileSystemHandler, v *view) *share {
	return &share{fsh: fsh, v: v, local: !fsh.IsNetworkDrive()}
}

func (s *share) Name() string {
	if s.timeMachine {
		return TimeMachineShareName
	}
	return s.fsh.UUID
}

func (s *share) Comment() string {
	if s.timeMachine {
		return "Time Machine backups on " + s.fsh.Name
	}
	return s.fsh.Name
}

// Key tells drives apart. user:/ and the like resolve to another folder for
// every user, so their files are only the same files within one user.
func (s *share) Key() string {
	key := s.fsh.UUID
	if s.fsh.Hierarchy == "user" {
		key += "/" + strings.ToLower(s.v.username)
	}
	if s.sub != "" {
		key += "/" + strings.ToLower(s.sub)
	}
	return key
}

func (s *share) ReadOnly() bool { return s.fsh.ReadOnly }

// InternalFolder implements smbsrv.InternalShare. ArozOS keeps version
// history and named streams in .metadata folders, so they are left out of
// listings and refused to writes over SMB.
func (s *share) InternalFolder() string { return internalFolder }

func (s *share) vpath(p string) string {
	switch {
	case s.sub == "":
		return s.fsh.UUID + ":/" + p
	case p == "":
		return s.fsh.UUID + ":/" + s.sub
	}
	return s.fsh.UUID + ":/" + s.sub + "/" + p
}

// CanPoll lets watched folders of local drives be listed every few seconds.
func (s *share) CanPoll() bool { return s.local }

func (s *share) CanRead(p string) bool { return s.v.account.CanRead(s.vpath(basePath(p))) }

func (s *share) CanWrite(p string) bool { return s.v.account.CanWrite(s.vpath(basePath(p))) }

// real turns a share path into one for the abstraction, after making sure no
// link along the way leads off the drive.
func (s *share) real(p string) (string, error) {
	p = sharePath(p)
	rpath, err := s.fsh.FileSystemAbstraction.VirtualPathToRealPath(s.vpath(p), s.v.username)
	if err != nil {
		return "", err
	}
	if err := s.confine(rpath); err != nil {
		return "", err
	}
	return rpath, nil
}

func (s *share) driveRoot() string {
	s.rootOnce.Do(func() {
		root, err := s.fsh.FileSystemAbstraction.VirtualPathToRealPath(s.vpath(""), s.v.username)
		if err != nil {
			return
		}
		//A user folder, or the Time Machine folder, may not exist before the
		//first use
		if s.fsh.Hierarchy == "user" || s.sub != "" {
			s.fsh.FileSystemAbstraction.MkdirAll(root, 0775)
		}
		if resolved, err := filepath.EvalSymlinks(root); err == nil {
			if abs, err := filepath.Abs(resolved); err == nil {
				s.root = abs
			}
		}
	})
	return s.root
}

// confine refuses a path that a symbolic link carries off the drive. The
// deepest part that exists is checked, so a new file below a link is caught
// too, and a dangling link is refused because writing through it would create
// the target somewhere else.
func (s *share) confine(rpath string) error {
	if !s.local {
		return nil
	}
	root := s.driveRoot()
	if root == "" {
		return nil
	}
	for p := rpath; ; {
		resolved, err := filepath.EvalSymlinks(p)
		if err == nil {
			abs, err := filepath.Abs(resolved)
			if err != nil {
				return err
			}
			if abs != root && !strings.HasPrefix(abs, root+string(filepath.Separator)) {
				return ErrOutsideDrive
			}
			return nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			//Not a link problem, the operation itself will report it
			return nil
		}
		if info, err := os.Lstat(p); err == nil && info.Mode()&os.ModeSymlink != 0 {
			return ErrOutsideDrive
		}
		parent := filepath.Dir(p)
		if parent == p {
			return nil
		}
		p = parent
	}
}

func infoOf(name string, fi os.FileInfo) smbsrv.FileInfo {
	out := smbsrv.FileInfo{
		Name:    name,
		Size:    fi.Size(),
		IsDir:   fi.IsDir(),
		ModTime: fi.ModTime(),
		ID:      fileID(fi),
	}
	if created, ok := filesystem.GetFileCreationTime(fi); ok {
		out.BirthTime = time.Unix(created, 0)
	}
	return out
}

func (s *share) Stat(p string) (smbsrv.FileInfo, error) {
	rpath, err := s.real(p)
	if err != nil {
		return smbsrv.FileInfo{}, err
	}
	fi, err := s.fsh.FileSystemAbstraction.Stat(rpath)
	if err != nil {
		return smbsrv.FileInfo{}, err
	}
	name := p
	if i := strings.LastIndexByte(p, '/'); i >= 0 {
		name = p[i+1:]
	}
	return infoOf(name, fi), nil
}

func (s *share) ReadDir(p string) ([]smbsrv.FileInfo, error) {
	defer logger.TracePanic("SMB", "listing "+p+" on "+s.fsh.UUID+":/ for "+s.v.username)
	rpath, err := s.real(p)
	if err != nil {
		logger.Debugf("SMB", "ReadDir(%q) on %s for %q: path refused: %v", p, s.fsh.Describe(), s.v.username, err)
		return nil, err
	}
	entries, err := s.fsh.FileSystemAbstraction.ReadDir(rpath)
	logger.Debugf("SMB", "ReadDir(%q) on %s for %q: %d entries, error: %v", rpath, s.fsh.Describe(), s.v.username, len(entries), err)
	if err != nil {
		return nil, err
	}
	out := make([]smbsrv.FileInfo, 0, len(entries))
	for _, e := range entries {
		fi, err := e.Info()
		if err != nil {
			continue //Gone since the listing was read
		}
		if fi.Mode()&os.ModeSymlink != 0 {
			//Report what the link points at, and hide one leading off the drive
			child := e.Name()
			if p != "" {
				child = p + "/" + child
			}
			target, err := s.Stat(child)
			if err != nil {
				continue
			}
			out = append(out, target)
			continue
		}
		out = append(out, infoOf(e.Name(), fi))
	}
	return out, nil
}

// stage says where this drive keeps local copies, and where failed ones go.
func (s *share) stage() stageConfig {
	c := stageConfig{limit: DefaultStageLimit}
	switch {
	case s.v.opt != nil && s.v.opt.StageDir != "":
		c.dir = s.v.opt.StageDir
	case s.fsh.RuntimePersistenceConfig.LocalBufferPath != "":
		c.dir = filepath.Join(s.fsh.RuntimePersistenceConfig.LocalBufferPath, "smb")
	default:
		c.dir = filepath.Join(os.TempDir(), "arozos-smb")
	}
	c.keepDir = filepath.Join(c.dir, failedFolder)
	if s.v.opt != nil && s.v.opt.KeepDir != "" {
		c.keepDir = s.v.opt.KeepDir
	}
	if s.v.opt != nil && s.v.opt.StageLimit != nil {
		if limit := s.v.opt.StageLimit(); limit != 0 {
			c.limit = limit
		}
	}
	return c
}

func (s *share) Open(p string, flag int) (smbsrv.File, error) {
	defer logger.TracePanic("SMB", "opening "+p+" on "+s.fsh.UUID+":/ for "+s.v.username)
	rpath, err := s.real(p)
	logger.Debugf("SMB", "Open(%q, flag %#x) on %s for %q: %q, buffered: %v, error: %v", p, flag, s.fsh.Describe(), s.v.username, rpath, s.fsh.RequireBuffer, err)
	if err != nil {
		return nil, err
	}
	if flag&os.O_CREATE != 0 && basePath(p) != p {
		if err := s.makeStreamDir(p); err != nil {
			return nil, err
		}
	}
	if s.fsh.RequireBuffer {
		return openStaged(s.fsh, rpath, s.vpath(sharePath(p)), flag, s.stage())
	}
	file, err := s.fsh.FileSystemAbstraction.OpenFile(rpath, flag, 0775)
	if err != nil {
		return nil, err
	}
	return file, nil
}

func (s *share) Mkdir(p string) error {
	rpath, err := s.real(p)
	if err != nil {
		return err
	}
	err = s.fsh.FileSystemAbstraction.Mkdir(rpath, 0775)
	logger.Debugf("SMB", "Mkdir(%q) on %s for %q, error: %v", rpath, s.fsh.Describe(), s.v.username, err)
	return err
}

func (s *share) Remove(p string) error {
	defer logger.TracePanic("SMB", "removing "+p+" on "+s.fsh.UUID+":/ for "+s.v.username)
	rpath, err := s.real(p)
	logger.Debugf("SMB", "Remove(%q) on %s for %q: %q, quota set: %v, error: %v", p, s.fsh.Describe(), s.v.username, rpath, s.v.quota != nil, err)
	if err != nil {
		return err
	}
	if s.wantsTrash(p) {
		if fi, err := s.fsh.FileSystemAbstraction.Stat(rpath); err == nil && !fi.IsDir() {
			err := s.v.opt.Trash(s.fsh, "/"+p, rpath, s.v.username)
			if err == nil {
				//Still on the drive, so it still counts against the quota.
				//Its streams are not restored with it.
				s.dropStreams(p)
				return nil
			}
			if !errors.Is(err, ErrTrashFull) {
				return err
			}
			logger.PrintAndLog("SMB", "The trash bin of "+s.v.username+" is full, "+s.vpath(p)+" was deleted for good", nil)
		}
	}
	size := int64(0)
	fi, statErr := s.fsh.FileSystemAbstraction.Stat(rpath)
	if s.tracksQuota() && statErr == nil && !fi.IsDir() {
		size = fi.Size()
	}
	if statErr == nil && fi.IsDir() {
		//The server checked the folder holds nothing else; its versions,
		//thumbnails and streams go with it, as in the File Manager
		internal := strings.TrimSuffix(rpath, "/") + "/.metadata"
		if s.fsh.FileSystemAbstraction.FileExists(internal) {
			s.fsh.FileSystemAbstraction.RemoveAll(internal)
		}
	}
	if err := s.fsh.FileSystemAbstraction.Remove(rpath); err != nil {
		return err
	}
	if size > 0 {
		s.v.quota.ReclaimSpace(size)
	}
	if basePath(p) == p {
		s.dropStreams(p)
	}
	return nil
}

func (s *share) Rename(oldPath, newPath string) error {
	defer logger.TracePanic("SMB", "renaming "+oldPath+" to "+newPath+" on "+s.fsh.UUID+":/ for "+s.v.username)
	source, err := s.real(oldPath)
	if err != nil {
		return err
	}
	target, err := s.real(newPath)
	if err != nil {
		return err
	}
	logger.Debugf("SMB", "Rename(%q -> %q) on %s for %q", source, target, s.fsh.Describe(), s.v.username)
	//A rename can replace a file, whose space comes back
	replaced := int64(0)
	if s.tracksQuota() && !strings.EqualFold(oldPath, newPath) {
		if fi, err := s.fsh.FileSystemAbstraction.Stat(target); err == nil && !fi.IsDir() {
			replaced = fi.Size()
		}
	}
	if err := s.fsh.FileSystemAbstraction.Rename(source, target); err != nil {
		return err
	}
	if replaced > 0 {
		s.v.quota.ReclaimSpace(replaced)
	}
	if !strings.EqualFold(oldPath, newPath) {
		s.moveStreams(oldPath, newPath)
	}
	return nil
}

func (s *share) SetModTime(p string, t time.Time) error {
	rpath, err := s.real(p)
	if err != nil {
		return err
	}
	err = s.fsh.FileSystemAbstraction.Chtimes(rpath, t, t)
	if !s.local && (errors.Is(err, arozfs.ErrOperationNotSupported) || errors.Is(err, arozfs.ErrNullOperation)) {
		//WebDAV, FTP and S3 keep their own times. File Explorer sets the
		//times at the end of every copy, and must not fail the copy for it.
		return nil
	}
	return err
}

// tracksQuota reports whether this drive counts against the user's quota.
func (s *share) tracksQuota() bool {
	return s.fsh.Hierarchy == "user" && s.v.quota != nil
}

func (s *share) Usage() (uint64, uint64) {
	var total, free uint64
	key := s.vpath("")
	s.v.usageMu.Lock()
	cached, ok := s.v.usage[key]
	s.v.usageMu.Unlock()
	if ok && time.Since(cached.loaded) < usageCacheTTL {
		total, free = cached.total, cached.free
	} else if s.v.capacity != nil {
		if t, f, ok := s.v.capacity(s.v.username, key); ok {
			total, free = t, f
			s.v.usageMu.Lock()
			if s.v.usage == nil {
				s.v.usage = map[string]usageEntry{}
			}
			s.v.usage[key] = usageEntry{total: t, free: f, loaded: time.Now()}
			s.v.usageMu.Unlock()
		}
	}
	if total == 0 {
		//An unknown size still has to look like a usable drive
		total, free = 1<<42, 1<<41
	}
	return total, free
}

func (s *share) HaveSpace(extra int64) bool {
	if !s.tracksQuota() {
		return true
	}
	return s.v.quota.HaveSpace(extra)
}

func (s *share) FileChanged(p string, oldSize, newSize int64) {
	if !s.tracksQuota() {
		return
	}
	if oldSize < 0 {
		oldSize = 0
	}
	switch change := newSize - oldSize; {
	case change > 0:
		s.v.quota.AllocateSpace(change)
	case change < 0:
		s.v.quota.ReclaimSpace(-change)
	}
}

// CredentialStore finds the NT hash of a user.
type CredentialStore interface {
	Lookup(username string) (name string, ntHash []byte, ok bool)
}
