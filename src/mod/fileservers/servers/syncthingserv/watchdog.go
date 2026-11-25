package syncthingserv

/*
	Stall watchdog

	Syncthing pulls a file by asking a device for each of its blocks, and
	waits for every answer without a time limit: only the answer, the folder
	stopping or the connection closing ends the wait. A device that keeps the
	connection alive but never answers some requests (the iOS apps do this
	while iOS holds them back) leaves the folder syncing forever with nothing
	arriving. Pausing and resuming the folder gives those requests up and asks
	again, so the watchdog does that once a syncing folder has received
	nothing for a while.

	The wait doubles each time a folder is restarted without finishing a
	file in between, so a device that is only very slow is not restarted
	over and over, losing the blocks it was sending each time.
*/

import (
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

const (
	stallCheckInterval = 30 * time.Second
	stallTimeout       = 3 * time.Minute  //Syncing with nothing arriving for this long restarts the folder
	stallTimeoutMax    = 30 * time.Minute //The longest the doubled wait gets
	stateSyncing       = "syncing"        //Syncthing's name of the pulling state
)

// progressMark is what changes while a folder receives files.
type progressMark struct {
	localFiles  int   //Changes when a file is finished or deleted
	localBytes  int64 //Changes when a file is finished or deleted
	pulledBytes int64 //Grows as blocks of the files being pulled arrive
}

func markOf(st FolderStatus) (out0 progressMark) {
	defer logger.Out1(logger.In1("fileservers/servers/syncthingserv", "markOf", "&st", &st), &out0)
	return progressMark{localFiles: st.LocalFiles, localBytes: st.LocalBytes, pulledBytes: st.PulledBytes}
}

// finished reports a file finished or deleted since the other mark. The
// pulled bytes also change when a restarted folder picks up its temporary
// files again, so only these count as real progress for the backoff.
func (p progressMark) finished(other progressMark) (out0 bool) {
	defer logger.Out1(logger.In2("fileservers/servers/syncthingserv", "progressMark.finished", "&p", &p, "&other", &other), &out0)
	return p.localFiles != other.localFiles || p.localBytes != other.localBytes
}

type stallState struct {
	mark    progressMark
	syncing bool          //State at the last look
	since   time.Time     //Last change, start of syncing, or last restart
	timeout time.Duration //How long nothing may arrive before a restart
}

// stallWatch follows the progress of every folder.
type stallWatch struct {
	folders map[string]*stallState
}

func newStallWatch() (out0 *stallWatch) {
	defer logger.Out1(logger.In0("fileservers/servers/syncthingserv", "newStallWatch"), &out0)
	return &stallWatch{folders: map[string]*stallState{}}
}

// observe takes the status of a folder and reports whether it has been
// syncing with nothing arriving long enough to be restarted.
func (w *stallWatch) observe(id string, st FolderStatus, now time.Time) (out0 bool) {
	defer logger.Out1(logger.In4("fileservers/servers/syncthingserv", "stallWatch.observe", "w", w, "id", id, "&st", &st, "&now", &now), &out0)
	mark := markOf(st)
	syncing := st.State == stateSyncing
	s, ok := w.folders[id]
	if !ok {
		w.folders[id] = &stallState{mark: mark, syncing: syncing, since: now, timeout: stallTimeout}
		return false
	}
	if !syncing || !s.syncing {
		//Only time spent syncing counts. The wait stays doubled unless the
		//pull that just ended finished files: a restarted folder scans
		//first, and should not reset it by doing so.
		if s.syncing && mark.finished(s.mark) {
			s.timeout = stallTimeout
		}
		s.mark, s.syncing, s.since = mark, syncing, now
		return false
	}
	if mark != s.mark {
		if mark.finished(s.mark) {
			s.timeout = stallTimeout
		}
		s.mark, s.since = mark, now
		return false
	}
	return now.Sub(s.since) >= s.timeout
}

// restarted starts the wait of a folder again, twice as long as before.
func (w *stallWatch) restarted(id string, now time.Time) {
	defer logger.Out0(logger.In3("fileservers/servers/syncthingserv", "stallWatch.restarted", "w", w, "id", id, "&now", &now))
	s, ok := w.folders[id]
	if !ok {
		return
	}
	s.since = now
	s.timeout = min(s.timeout*2, stallTimeoutMax)
}

// keep forgets the folders that are not in ids.
func (w *stallWatch) keep(ids map[string]bool) {
	defer logger.Out0(logger.In2("fileservers/servers/syncthingserv", "stallWatch.keep", "w", w, "ids", ids))
	for id := range w.folders {
		if !ids[id] {
			delete(w.folders, id)
		}
	}
}

// checkStallsLocked restarts the folders that stopped receiving while
// syncing. The caller holds m.mu.
func (m *Manager) checkStallsLocked(now time.Time) {
	defer logger.Out0(logger.In2("fileservers/servers/syncthingserv", "Manager.checkStallsLocked", "m", m, "&now", &now))
	active := map[string]bool{}
	for _, f := range m.result.Plan.Folders {
		if f.Paused {
			continue
		}
		active[f.ID] = true
		if !m.stalls.observe(f.ID, m.eng.FolderStatus(f.ID), now) {
			continue
		}
		waited := m.stalls.folders[f.ID].timeout
		m.stalls.restarted(f.ID, now)
		if err := m.eng.RestartFolder(f.ID); err != nil {
			logger.DebugErr("fileservers/servers/syncthingserv", err)
			logger.PrintAndLog(logTitle, "Folder "+f.ID+" ("+f.Label+") stalled, but could not be restarted", err)
			continue
		}
		logger.PrintAndLog(logTitle, "Folder "+f.ID+" ("+f.Label+") received nothing for "+waited.String()+" while syncing, restarted it", nil)
	}
	m.stalls.keep(active)
}
