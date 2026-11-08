package smbserver

import (
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	notify.go

	CHANGE_NOTIFY. A client watches a folder by keeping a CHANGE_NOTIFY
	request pending on it; when something in the folder changes the request
	completes with what changed, and the client sends the next one. Changes
	that happen while no request is pending wait on the watch, so none is
	lost between two requests.

	Changes come from two places. Whatever this server does itself is
	reported at once, to every client watching. Changes made around it, by
	the File Manager, another file server or a program on the host, are found
	by listing watched folders again every few seconds. That is done on local
	drives only: listing a cloud drive that often would cost more than it is
	worth, so there only this server's own changes are seen.
*/

// FILE_ACTION_* values of FILE_NOTIFY_INFORMATION.
const (
	actionAdded      uint32 = 1
	actionRemoved    uint32 = 2
	actionModified   uint32 = 3
	actionRenamedOld uint32 = 4
	actionRenamedNew uint32 = 5
)

// FILE_NOTIFY_CHANGE_* completion filter bits.
const (
	notifyFileName   uint32 = 0x001
	notifyDirName    uint32 = 0x002
	notifyAttributes uint32 = 0x004
	notifySize       uint32 = 0x008
	notifyLastWrite  uint32 = 0x010
	notifyCreation   uint32 = 0x040
)

const (
	notifyWatchTree = 0x0001 //SMB2_WATCH_TREE
	notifyMaxQueue  = 256    //Beyond this the client is told to list again
)

// PollableShare is a Share that can be listed often. Watched folders on such a
// share are listed every few seconds to see changes made around the server.
type PollableShare interface {
	CanPoll() bool
}

type notifyEvent struct {
	action uint32
	name   string //Relative to the watched folder, with backslashes
}

type pendingNotify struct {
	op        *asyncOp
	maxOutput uint32
}

// watch is one folder handle that a client watches.
type watch struct {
	c      *conn
	o      *open
	share  Share
	dir    string
	key    string //Of the folder, in the registry
	filter uint32
	tree   bool

	mu       sync.Mutex
	queue    []notifyEvent
	overflow bool
	pending  []pendingNotify
	closed   bool
}

// watchers holds every watch of a server, by folder.
type watchers struct {
	mu      sync.Mutex
	byDir   map[string]map[*watch]struct{}
	folders map[string]*polledFolder
	stop    chan struct{}
	started bool
}

// polledFolder is what a folder held when it was last listed.
type polledFolder struct {
	share   Share
	dir     string
	entries map[string]FileInfo
	rebase  bool //This server changed it: list again without reporting
}

func dirKey(s Share, dir string) string {
	return s.Key() + "\x00" + strings.ToLower(dir)
}

// relativeName is p as seen from the watched folder, or false when p is not
// inside it.
func relativeName(dir, p string, tree bool) (string, bool) {
	var rel string
	if dir == "" {
		rel = p
	} else {
		lowerP, lowerDir := strings.ToLower(p), strings.ToLower(dir)
		if !strings.HasPrefix(lowerP, lowerDir+"/") {
			return "", false
		}
		rel = p[len(dir)+1:]
	}
	if rel == "" || !tree && strings.Contains(rel, "/") {
		return "", false
	}
	return strings.ReplaceAll(rel, "/", "\\"), true
}

func (ws *watchers) add(srv *Server, w *watch) {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if ws.byDir == nil {
		ws.byDir = map[string]map[*watch]struct{}{}
		ws.folders = map[string]*polledFolder{}
		ws.stop = make(chan struct{})
	}
	set := ws.byDir[w.key]
	if set == nil {
		set = map[*watch]struct{}{}
		ws.byDir[w.key] = set
	}
	set[w] = struct{}{}

	if p, ok := w.share.(PollableShare); ok && p.CanPoll() && srv.cfg.NotifyPoll > 0 {
		if _, polled := ws.folders[w.key]; !polled {
			ws.folders[w.key] = &polledFolder{share: w.share, dir: w.dir}
		}
		if !ws.started {
			ws.started = true
			srv.wg.Add(1)
			go ws.pollLoop(srv)
		}
	}
}

func (ws *watchers) remove(w *watch) {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	set := ws.byDir[w.key]
	delete(set, w)
	if len(set) == 0 {
		delete(ws.byDir, w.key)
		delete(ws.folders, w.key)
	}
}

func (ws *watchers) close() {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if ws.stop != nil {
		select {
		case <-ws.stop:
		default:
			close(ws.stop)
		}
	}
}

// changed reports a change this server made, to every watch it concerns.
// kind is the filter bit the change matches.
func (ws *watchers) changed(s Share, p string, action, kind uint32) {
	if p == "" {
		return
	}
	ws.mu.Lock()
	targets := []*watch{}
	names := []string{}
	//The folder itself, then every folder above it for tree watches
	for dir, first := dirName(p), true; ; first = false {
		key := dirKey(s, dir)
		if folder := ws.folders[key]; folder != nil && first {
			folder.rebase = true
		}
		for w := range ws.byDir[key] {
			if w.filter&kind == 0 || !first && !w.tree {
				continue
			}
			if rel, ok := relativeName(w.dir, p, w.tree); ok {
				targets = append(targets, w)
				names = append(names, rel)
			}
		}
		if dir == "" {
			break
		}
		dir = dirName(dir)
	}
	ws.mu.Unlock()

	for i, w := range targets {
		w.post(notifyEvent{action: action, name: names[i]})
	}
}

// renamed reports a rename: a pair in one folder, else a removal and an add.
func (ws *watchers) renamed(s Share, from, to string, isDir bool) {
	kind := notifyFileName
	if isDir {
		kind = notifyDirName
	}
	if strings.EqualFold(dirName(from), dirName(to)) {
		ws.changedPair(s, from, to, kind)
		return
	}
	ws.changed(s, from, actionRemoved, kind)
	ws.changed(s, to, actionAdded, kind)
}

// changedPair posts the old and new name together, so that a client never
// sees one without the other.
func (ws *watchers) changedPair(s Share, from, to string, kind uint32) {
	ws.mu.Lock()
	type hit struct {
		w        *watch
		old, new string
	}
	hits := []hit{}
	for dir, first := dirName(from), true; ; first = false {
		key := dirKey(s, dir)
		if folder := ws.folders[key]; folder != nil && first {
			folder.rebase = true
		}
		for w := range ws.byDir[key] {
			if w.filter&kind == 0 || !first && !w.tree {
				continue
			}
			oldRel, ok1 := relativeName(w.dir, from, w.tree)
			newRel, ok2 := relativeName(w.dir, to, w.tree)
			if ok1 && ok2 {
				hits = append(hits, hit{w, oldRel, newRel})
			}
		}
		if dir == "" {
			break
		}
		dir = dirName(dir)
	}
	ws.mu.Unlock()
	for _, h := range hits {
		h.w.post(notifyEvent{actionRenamedOld, h.old}, notifyEvent{actionRenamedNew, h.new})
	}
}

// post queues events and completes a pending request with them.
func (w *watch) post(events ...notifyEvent) {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	if !w.overflow {
		if len(w.queue)+len(events) > notifyMaxQueue {
			w.overflow = true
			w.queue = nil
		} else {
			w.queue = append(w.queue, events...)
		}
	}
	w.mu.Unlock()
	w.deliver()
}

// deliver hands the queue to the oldest pending request still waiting.
func (w *watch) deliver() {
	for {
		w.mu.Lock()
		if len(w.pending) == 0 || len(w.queue) == 0 && !w.overflow {
			w.mu.Unlock()
			return
		}
		p := w.pending[0]
		w.pending = w.pending[1:]
		res, events, overflow := w.takeLocked(p.maxOutput)
		w.mu.Unlock()
		if w.c.finishAsyncResponse(p.op, res) {
			return
		}
		//That request was cancelled in the meantime: keep the events for
		//the next one
		w.mu.Lock()
		if overflow {
			w.overflow = true
		} else {
			w.queue = append(events, w.queue...)
		}
		w.mu.Unlock()
	}
}

// takeLocked empties the queue into a response that fits maxOutput, or into
// STATUS_NOTIFY_ENUM_DIR, which makes the client list the folder again.
func (w *watch) takeLocked(maxOutput uint32) (*response, []notifyEvent, bool) {
	events := w.queue
	w.queue = nil
	if w.overflow {
		w.overflow = false
		return &response{status: wire.StatusNotifyEnumDir, body: notifyResult(nil)}, nil, true
	}
	data := encodeNotify(events)
	if uint32(len(data)) > maxOutput {
		return &response{status: wire.StatusNotifyEnumDir, body: notifyResult(nil)}, nil, true
	}
	return &response{body: notifyResult(data)}, events, false
}

// ready answers at once when changes are already waiting.
func (w *watch) ready(maxOutput uint32) *response {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.queue) == 0 && !w.overflow {
		return nil
	}
	res, _, _ := w.takeLocked(maxOutput)
	return res
}

