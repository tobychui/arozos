//go:build !(linux && mipsle) && !(windows && arm) && !(windows && 386)

package syncthingserv

/*
	The embedded Syncthing

	Syncthing runs inside the ArozOS process through its lib/syncthing
	package, the way the iOS app embeds it. Its GUI and REST API stay off:
	ArozOS is the only thing that configures it, through applyConfig below.

	Built where modernc.org/sqlite (the Syncthing index without cgo) builds,
	the same platforms as the AGI sqlite library.
*/

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/syncthing/syncthing/lib/build"
	"github.com/syncthing/syncthing/lib/config"
	"github.com/syncthing/syncthing/lib/events"
	"github.com/syncthing/syncthing/lib/locations"
	"github.com/syncthing/syncthing/lib/protocol"
	"github.com/syncthing/syncthing/lib/svcutil"
	"github.com/syncthing/syncthing/lib/syncthing"
	"github.com/vitrun/qart/qr"
	"imuslab.com/arozos/mod/info/logger"
)

// syncthingVersion is the release go.mod pins (tag v2.1.7, a pseudo version
// there because Syncthing's module path has no /v2). Peers see it.
const syncthingVersion = "v2.1.7"

const (
	//deleteRetention keeps deleted file records as long as Syncthing does
	deleteRetention = 10920 * time.Hour
	dbMaintenance   = 8 * time.Hour
	relayPool       = "dynamic+https://relays.syncthing.net/endpoint"
	stopTimeout     = 30 * time.Second
)

func init() {
	logger.Debug("fileservers/servers/syncthingserv", "init")
	build.Version = syncthingVersion
	build.IsRelease, build.IsBeta, build.IsCandidate = true, false, false
	build.LongVersion = build.LongVersionFor("syncthing")
	installLogBridge()
	registerNoSymlinkFS()
	newEngine = func() engine { return &stEngine{unknown: map[string]UnknownDevice{}} }
	qrCode = func(text string) ([]byte, error) {
		code, err := qr.Encode(text, qr.M)
		if err != nil {
			return nil, err
		}
		return code.PNG(), nil
	}
}

type stEngine struct {
	mu      sync.Mutex
	app     *syncthing.App
	cfg     config.Wrapper
	cancel  context.CancelFunc
	myID    protocol.DeviceID
	unknown map[string]UnknownDevice
}

func (e *stEngine) ParseDeviceID(s string) (string, error) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "stEngine.ParseDeviceID: s=%.120q", s)
	}
	id, err := protocol.DeviceIDFromString(s)
	if err != nil {
		return "", err
	}
	if id == protocol.EmptyDeviceID || id == protocol.LocalDeviceID {
		return "", errors.New("not a device ID")
	}
	return id.String(), nil
}

