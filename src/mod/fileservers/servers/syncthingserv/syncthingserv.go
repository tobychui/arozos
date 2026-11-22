// Package syncthingserv runs an embedded Syncthing device on the server, so
// that phones and computers running Syncthing (Sushitrain on iOS, the
// Android and desktop apps) can sync folders into ArozOS drives.
//
// The server has one Syncthing device ID. Each user links their own devices
// to it and picks, for every folder those devices share, a folder of their
// own drives to keep it in. ArozOS records who owns each device and folder,
// and rebuilds the Syncthing configuration from those records (plan.go), so
// a device only ever sees the folders of the user who linked it.
package syncthingserv

import (
	"errors"
	"net/http"
	"sync"
	"time"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/info/logger"
	user "imuslab.com/arozos/mod/user"
)

const (
	logTitle = "Syncthing"

	//Limits per user, well above any phone and laptop collection
	maxDevicesPerUser = 32
	maxFoldersPerUser = 64

	reconcileInterval = time.Minute
)

// ErrUnavailable is returned where this build carries no Syncthing.
var ErrUnavailable = errors.New("Syncthing is not available on this platform")

// ManagerOption wires the manager to the rest of the system.
type ManagerOption struct {
	Sysdb      *database.Database
	StateDir   string //Keys, configuration and index of the server device
	DeviceName string //Device name the phones see

	//CurrentUser returns who made a web request
	CurrentUser func(w http.ResponseWriter, r *http.Request) (string, error)
	//ConfirmPassword checks the login password in the request, and writes
	//the refusal itself when it is wrong
	ConfirmPassword func(w http.ResponseWriter, r *http.Request) bool

	UserExists func(username string) bool
	IsAdmin    func(username string) bool
	InGroups   func(username string, groups []string) bool
	ListGroups func() []string

	//ResolveFolder finds where a virtual path is on the host. It refuses a
	//path the user cannot write to, one on a drive that is not a local disk,
	//and one a symbolic link carries off its drive. With create, a missing
	//folder is made first.
	ResolveFolder func(username, vpath string, create bool) (Location, error)

	engine engine //Tests put a fake here
}

// Manager runs the Syncthing device.
type Manager struct {
	opt   *ManagerOption
	store *store
	eng   engine

	mu        sync.Mutex
	running   bool
	gen       int //Counts starts, so a loop of an older run stops working
	quit      chan struct{}
	lastError string
	result    planResult
	lastPath  map[string]string
	quotas    map[string]quotaWatch
	stalls    *stallWatch
}

// NewManager prepares the manager and starts Syncthing if it was left on.
func NewManager(opt *ManagerOption) (*Manager, error) {
	eng := opt.engine
	if eng == nil {
		if newEngine == nil {
			return nil, ErrUnavailable
		}
		eng = newEngine()
	}
	st, err := newStore(opt.Sysdb)
	if err != nil {
		return nil, err
	}
	m := &Manager{
		opt:      opt,
		store:    st,
		eng:      eng,
		lastPath: map[string]string{},
		quotas:   map[string]quotaWatch{},
		stalls:   newStallWatch(),
		result: planResult{
			DeviceReasons: map[string]Reason{},
			FolderReasons: map[string]Reason{},
			Locations:     map[string]Location{},
		},
	}
	if st.enabled() {
		if err := m.ServerToggle(true); err != nil {
			//The choice is kept: the port may be free again at the next boot
			logger.PrintAndLog(logTitle, "Syncthing could not start", err)
			st.setEnabled(true)
		}
	}
	return m, nil
}

func (m *Manager) engineConfig() engineConfig {
	return engineConfig{
		Dir:      m.opt.StateDir,
		Name:     m.opt.DeviceName,
		Settings: m.store.settings(),
	}
}

// allowed reports whether a user may use Syncthing: admins always, others
// when they are in one of the groups the admin picked.
func (m *Manager) allowed(username string, settings Settings) bool {
	if username == "" || !m.opt.UserExists(username) {
		return false
	}
	if m.opt.IsAdmin(username) {
		return true
	}
	return len(settings.Groups) > 0 && m.opt.InGroups(username, settings.Groups)
}

// Allowed reports whether a user may use Syncthing.
func (m *Manager) Allowed(username string) bool {
	return m.allowed(username, m.store.settings())
}

// ServerToggle implements fileservers.Server.
func (m *Manager) ServerToggle(enabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if enabled == m.running {
		return nil
	}
	if !enabled {
		m.stopLocked()
		m.lastError = ""
		return m.store.setEnabled(false)
	}
	if err := m.startLocked(); err != nil {
		m.lastError = err.Error()
		m.store.setEnabled(false)
		return err
	}
	m.lastError = ""
	return m.store.setEnabled(true)
}

// IsEnabled implements fileservers.Server.
func (m *Manager) IsEnabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}

// GetEndpoints implements fileservers.Server. Syncthing finds the server by
// its device ID, the address is for devices that cannot use discovery.
func (m *Manager) GetEndpoints(userinfo *user.User) []*fileservers.Endpoint {
	if userinfo == nil || !m.IsEnabled() || !m.Allowed(userinfo.Username) {
		return []*fileservers.Endpoint{}
	}
	return []*fileservers.Endpoint{{ProtocolName: "tcp://", Port: m.store.settings().Port}}
}

// Close stops Syncthing without changing the setting.
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopLocked()
}