// wait parks a request until something changes.
func (w *watch) wait(op *asyncOp, maxOutput uint32) {
	w.mu.Lock()
	closed := w.closed
	if !closed {
		w.pending = append(w.pending, pendingNotify{op: op, maxOutput: maxOutput})
	}
	w.mu.Unlock()
	if closed {
		go w.c.finishAsync(op, wire.StatusNotifyCleanup, nil)
		return
	}
	//A change may have landed between ready and now
	w.deliver()
}

// encodeNotify writes FILE_NOTIFY_INFORMATION entries, each on 4 bytes.
func encodeNotify(events []notifyEvent) []byte {
	if len(events) == 0 {
		return nil
	}
	w := wire.NewWriter(64 * len(events))
	for i, e := range events {
		start := len(w.B)
		name := wire.EncodeUTF16(e.name)
		w.U32(0)
		w.U32(e.action)
		w.U32(uint32(len(name)))
		w.Bytes(name)
		if i < len(events)-1 {
			for len(w.B)%4 != 0 {
				w.U8(0)
			}
			next := len(w.B) - start
			w.B[start] = byte(next)
			w.B[start+1] = byte(next >> 8)
			w.B[start+2] = byte(next >> 16)
			w.B[start+3] = byte(next >> 24)
		}
	}
	return w.B
}