func (e *stEngine) Start(cfg engineConfig, p plan) error {
	logger.Debug("fileservers/servers/syncthingserv", "stEngine.Start")
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.app != nil {
		return nil
	}
	dir, err := filepath.Abs(cfg.Dir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	//Every Syncthing file lives in the state folder, the home folder of the
	//account running ArozOS is never touched
	for _, base := range []locations.BaseDirEnum{locations.ConfigBaseDir, locations.DataBaseDir, locations.UserHomeBaseDir} {
		if err := locations.SetBaseDir(base, dir); err != nil {
			return err
		}
	}
	cert, err := syncthing.LoadOrGenerateCertificate(locations.Get(locations.CertFile), locations.Get(locations.KeyFile))
	if err != nil {
		return err
	}

	ctx, stop := context.WithCancel(context.Background())
	served := &sync.WaitGroup{}
	//cancel waits for both to finish: the wrapper saves the configuration
	//as it stops
	cancel := func() {
		stop()
		served.Wait()
	}
	evLogger := events.NewLogger()
	served.Go(func() { evLogger.Serve(ctx) })
	wrapper, err := syncthing.LoadConfigAtStartup(locations.Get(locations.ConfigFile), cert, evLogger, false, true)
	if err != nil {
		cancel()
		return err
	}
	//Modify only works while the wrapper serves
	served.Go(func() { wrapper.Serve(ctx) })

	myID := protocol.NewDeviceID(cert.Certificate[0])
	if err := applyConfig(wrapper, myID, cfg, p); err != nil {
		cancel()
		return err
	}
	if err := wrapper.Save(); err != nil {
		cancel()
		return err
	}

	sdb, err := syncthing.OpenDatabase(locations.Get(locations.Database), deleteRetention)
	if err != nil {
		cancel()
		return err
	}
	app, err := syncthing.New(wrapper, sdb, evLogger, cert, syncthing.Options{
		NoUpgrade:             true,
		DBMaintenanceInterval: dbMaintenance,
	})
	if err != nil {
		sdb.Close()
		cancel()
		return err
	}
	sub := evLogger.Subscribe(events.PendingDevicesChanged)
	go e.watchUnknown(ctx, sub)
	if err := app.Start(); err != nil {
		//A failed start closes the database itself
		cancel()
		return err
	}
	e.app, e.cfg, e.cancel, e.myID = app, wrapper, cancel, myID
	return nil
}

func (e *stEngine) Stop() {
	logger.Debug("fileservers/servers/syncthingserv", "stEngine.Stop")
	e.mu.Lock()
	app, cancel := e.app, e.cancel
	e.app, e.cfg, e.cancel = nil, nil, nil
	e.unknown = map[string]UnknownDevice{}
	e.mu.Unlock()
	if app == nil {
		return
	}
	done := make(chan struct{})
	go func() {
		app.Stop(svcutil.ExitSuccess)
		//The configuration is saved as the wrapper stops serving
		cancel()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(stopTimeout):
		logger.PrintAndLog(logTitle, "Syncthing did not stop within "+stopTimeout.String(), nil)
	}
}

func (e *stEngine) Apply(cfg engineConfig, p plan) error {
	logger.Debug("fileservers/servers/syncthingserv", "stEngine.Apply")
	e.mu.Lock()
	wrapper, myID := e.cfg, e.myID
	e.mu.Unlock()
	if wrapper == nil {
		return nil
	}
	return applyConfig(wrapper, myID, cfg, p)
}

func (e *stEngine) DeviceID() string {
	logger.Debug("fileservers/servers/syncthingserv", "stEngine.DeviceID")
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.app == nil {
		return ""
	}
	return e.myID.String()
}

// internals returns Syncthing's model while it runs.
func (e *stEngine) internals() *syncthing.Internals {
	logger.Debug("fileservers/servers/syncthingserv", "stEngine.internals")
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.app == nil {
		return nil
	}
	return e.app.Internals
}

func (e *stEngine) FolderStatus(id string) FolderStatus {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "stEngine.FolderStatus: id=%.120q", id)
	}
	in := e.internals()
	if in == nil {
		return FolderStatus{}
	}
	status := FolderStatus{}
	state, changed, err := in.FolderState(id)
	status.State, status.Changed = state, changed
	if err != nil {
		status.Error = err.Error()
	}
	if state == "" {
		//A paused folder has no runner to ask
		e.mu.Lock()
		wrapper := e.cfg
		e.mu.Unlock()
		if wrapper != nil {
			if f, ok := wrapper.Folder(id); ok && f.Paused {
				status.State = "paused"
			}
		}
	}
	if local, err := in.LocalSize(id); err == nil {
		status.LocalFiles, status.LocalBytes = local.Files, local.Bytes
	}
	if global, err := in.GlobalSize(id); err == nil {
		status.GlobalFiles, status.GlobalBytes = global.Files, global.Bytes
	}
	if need, err := in.NeedSize(id, protocol.LocalDeviceID); err == nil {
		status.NeedFiles, status.NeedBytes = need.Files+need.Deleted, need.Bytes
	}
	status.PulledBytes = in.FolderProgressBytesCompleted(id)
	return status
}

