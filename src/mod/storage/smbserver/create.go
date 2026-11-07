package smbserver

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"os"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/smbserver/rpc"
	"imuslab.com/arozos/mod/storage/smbserver/state"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// open is one handle the client holds.
type open struct {
	id   wire.FileID
	sess *session
	tree *tree

	io     sync.RWMutex //Shared during I/O, exclusive to close
	closed bool

	isDir  bool
	access uint32
	handle *state.Handle
	file   File

	pipeMu   sync.Mutex
	pipe     *rpc.Pipe
	pipeName string

	dirMu      sync.Mutex
	dirEntries []dirEntry
	dirPos     int
	dirPattern string
	dirLoaded  bool
	dirSent    bool

	metaMu    sync.Mutex
	created   bool
	oldSize   int64
	size      int64
	dirty     bool
	stickyMod time.Time
	notifies  []*asyncOp
}

// getPath returns where the file is now. It lives in the shared table, so that
// a rename through any handle reaches them all.
func (o *open) getPath() string { return o.handle.Path() }

func (o *open) tracePath() string {
	if o.pipe != nil {
		return "pipe:" + o.pipeName
	}
	return o.getPath()
}

// writable reports whether a share lets anything change at this path now.
func writable(s Share, p string) bool {
	return !s.ReadOnly() && !isProtected(p) && s.CanWrite(p)
}

func maximalAccess(s Share, p string) uint32 {
	if writable(s, p) {
		return wire.FileAllAccess
	}
	return wire.ReadOnlyAccess
}

func expandAccess(desired, maximal uint32) uint32 {
	const generic = wire.GenericAll | wire.GenericRead | wire.GenericWrite | wire.GenericExecute | wire.MaximumAllowed
	out := desired &^ generic
	if desired&wire.GenericAll != 0 {
		out |= wire.FileAllAccess
	}
	if desired&wire.GenericRead != 0 {
		out |= wire.FileGenericRead
	}
	if desired&wire.GenericWrite != 0 {
		out |= wire.FileGenericWrite
	}
	if desired&wire.GenericExecute != 0 {
		out |= wire.FileGenericExecute
	}
	if desired&wire.MaximumAllowed != 0 {
		out |= maximal
	}
	return out
}

func (c *conn) newFileID() (wire.FileID, error) {
	var id wire.FileID
	if _, err := rand.Read(id[:8]); err != nil {
		return id, err
	}
	binary.LittleEndian.PutUint64(id[8:], c.srv.fileSeq.Add(1))
	return id, nil
}

// register makes an open reachable by the client.
func (c *conn) register(r *request, o *open) uint32 {
	id, err := c.newFileID()
	if err != nil {
		return wire.StatusInternalError
	}
	o.id = id
	o.sess = r.sess
	o.tree = r.tree

	sess := r.sess
	sess.mu.Lock()
	defer sess.mu.Unlock()
	if len(sess.opens) >= maxOpens {
		return wire.StatusInsufficientResources
	}
	sess.opens[id] = o
	r.chain.fileID = id
	r.chain.hasFile = true
	return wire.StatusOK
}