// notifyResult is the CHANGE_NOTIFY response around the entries.
func notifyResult(data []byte) []byte {
	w := wire.NewWriter(8 + len(data))
	w.U16(9)
	if len(data) == 0 {
		w.U16(0)
	} else {
		w.U16(wire.HeaderSize + 8)
	}
	w.U32(uint32(len(data)))
	w.Bytes(data)
	if len(data) == 0 {
		w.U8(0)
	}
	return w.B
}

// pollLoop lists watched folders on local drives, to see changes made
// around the server.
func (ws *watchers) pollLoop(srv *Server) {
	defer srv.wg.Done()
	ticker := time.NewTicker(srv.cfg.NotifyPoll)
	defer ticker.Stop()
	for {
		select {
		case <-ws.stop:
			return
		case <-ticker.C:
		}
		ws.mu.Lock()
		folders := make(map[string]*polledFolder, len(ws.folders))
		for k, f := range ws.folders {
			folders[k] = f
		}
		ws.mu.Unlock()
		for key, f := range folders {
			ws.pollFolder(key, f)
		}
	}
}

func (ws *watchers) pollFolder(key string, f *polledFolder) {
	list, err := f.share.ReadDir(f.dir)
	if err != nil {
		return
	}
	now := make(map[string]FileInfo, len(list))
	for _, e := range list {
		now[e.Name] = e
	}

	ws.mu.Lock()
	if ws.folders[key] != f {
		ws.mu.Unlock()
		return
	}
	before, rebase := f.entries, f.rebase
	f.entries, f.rebase = now, false
	ws.mu.Unlock()
	if before == nil || rebase {
		return
	}

	for name, e := range now {
		p := joinPath(f.dir, name)
		kind := notifyFileName
		if e.IsDir {
			kind = notifyDirName
		}
		old, existed := before[name]
		switch {
		case !existed:
			ws.changedFromPoll(key, f, p, actionAdded, kind)
		case !e.IsDir && (old.Size != e.Size || !old.ModTime.Equal(e.ModTime)):
			ws.changedFromPoll(key, f, p, actionModified, notifySize|notifyLastWrite)
		}
	}
	for name, e := range before {
		if _, still := now[name]; !still {
			kind := notifyFileName
			if e.IsDir {
				kind = notifyDirName
			}
			ws.changedFromPoll(key, f, joinPath(f.dir, name), actionRemoved, kind)
		}
	}
}

// changedFromPoll reports a change found by listing, to the watches of that
// folder alone.
func (ws *watchers) changedFromPoll(key string, f *polledFolder, p string, action, kind uint32) {
	ws.mu.Lock()
	targets := []*watch{}
	for w := range ws.byDir[key] {
		if w.filter&kind != 0 {
			targets = append(targets, w)
		}
	}
	ws.mu.Unlock()
	for _, w := range targets {
		if rel, ok := relativeName(w.dir, p, w.tree); ok {
			w.post(notifyEvent{action: action, name: rel})
		}
	}
}

// startWatch makes the watch of a folder handle on its first CHANGE_NOTIFY.
func (c *conn) startWatch(o *open, q *wire.ChangeNotifyRequest) *watch {
	o.metaMu.Lock()
	defer o.metaMu.Unlock()
	if o.watch != nil {
		return o.watch
	}
	share := o.tree.share
	dir := o.getPath()
	w := &watch{
		c:      c,
		o:      o,
		share:  share,
		dir:    dir,
		key:    dirKey(share, dir),
		filter: q.Filter,
		tree:   q.Flags&notifyWatchTree != 0,
	}
	o.watch = w
	c.srv.watches.add(c.srv, w)
	return w
}

// endWatch stops a watch when its folder closes, and answers what is still
// pending with STATUS_NOTIFY_CLEANUP.
func (s *Server) endWatch(o *open) {
	o.metaMu.Lock()
	w := o.watch
	o.watch = nil
	o.metaMu.Unlock()
	if w == nil {
		return
	}
	s.watches.remove(w)
	w.mu.Lock()
	w.closed = true
	pending := w.pending
	w.pending = nil
	w.mu.Unlock()
	for _, p := range pending {
		w.c.finishAsync(p.op, wire.StatusNotifyCleanup, nil)
	}
}