func (e *stEngine) DeviceStatus(id string) DeviceStatus {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "stEngine.DeviceStatus: id=%.120q", id)
	}
	in := e.internals()
	if in == nil {
		return DeviceStatus{}
	}
	device, err := protocol.DeviceIDFromString(id)
	if err != nil {
		return DeviceStatus{}
	}
	status := DeviceStatus{Connected: in.IsConnectedTo(device)}
	if stats, err := in.DeviceStatistics(); err == nil {
		if s, ok := stats[device]; ok {
			status.LastSeen = s.LastSeen
		}
	}
	if status.Connected {
		status.LastSeen = time.Now()
	}
	return status
}

func (e *stEngine) Offers(deviceID string) []Offer {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "stEngine.Offers: deviceID=%.120q", deviceID)
	}
	in := e.internals()
	if in == nil {
		return nil
	}
	device, err := protocol.DeviceIDFromString(deviceID)
	if err != nil {
		return nil
	}
	pending, err := in.PendingFolders(device)
	if err != nil {
		return nil
	}
	offers := []Offer{}
	for folderID, folder := range pending {
		observed, ok := folder.OfferedBy[device]
		if !ok {
			continue
		}
		offers = append(offers, Offer{FolderID: folderID, Label: observed.Label, Time: observed.Time})
	}
	return offers
}

func (e *stEngine) Rescan(folderID string) error {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "stEngine.Rescan: folderID=%.120q", folderID)
	}
	in := e.internals()
	if in == nil {
		return errors.New("Syncthing is not running")
	}
	return in.ScanFolderSubdirs(folderID, nil)
}

// RestartFolder pauses a folder and resumes it. Syncthing only gives up a
// block request when the folder stops, and has no restart of its own short
// of a configuration change. Should the resume fail, the next applyConfig
// unpauses the folder again.
func (e *stEngine) RestartFolder(folderID string) error {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "stEngine.RestartFolder: folderID=%.120q", folderID)
	}
	e.mu.Lock()
	wrapper := e.cfg
	e.mu.Unlock()
	if wrapper == nil {
		return errors.New("Syncthing is not running")
	}
	f, ok := wrapper.Folder(folderID)
	if !ok {
		return errors.New("no such folder")
	}
	if f.Paused {
		return nil
	}
	for _, paused := range []bool{true, false} {
		waiter, err := wrapper.Modify(func(c *config.Configuration) {
			for i := range c.Folders {
				if c.Folders[i].ID == folderID {
					c.Folders[i].Paused = paused
				}
			}
		})
		if err != nil {
			return err
		}
		//Returns once the folder stopped, or started again
		waiter.Wait()
	}
	return nil
}

func (e *stEngine) LocalBytes(folderID string) (int64, bool) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "stEngine.LocalBytes: folderID=%.120q", folderID)
	}
	in := e.internals()
	if in == nil {
		return 0, false
	}
	counts, err := in.LocalSize(folderID)
	if err != nil {
		return 0, false
	}
	return counts.Bytes, true
}

func (e *stEngine) UnknownDevices() []UnknownDevice {
	logger.Debug("fileservers/servers/syncthingserv", "stEngine.UnknownDevices")
	e.mu.Lock()
	defer e.mu.Unlock()
	list := make([]UnknownDevice, 0, len(e.unknown))
	for _, d := range e.unknown {
		list = append(list, d)
	}
	slices.SortFunc(list, func(a, b UnknownDevice) int { return b.Time.Compare(a.Time) })
	return list
}