func (c *conn) handleCreate(r *request) *response {
	q, err := wire.ParseCreate(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	r.traceInfo = q.Name

	if r.tree.isIPC() {
		return c.createPipe(r, q)
	}

	for _, ctx := range q.Contexts {
		switch ctx.Name {
		case wire.ContextDurableRecon, wire.ContextDurableRecon2, wire.ContextTimewarp:
			//No durable handle was granted, and there are no snapshots
			return errorResponse(wire.StatusObjectNameNotFound)
		}
	}

	if q.DesiredAccess&wire.AccessSystemSec != 0 {
		return errorResponse(wire.StatusPrivilegeNotHeld)
	}
	if q.Options&wire.OptionDirectory != 0 && q.Options&wire.OptionNonDirectory != 0 {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if q.Disposition > wire.DispositionOverwriteIf {
		return errorResponse(wire.StatusInvalidParameter)
	}

	rel, status := parsePath(q.Name)
	if status != wire.StatusOK {
		return errorResponse(status)
	}

	share := r.tree.share
	res, err := resolve(share, c.srv.names, rel)
	if err != nil {
		return errorResponse(statusOf(err))
	}
	if !share.CanRead(res.path) {
		return errorResponse(wire.StatusAccessDenied)
	}

	maximal := maximalAccess(share, res.path)
	access := expandAccess(q.DesiredAccess, maximal)
	if access&^maximal != 0 {
		return errorResponse(wire.StatusAccessDenied)
	}

	//What the disposition means for this file
	var action uint32
	create, truncate := false, false
	switch q.Disposition {
	case wire.DispositionOpen:
		action = wire.ActionOpened
	case wire.DispositionCreate:
		if res.exists {
			return errorResponse(wire.StatusObjectNameCollision)
		}
		create = true
	case wire.DispositionOpenIf:
		action = wire.ActionOpened
		create = !res.exists
	case wire.DispositionOverwrite:
		action = wire.ActionOverwritten
		truncate = res.exists
	case wire.DispositionOverwriteIf:
		action = wire.ActionOverwritten
		create = !res.exists
		truncate = res.exists
	case wire.DispositionSupersede:
		action = wire.ActionSuperseded
		create = !res.exists
		truncate = res.exists
	}
	if create {
		action = wire.ActionCreated
	}

	if !res.exists && !create {
		if res.parentExists {
			return errorResponse(wire.StatusObjectNameNotFound)
		}
		return errorResponse(wire.StatusObjectPathNotFound)
	}
	if create && !res.parentExists {
		return errorResponse(wire.StatusObjectPathNotFound)
	}
	if (create || truncate) && maximal != wire.FileAllAccess {
		return errorResponse(wire.StatusAccessDenied)
	}

	isDir := res.exists && res.info.IsDir
	wantDir := q.Options&wire.OptionDirectory != 0
	switch {
	case res.exists && isDir && q.Options&wire.OptionNonDirectory != 0:
		return errorResponse(wire.StatusFileIsADirectory)
	case res.exists && !isDir && wantDir:
		return errorResponse(wire.StatusNotADirectory)
	case truncate && isDir:
		return errorResponse(wire.StatusFileIsADirectory)
	}
	if create {
		isDir = wantDir
	}

	deleteOnClose := q.Options&wire.OptionDeleteOnCLS != 0
	if deleteOnClose && (access&wire.AccessDelete == 0 || res.path == "") {
		return errorResponse(wire.StatusAccessDenied)
	}

	key := fileKey(share, res.path)
	handle, status := c.srv.files.Open(key, res.path, access, q.ShareAccess)
	if status != wire.StatusOK {
		return errorResponse(status)
	}

	o := &open{isDir: isDir, access: access, handle: handle, oldSize: -1}
	if st := c.materialize(o, share, q, res, create, truncate); st != wire.StatusOK {
		handle.Close()
		return errorResponse(st)
	}
	if create {
		c.srv.names.forget(share, dirName(res.path))
	}
	if deleteOnClose {
		handle.SetDeleteOnClose()
	}

	info, err := share.Stat(res.path)
	if err != nil {
		c.releaseOpen(o)
		return errorResponse(statusOf(err))
	}
	handle.SetFileID(info.ID)
	o.size = info.Size
	if !create {
		o.oldSize = info.Size
		if truncate {
			o.oldSize = res.info.Size
			o.dirty = true
		}
	} else {
		o.created = true
		o.dirty = true
	}

	if st := c.register(r, o); st != wire.StatusOK {
		c.releaseOpen(o)
		return errorResponse(st)
	}
	r.traceInfo = res.path
	return &response{body: c.createBody(o, res.path, info, action, q)}
}

// materialize does the actual file system work of a CREATE.
func (c *conn) materialize(o *open, share Share, q *wire.CreateRequest, res resolved, create, truncate bool) uint32 {
	if o.isDir {
		if create {
			if err := share.Mkdir(res.path); err != nil {
				return statusOf(err)
			}
		}
		return wire.StatusOK
	}

	dataRead := o.access&(wire.FileReadData|wire.FileExecute) != 0
	dataWrite := o.access&(wire.FileWriteData|wire.FileAppendData) != 0
	if !dataRead && !dataWrite && !create && !truncate {
		//An attributes only open needs no file handle
		return wire.StatusOK
	}

	flag := os.O_RDONLY
	if dataWrite || create || truncate {
		flag = os.O_RDWR
	}
	if create {
		flag |= os.O_CREATE
		if q.Disposition == wire.DispositionCreate {
			flag |= os.O_EXCL
		}
	}
	if truncate {
		flag |= os.O_TRUNC
	}
	file, err := share.Open(res.path, flag)
	if err != nil {
		return statusOf(err)
	}
	o.file = file
	return wire.StatusOK
}

// releaseOpen undoes a CREATE that failed after the file was opened.
func (c *conn) releaseOpen(o *open) {
	if o.file != nil {
		o.file.Close()
	}
	o.handle.Close()
}

func attributesOf(info FileInfo) uint32 {
	var a uint32
	if info.IsDir {
		a = wire.AttrDirectory
	} else {
		a = wire.AttrArchive
	}
	if strings.HasPrefix(info.Name, ".") && info.Name != "." && info.Name != ".." {
		a |= wire.AttrHidden
	}
	return a
}

func allocationOf(size int64) uint64 {
	return (uint64(size) + 4095) &^ 4095
}

func birthOf(info FileInfo) time.Time {
	if info.BirthTime.IsZero() {
		return info.ModTime
	}
	return info.BirthTime
}

func (c *conn) createBody(o *open, p string, info FileInfo, action uint32, q *wire.CreateRequest) []byte {
	const fixed = 88
	w := wire.NewWriter(fixed + 96)
	w.U16(89)
	w.U8(0) //No oplock: nothing may be cached until breaks exist
	w.U8(0)
	w.U32(action)
	w.U64(wire.Filetime(birthOf(info)))
	w.U64(wire.Filetime(info.ModTime))
	w.U64(wire.Filetime(info.ModTime))
	w.U64(wire.Filetime(info.ModTime))
	w.U64(allocationOf(info.Size))
	w.U64(uint64(info.Size))
	w.U32(attributesOf(info))
	w.U32(0)
	w.Bytes(o.id[:])

	contexts := c.createContexts(o, p, info, q)
	if len(contexts) == 0 {
		w.U32(0)
		w.U32(0)
		return w.B
	}
	w.U32(wire.HeaderSize + fixed)
	w.U32(uint32(len(contexts)))
	w.Bytes(contexts)
	return w.B
}

// createContexts answers MxAc and QFid. Lease and durable handle requests get
// no answer at all, which is how a server declines them.
func (c *conn) createContexts(o *open, p string, info FileInfo, q *wire.CreateRequest) []byte {
	type reply struct {
		name string
		data []byte
	}
	replies := []reply{}
	share := o.tree.share
	for _, ctx := range q.Contexts {
		switch ctx.Name {
		case wire.ContextMaximalAccess:
			w := wire.NewWriter(8)
			w.U32(0)
			w.U32(maximalAccess(share, p))
			replies = append(replies, reply{ctx.Name, w.B})
		case wire.ContextQueryOnDiskID:
			w := wire.NewWriter(32)
			w.U64(fileNumber(share, p, info))
			w.U64(volumeSerial(share))
			w.Zero(16)
			replies = append(replies, reply{ctx.Name, w.B})
		}
	}

	w := wire.NewWriter(64)
	for i, rep := range replies {
		start := w.Len()
		w.U32(0) //Next, filled in below
		w.U16(16)
		w.U16(uint16(len(rep.name)))
		w.U16(0)
		w.U16(24)
		w.U32(uint32(len(rep.data)))
		w.Bytes([]byte(rep.name))
		w.Zero(4)
		w.Bytes(rep.data)
		if i < len(replies)-1 {
			w.Align(8)
			binary.LittleEndian.PutUint32(w.B[start:], uint32(w.Len()-start))
		}
	}
	return w.B
}

func (c *conn) createPipe(r *request, q *wire.CreateRequest) *response {
	name := strings.ToLower(strings.TrimPrefix(q.Name, `\`))
	pipe, ok := rpc.NewPipe(name, c.rpcEnv(r.sess))
	if !ok {
		return errorResponse(wire.StatusObjectNameNotFound)
	}
	o := &open{pipe: pipe, pipeName: name, access: wire.FileAllAccess}
	if st := c.register(r, o); st != wire.StatusOK {
		return errorResponse(st)
	}

	const fixed = 88
	w := wire.NewWriter(fixed)
	w.U16(89)
	w.U8(0)
	w.U8(0)
	w.U32(wire.ActionOpened)
	w.Zero(32) //Four times
	w.U64(4096)
	w.U64(0)
	w.U32(wire.AttrNormal)
	w.U32(0)
	w.Bytes(o.id[:])
	w.U32(0)
	w.U32(0)
	return &response{body: w.B}
}

func (c *conn) handleClose(r *request) *response {
	flags, id, err := wire.ParseClose(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	o, status := r.open(id)
	if status != wire.StatusOK {
		return errorResponse(status)
	}

	var info FileInfo
	gotInfo := false
	if flags&wire.CloseFlagPostQuery != 0 && o.pipe == nil {
		var statErr error
		info, statErr = o.tree.share.Stat(o.getPath())
		gotInfo = statErr == nil
	}

	r.sess.mu.Lock()
	delete(r.sess.opens, o.id)
	r.sess.mu.Unlock()
	c.closeOpen(o)

	w := wire.NewWriter(60)
	w.U16(60)
	if gotInfo {
		w.U16(wire.CloseFlagPostQuery)
		w.U32(0)
		w.U64(wire.Filetime(birthOf(info)))
		w.U64(wire.Filetime(info.ModTime))
		w.U64(wire.Filetime(info.ModTime))
		w.U64(wire.Filetime(info.ModTime))
		w.U64(allocationOf(info.Size))
		w.U64(uint64(info.Size))
		w.U32(attributesOf(info))
	} else {
		w.Zero(58)
	}
	return &response{body: w.B}
}

// closeOpen ends an open. It waits for I/O still running on the handle, so a
// file is never closed under a request that is reading it.
func (c *conn) closeOpen(o *open) {
	o.io.Lock()
	defer o.io.Unlock()
	if o.closed {
		return
	}
	o.closed = true

	o.metaMu.Lock()
	notifies := o.notifies
	o.notifies = nil
	sticky := o.stickyMod
	dirty := o.dirty
	oldSize, size := o.oldSize, o.size
	o.metaMu.Unlock()
	for _, op := range notifies {
		c.finishAsync(op, wire.StatusNotifyCleanup, nil)
	}

	if o.pipe != nil {
		return
	}
	if o.file != nil {
		if err := o.file.Close(); err != nil {
			logger.PrintAndLog(logTitle, "Close failed for "+o.getPath(), err)
		}
	}

	share := o.tree.share
	p := o.getPath()
	if !sticky.IsZero() {
		//A time the client set wins over the writes that came after it
		share.SetModTime(p, sticky)
	}
	last := o.handle.Close()

	//Accounted for first, so that a file deleted here gives back only what
	//it took, even if it never existed before this open
	if dirty {
		share.FileChanged(p, oldSize, size)
	}
	if last {
		if err := share.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			logger.PrintAndLog(logTitle, "Delete on close failed for "+p, err)
		}
		c.srv.names.forget(share, dirName(p))
	}
}