// startLocked starts Syncthing with the current plan. The caller holds m.mu.
func (m *Manager) startLocked() error {
	cfg := m.engineConfig()
	result := m.planLocked(cfg.Settings)
	if err := m.eng.Start(cfg, result.Plan); err != nil {
		return err
	}
	m.running = true
	m.result = result
	m.stalls = newStallWatch()
	m.gen++
	m.quit = make(chan struct{})
	go m.loop(m.gen, m.quit)
	logger.PrintAndLog(logTitle, "Syncthing is running as device "+m.eng.DeviceID(), nil)
	return nil
}

// stopLocked stops Syncthing. The caller holds m.mu.
func (m *Manager) stopLocked() {
	if !m.running {
		return
	}
	close(m.quit)
	m.running = false
	m.eng.Stop()
	logger.PrintAndLog(logTitle, "Syncthing stopped", nil)
}

// loop applies the records again once a minute, which notices users who
// lost their access, full quotas, and drives that went away, and restarts
// folders that stopped receiving while syncing (watchdog.go).
func (m *Manager) loop(gen int, quit chan struct{}) {
	ticker := time.NewTicker(reconcileInterval)
	defer ticker.Stop()
	stalls := time.NewTicker(stallCheckInterval)
	defer stalls.Stop()
	for {
		select {
		case <-quit:
			return
		case <-ticker.C:
			m.mu.Lock()
			if m.running && m.gen == gen {
				m.applyLocked()
			}
			m.mu.Unlock()
		case <-stalls.C:
			m.mu.Lock()
			if m.running && m.gen == gen {
				m.checkStallsLocked(time.Now())
			}
			m.mu.Unlock()
		}
	}
}

// changed applies the records after a page changed them.
func (m *Manager) changed() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.running {
		return nil
	}
	return m.applyLocked()
}

// applyLocked hands the current plan to Syncthing. The caller holds m.mu.
func (m *Manager) applyLocked() error {
	cfg := m.engineConfig()
	result := m.planLocked(cfg.Settings)
	m.result = result
	if err := m.eng.Apply(cfg, result.Plan); err != nil {
		logger.PrintAndLog(logTitle, "The Syncthing configuration could not be applied", err)
		m.lastError = err.Error()
		return err
	}
	return nil
}

// planLocked builds the plan from the records. The caller holds m.mu.
func (m *Manager) planLocked(settings Settings) planResult {
	devices := m.store.devices()
	folders := m.store.folders()
	foldersOf := map[string][]string{}
	for _, f := range folders {
		foldersOf[f.Owner] = append(foldersOf[f.Owner], f.ID)
	}
	quotaFull := map[string]bool{}

	result := buildPlan(planInput{
		Devices: devices,
		Folders: folders,
		Exists:  m.opt.UserExists,
		Allowed: func(owner string) bool { return m.allowed(owner, settings) },
		Resolve: func(owner, vpath string) (Location, error) {
			return m.opt.ResolveFolder(owner, vpath, false)
		},
		QuotaFull: func(f Folder, loc Location) bool {
			full, ok := quotaFull[f.Owner]
			if !ok {
				full = m.quotaFullLocked(f.Owner, loc.Quota, foldersOf[f.Owner])
				quotaFull[f.Owner] = full
			}
			return full
		},
		LastPath: func(id string) string { return m.lastPath[id] },
	})
	for id, loc := range result.Locations {
		m.lastPath[id] = loc.RealPath
	}
	for _, owner := range result.Gone {
		m.forgetOwnerLocked(owner)
	}
	return result
}

// forgetOwnerLocked removes the records of an account that was deleted, so a
// new account of the same name does not inherit its devices. The files stay.
func (m *Manager) forgetOwnerLocked(owner string) {
	removed := 0
	for _, d := range m.store.devices() {
		if d.Owner == owner {
			m.store.deleteDevice(d.ID)
			removed++
		}
	}
	for _, f := range m.store.folders() {
		if f.Owner == owner {
			m.store.deleteFolder(f.ID)
			delete(m.lastPath, f.ID)
			removed++
		}
	}
	delete(m.quotas, owner)
	if removed > 0 {
		logger.PrintAndLog(logTitle, "Removed the Syncthing devices and folders of the deleted account "+owner, nil)
	}
}

// quotaWatch remembers when a user's usage was last measured.
type quotaWatch struct {
	baseline  int64 //Bytes of the user's synced folders at that time
	recounted time.Time
}

const (
	quotaRecountEvery = 10 * time.Minute //Even when nothing looks full
	quotaRecountFull  = 2 * time.Minute  //At most this often while full
)

// quotaFullLocked reports a user's quota as full. Files Syncthing writes are
// not added to the usage as they arrive (that would count twice the files
// the File Manager also counts), so the growth of the synced folders since
// the last measurement is added on top, and the usage is measured again from
// the disk when that looks full. The caller holds m.mu.
func (m *Manager) quotaFullLocked(owner string, q Quota, folderIDs []string) bool {
	used, total := q.Usage()
	if total < 0 {
		return false
	}
	var synced int64
	for _, id := range folderIDs {
		bytes, ok := m.eng.LocalBytes(id)
		if !ok {
			//Syncthing is not running yet, so the growth is unknown
			return used >= total
		}
		synced += bytes
	}
	now := time.Now()
	w, seen := m.quotas[owner]
	if !seen {
		//The usage was measured when the quota was loaded
		w = quotaWatch{baseline: synced, recounted: now}
	}
	grown := synced - w.baseline
	if grown < 0 {
		grown = 0
	}
	since := now.Sub(w.recounted)
	if since >= quotaRecountEvery || (used+grown >= total && since >= quotaRecountFull) {
		q.Recount()
		used, total = q.Usage()
		w = quotaWatch{baseline: synced, recounted: now}
		grown = 0
	}
	m.quotas[owner] = w
	return total >= 0 && used+grown >= total
}