// watchUnknown keeps the devices that tried to connect without being added,
// for the admin page.
func (e *stEngine) watchUnknown(ctx context.Context, sub events.Subscription) {
	logger.Debug("fileservers/servers/syncthingserv", "stEngine.watchUnknown")
	defer sub.Unsubscribe()
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-sub.C():
			if !ok {
				return
			}
			var change struct {
				Added []struct {
					DeviceID string `json:"deviceID"`
					Name     string `json:"name"`
					Address  string `json:"address"`
				} `json:"added"`
				Removed []struct {
					DeviceID string `json:"deviceID"`
				} `json:"removed"`
			}
			raw, err := json.Marshal(ev.Data)
			if err != nil || json.Unmarshal(raw, &change) != nil {
				continue
			}
			e.mu.Lock()
			for _, d := range change.Added {
				e.unknown[d.DeviceID] = UnknownDevice{ID: d.DeviceID, Name: d.Name, Address: d.Address, Time: ev.Time}
			}
			for _, d := range change.Removed {
				delete(e.unknown, d.DeviceID)
			}
			e.mu.Unlock()
		}
	}
}

// listenAddresses are where Syncthing accepts connections.
func listenAddresses(s Settings) []string {
	logger.Debug("fileservers/servers/syncthingserv", "listenAddresses")
	port := strconv.Itoa(s.Port)
	addrs := []string{"tcp://:" + port, "quic://:" + port}
	if s.Relays {
		addrs = append(addrs, relayPool)
	}
	return addrs
}

// applyConfig makes the Syncthing configuration what the plan asks for.
// Fields are only written when they differ, in the order Syncthing keeps
// them, so applying the same plan again changes nothing and no folder
// restarts.
func applyConfig(wrapper config.Wrapper, myID protocol.DeviceID, ec engineConfig, p plan) error {
	logger.Debug("fileservers/servers/syncthingserv", "applyConfig")
	waiter, err := wrapper.Modify(func(c *config.Configuration) {
		s := ec.Settings

		//Nothing but ArozOS configures this device, and nothing leaves it
		//that the admin did not ask for
		c.GUI.Enabled = false
		o := &c.Options
		o.URAccepted = -1
		o.CREnabled = false
		o.AutoUpgradeIntervalH = 0
		o.StartBrowser = false
		o.SetLowPriority = false //It would lower all of ArozOS
		o.AuditEnabled = false
		o.GlobalAnnEnabled = s.GlobalDiscovery
		o.LocalAnnEnabled = s.LocalDiscovery
		o.RelaysEnabled = s.Relays
		o.NATEnabled = s.NAT
		if addrs := listenAddresses(s); !slices.Equal(o.RawListenAddresses, addrs) {
			o.RawListenAddresses = addrs
		}

		//Devices: this server, and the ones the users added
		current := map[protocol.DeviceID]config.DeviceConfiguration{}
		for _, d := range c.Devices {
			current[d.DeviceID] = d
		}
		self, ok := current[myID]
		if !ok {
			self = c.Defaults.Device.Copy()
			self.DeviceID = myID
		}
		if ec.Name != "" {
			self.Name = ec.Name
		}
		devices := []config.DeviceConfiguration{self}
		known := map[protocol.DeviceID]bool{myID: true}
		for _, pd := range p.Devices {
			id, err := protocol.DeviceIDFromString(pd.ID)
			if err != nil || known[id] {
				continue
			}
			known[id] = true
			d, ok := current[id]
			if !ok {
				d = c.Defaults.Device.Copy()
				d.DeviceID = id
				d.Addresses = []string{"dynamic"}
			}
			d.Name = pd.Name
			d.Paused = pd.Paused
			//A device may never bring other devices or folders in
			d.Introducer = false
			d.AutoAcceptFolders = false
			d.IntroducedBy = protocol.EmptyDeviceID
			d.Untrusted = false
			d.IgnoredFolders = ignoredFolders(d.IgnoredFolders, pd.Ignored)
			devices = append(devices, d)
		}
		slices.SortFunc(devices, func(a, b config.DeviceConfiguration) int { return a.DeviceID.Compare(b.DeviceID) })
		c.Devices = devices

		//Folders
		currentFolders := map[string]config.FolderConfiguration{}
		for _, f := range c.Folders {
			currentFolders[f.ID] = f
		}
		folders := []config.FolderConfiguration{}
		seen := map[string]bool{}
		for _, pf := range p.Folders {
			if pf.ID == "" || pf.Path == "" || seen[pf.ID] {
				continue
			}
			seen[pf.ID] = true
			f, ok := currentFolders[pf.ID]
			if !ok {
				f = c.Defaults.Folder.Copy()
				f.ID = pf.ID
			}
			f.Label = pf.Label
			f.Path = pf.Path
			f.FilesystemType = config.FilesystemType(fsTypeArozOS)
			f.Paused = pf.Paused
			f.IgnorePerms = true
			switch pf.Mode {
			case ModeTwoWay:
				f.Type, f.IgnoreDelete = config.FolderTypeSendReceive, false
			case ModeMirror:
				f.Type, f.IgnoreDelete = config.FolderTypeReceiveOnly, false
			default:
				f.Type, f.IgnoreDelete = config.FolderTypeReceiveOnly, true
			}
			setVersioning(&f.Versioning, pf.VersionDays)
			f.Devices = folderDevices(f.Devices, myID, pf.Devices, known)
			folders = append(folders, f)
		}
		slices.SortFunc(folders, func(a, b config.FolderConfiguration) int {
			switch {
			case a.ID < b.ID:
				return -1
			case a.ID > b.ID:
				return 1
			}
			return 0
		})
		c.Folders = folders
	})
	if err != nil {
		return err
	}
	waiter.Wait()
	return nil
}

// ignoredFolders keeps the entries Syncthing already has for the folder IDs
// that stay ignored, so their times and order do not change.
func ignoredFolders(current []config.ObservedFolder, ids []string) []config.ObservedFolder {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "ignoredFolders: len(current)=%d len(ids)=%d", len(current), len(ids))
	}
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	changed := false
	out := []config.ObservedFolder{}
	for _, o := range current {
		if want[o.ID] {
			out = append(out, o)
			delete(want, o.ID)
		} else {
			changed = true
		}
	}
	for _, id := range ids {
		if want[id] {
			out = append(out, config.ObservedFolder{Time: time.Now().Truncate(time.Second), ID: id})
			delete(want, id)
			changed = true
		}
	}
	if !changed {
		//Same set: keep Syncthing's own slice
		return current
	}
	return out
}

// folderDevices is the server plus the given devices, unchanged when the
// set is the same.
func folderDevices(current []config.FolderDeviceConfiguration, myID protocol.DeviceID, ids []string, known map[protocol.DeviceID]bool) []config.FolderDeviceConfiguration {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "folderDevices: len(current)=%d len(ids)=%d len(known)=%d", len(current), len(ids), len(known))
	}
	want := map[protocol.DeviceID]bool{myID: true}
	for _, raw := range ids {
		if id, err := protocol.DeviceIDFromString(raw); err == nil && known[id] {
			want[id] = true
		}
	}
	have := map[protocol.DeviceID]bool{}
	for _, d := range current {
		have[d.DeviceID] = true
	}
	same := len(have) == len(want) && len(current) == len(want)
	for id := range want {
		if !have[id] {
			same = false
		}
	}
	if same {
		return current
	}
	out := make([]config.FolderDeviceConfiguration, 0, len(want))
	for id := range want {
		out = append(out, config.FolderDeviceConfiguration{DeviceID: id})
	}
	slices.SortFunc(out, func(a, b config.FolderDeviceConfiguration) int { return a.DeviceID.Compare(b.DeviceID) })
	return out
}

// setVersioning keeps replaced and deleted files for a number of days in
// the folder's .stversions, or turns that off.
func setVersioning(v *config.VersioningConfiguration, days int) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "setVersioning: days=%d", days)
	}
	if days <= 0 {
		if v.Type != "" {
			v.Type = ""
			v.Params = map[string]string{}
		}
		return
	}
	want := strconv.Itoa(days)
	if v.Type == "trashcan" && v.Params["cleanoutDays"] == want {
		return
	}
	v.Type = "trashcan"
	v.Params = map[string]string{"cleanoutDays": want}
	if v.CleanupIntervalS <= 0 {
		v.CleanupIntervalS = 3600
	}
}
