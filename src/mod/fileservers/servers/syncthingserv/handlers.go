package syncthingserv

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

/*
	Endpoints

	/system/storage/syncthing/...	every user (Syncthing checks who may use it)
		status, qr, device/{add,edit,remove}, folder/{add,edit,remove,rescan},
		offer/ignore
	/system/storage/syncthing/...	admins
		config, overview, admin/remove
*/

const (
	maxNameLength  = 64
	maxLabelLength = 128
	maxIDLength    = 255
)

func sendJSON(w http.ResponseWriter, value any) {
	logger.Debug("fileservers/servers/syncthingserv", "sendJSON")
	js, err := json.Marshal(value)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendJSONResponse(w, string(js))
}

// postOnly reads a form value from the body of a POST alone.
func postOnly(r *http.Request, key string) string {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "postOnly: r=%s", logger.RequestSummary(r))
	}
	if r.Method != http.MethodPost {
		return ""
	}
	r.ParseForm()
	return r.PostForm.Get(key)
}

// postList reads a JSON array of strings from the body of a POST.
func postList(r *http.Request, key string) ([]string, error) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "postList: r=%s", logger.RequestSummary(r))
	}
	raw := strings.TrimSpace(postOnly(r, key))
	if raw == "" {
		return []string{}, nil
	}
	list := []string{}
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		return nil, errors.New("The list of " + key + " could not be read")
	}
	return list, nil
}

// cleanName trims a name a user typed and refuses control characters.
func cleanName(name string, max int) (string, error) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "cleanName: name=%.120q max=%d", name, max)
	}
	name = strings.TrimSpace(name)
	if !utf8.ValidString(name) {
		return "", errors.New("The name is not valid text")
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return "", errors.New("The name may not contain control characters")
		}
	}
	if utf8.RuneCountInString(name) > max {
		return "", errors.New("The name is too long")
	}
	return name, nil
}

// validFolderID accepts an ID that a device offered or the server made.
func validFolderID(id string) bool {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "validFolderID: id=%.120q", id)
	}
	if id == "" || len(id) > maxIDLength || !utf8.ValidString(id) {
		return false
	}
	for _, r := range id {
		if unicode.IsControl(r) || r == '/' || r == '\\' {
			return false
		}
	}
	return true
}

// newFolderID makes an ID in Syncthing's own style, like "k3x9q-p0w2e".
func newFolderID() string {
	logger.Debug("fileservers/servers/syncthingserv", "newFolderID")
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 11)
	for i := range b {
		if i == 5 {
			b[i] = '-'
			continue
		}
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(letters))))
		if err != nil {
			n = big.NewInt(int64(time.Now().UnixNano() % int64(len(letters))))
		}
		b[i] = letters[n.Int64()]
	}
	return string(b)
}

// currentAllowedUser returns the user of a request who may use Syncthing,
// and writes the refusal itself otherwise.
func (m *Manager) currentAllowedUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.currentAllowedUser: r=%s", logger.RequestSummary(r))
	}
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return "", false
	}
	if !m.Allowed(username) {
		utils.SendErrorResponse(w, "Your account may not use Syncthing. Ask an admin to turn it on for your group")
		return "", false
	}
	return username, true
}

func requirePost(w http.ResponseWriter, r *http.Request) bool {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "requirePost: r=%s", logger.RequestSummary(r))
	}
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return false
	}
	return true
}

/* Status */

// DeviceView is one of a user's devices.
type DeviceView struct {
	ID        string
	Name      string
	Owner     string `json:",omitempty"`
	Paused    bool
	Connected bool
	LastSeen  int64 //Unix time, 0 when never
	Reason    string
	Added     int64
}

// FolderView is one of a user's folders.
type FolderView struct {
	ID          string
	Label       string
	Path        string
	Owner       string `json:",omitempty"`
	Mode        string
	VersionDays int
	Devices     []string
	Paused      bool
	Reason      string
	ReasonText  string
	State       string
	Error       string
	LocalFiles  int
	LocalBytes  int64
	GlobalFiles int
	GlobalBytes int64
	NeedFiles   int
	NeedBytes   int64
	Added       int64
}

// OfferView is a folder one of the user's devices wants to share.
type OfferView struct {
	DeviceID   string
	DeviceName string
	FolderID   string
	Label      string
	Time       int64
	//Existing is "mine" when the user already syncs this folder with another
	//device, and "taken" when another account holds the same folder ID
	Existing string
}

// UserStatus is what a user sees of the service.
type UserStatus struct {
	Running    bool
	Allowed    bool
	Port       int
	DeviceID   string
	DeviceName string
	Devices    []DeviceView
	Folders    []FolderView
	Offers     []OfferView
}

func (m *Manager) deviceView(d Device, running bool, reasons map[string]Reason) DeviceView {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.deviceView: running=%t len(reasons)=%d", running, len(reasons))
	}
	view := DeviceView{ID: d.ID, Name: d.Name, Paused: d.Paused, Added: d.Added}
	if reason, ok := reasons[d.ID]; ok {
		view.Reason = reason.Key
		view.Paused = true
	}
	if running {
		status := m.eng.DeviceStatus(d.ID)
		view.Connected = status.Connected
		if !status.LastSeen.IsZero() && status.LastSeen.Year() > 1970 {
			view.LastSeen = status.LastSeen.Unix()
		}
	}
	return view
}

func (m *Manager) folderView(f Folder, running bool, reasons map[string]Reason) FolderView {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.folderView: running=%t len(reasons)=%d", running, len(reasons))
	}
	view := FolderView{
		ID:          f.ID,
		Label:       f.Label,
		Path:        f.Path,
		Mode:        f.Mode,
		VersionDays: f.VersionDays,
		Devices:     append([]string{}, f.Devices...),
		Paused:      f.Paused,
		Added:       f.Added,
	}
	if reason, ok := reasons[f.ID]; ok {
		view.Reason = reason.Key
		view.ReasonText = reason.Text
		view.Paused = true
	}
	if running {
		status := m.eng.FolderStatus(f.ID)
		view.State = status.State
		view.Error = status.Error
		view.LocalFiles = status.LocalFiles
		view.LocalBytes = status.LocalBytes
		view.GlobalFiles = status.GlobalFiles
		view.GlobalBytes = status.GlobalBytes
		view.NeedFiles = status.NeedFiles
		view.NeedBytes = status.NeedBytes
	}
	if view.Paused {
		view.State = "paused"
	}
	return view
}

// snapshot copies what the handlers read of the last plan.
func (m *Manager) snapshot() (running bool, deviceReasons, folderReasons map[string]Reason) {
	logger.Debug("fileservers/servers/syncthingserv", "Manager.snapshot")
	m.mu.Lock()
	defer m.mu.Unlock()
	deviceReasons = map[string]Reason{}
	for k, v := range m.result.DeviceReasons {
		deviceReasons[k] = v
	}
	folderReasons = map[string]Reason{}
	for k, v := range m.result.FolderReasons {
		folderReasons[k] = v
	}
	return m.running, deviceReasons, folderReasons
}

// HandleStatus reports the service as the signed in user sees it.
func (m *Manager) HandleStatus(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleStatus: r=%s", logger.RequestSummary(r))
	}
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	settings := m.store.settings()
	running, deviceReasons, folderReasons := m.snapshot()
	status := UserStatus{
		Running: running,
		Allowed: m.allowed(username, settings),
		Port:    settings.Port,
		Devices: []DeviceView{},
		Folders: []FolderView{},
		Offers:  []OfferView{},
	}
	if !status.Allowed {
		sendJSON(w, status)
		return
	}
	if running {
		status.DeviceID = m.eng.DeviceID()
		status.DeviceName = m.opt.DeviceName
	}

	folders := m.store.folders()
	mine := map[string]Folder{}
	taken := map[string]bool{}
	for _, f := range folders {
		if f.Owner == username {
			mine[f.ID] = f
			status.Folders = append(status.Folders, m.folderView(f, running, folderReasons))
		} else {
			taken[f.ID] = true
		}
	}
	for _, d := range m.store.devices() {
		if d.Owner != username {
			continue
		}
		view := m.deviceView(d, running, deviceReasons)
		status.Devices = append(status.Devices, view)
		if !running || view.Paused {
			continue
		}
		ignored := map[string]bool{}
		for _, id := range d.Ignored {
			ignored[id] = true
		}
		for _, offer := range m.eng.Offers(d.ID) {
			if ignored[offer.FolderID] {
				continue
			}
			ov := OfferView{
				DeviceID:   d.ID,
				DeviceName: d.Name,
				FolderID:   offer.FolderID,
				Label:      offer.Label,
				Time:       offer.Time.Unix(),
			}
			if f, ok := mine[offer.FolderID]; ok {
				if containsString(f.Devices, d.ID) {
					continue
				}
				ov.Existing = "mine"
			} else if taken[offer.FolderID] {
				ov.Existing = "taken"
			}
			status.Offers = append(status.Offers, ov)
		}
	}
	sort.SliceStable(status.Offers, func(i, j int) bool { return status.Offers[i].Time > status.Offers[j].Time })
	sendJSON(w, status)
}

// HandleQR returns the server's device ID as a QR code, which the Syncthing
// apps can scan when adding a device.
func (m *Manager) HandleQR(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleQR: r=%s", logger.RequestSummary(r))
	}
	if _, ok := m.currentAllowedUser(w, r); !ok {
		return
	}
	id := m.eng.DeviceID()
	if id == "" || qrCode == nil {
		http.Error(w, "Syncthing is not running", http.StatusServiceUnavailable)
		return
	}
	png, err := qrCode(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(png)
}

/* Devices */

// HandleDeviceAdd links a device to the signed in user. The login password
// has to come with it, so that a browser left open cannot be used to let
// another device into the account's drives.
func (m *Manager) HandleDeviceAdd(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleDeviceAdd: r=%s", logger.RequestSummary(r))
	}
	if !requirePost(w, r) {
		return
	}
	username, ok := m.currentAllowedUser(w, r)
	if !ok {
		return
	}
	id, err := m.eng.ParseDeviceID(postOnly(r, "id"))
	if err != nil {
		utils.SendErrorResponse(w, "This is not a valid Syncthing device ID")
		return
	}
	name, err := cleanName(postOnly(r, "name"), maxNameLength)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if name == "" {
		name = id[:7]
	}
	if self := m.eng.DeviceID(); self != "" && id == self {
		utils.SendErrorResponse(w, "This is the device ID of the server itself")
		return
	}
	if existing, found := m.store.device(id); found {
		if existing.Owner == username {
			utils.SendErrorResponse(w, "You have already added this device")
		} else {
			utils.SendErrorResponse(w, "This device is linked to another account")
		}
		return
	}
	count := 0
	for _, d := range m.store.devices() {
		if d.Owner == username {
			count++
		}
	}
	if count >= maxDevicesPerUser {
		utils.SendErrorResponse(w, "You have reached the limit of "+strconv.Itoa(maxDevicesPerUser)+" devices")
		return
	}
	if !m.opt.ConfirmPassword(w, r) {
		return
	}
	device := Device{ID: id, Owner: username, Name: name, Added: time.Now().Unix(), Ignored: []string{}}
	if err := m.store.putDevice(device); err != nil {
		utils.SendErrorResponse(w, "The device could not be saved")
		return
	}
	logger.PrintAndLog(logTitle, username+" linked the Syncthing device "+name+" ("+id+")", nil)
	m.changed()
	utils.SendOK(w)
}

// ownDevice returns a device of the signed in user named in the request.
func (m *Manager) ownDevice(w http.ResponseWriter, r *http.Request, username string) (Device, bool) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.ownDevice: r=%s username=%.120q", logger.RequestSummary(r), username)
	}
	id, err := m.eng.ParseDeviceID(postOnly(r, "id"))
	if err == nil {
		if d, found := m.store.device(id); found && d.Owner == username {
			return d, true
		}
	}
	utils.SendErrorResponse(w, "Device not found")
	return Device{}, false
}

// HandleDeviceEdit renames or pauses one of the user's devices.
func (m *Manager) HandleDeviceEdit(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleDeviceEdit: r=%s", logger.RequestSummary(r))
	}
	if !requirePost(w, r) {
		return
	}
	username, ok := m.currentAllowedUser(w, r)
	if !ok {
		return
	}
	d, ok := m.ownDevice(w, r, username)
	if !ok {
		return
	}
	if r.PostForm.Has("name") {
		name, err := cleanName(r.PostForm.Get("name"), maxNameLength)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		if name != "" {
			d.Name = name
		}
	}
	if r.PostForm.Has("paused") {
		d.Paused = r.PostForm.Get("paused") == "true"
	}
	if err := m.store.putDevice(d); err != nil {
		utils.SendErrorResponse(w, "The device could not be saved")
		return
	}
	m.changed()
	utils.SendOK(w)
}

// HandleDeviceRemove unlinks one of the user's devices. The files it synced
// stay where they are.
func (m *Manager) HandleDeviceRemove(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleDeviceRemove: r=%s", logger.RequestSummary(r))
	}
	if !requirePost(w, r) {
		return
	}
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	//Removing is allowed after the access went away too
	d, ok := m.ownDevice(w, r, username)
	if !ok {
		return
	}
	m.removeDevice(d)
	logger.PrintAndLog(logTitle, username+" removed the Syncthing device "+d.Name+" ("+d.ID+")", nil)
	utils.SendOK(w)
}

func (m *Manager) removeDevice(d Device) {
	logger.Debug("fileservers/servers/syncthingserv", "Manager.removeDevice")
	m.store.deleteDevice(d.ID)
	m.store.removeDeviceFromFolders(d.ID)
	m.changed()
}

/* Folders */

// folderInput is what the add and edit forms send.
type folderInput struct {
	Label       string
	Mode        string
	VersionDays int
	Devices     []string
}

func (m *Manager) readFolderInput(r *http.Request, username string, current *Folder) (folderInput, error) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.readFolderInput: r=%s username=%.120q", logger.RequestSummary(r), username)
	}
	in := folderInput{Mode: ModeBackup}
	if current != nil {
		in = folderInput{Label: current.Label, Mode: current.Mode, VersionDays: current.VersionDays, Devices: current.Devices}
	}
	r.ParseForm()
	if current == nil || r.PostForm.Has("label") {
		label, err := cleanName(r.PostForm.Get("label"), maxLabelLength)
		if err != nil {
			return in, err
		}
		if label != "" || current == nil {
			in.Label = label
		}
	}
	if mode := r.PostForm.Get("mode"); mode != "" {
		if !validMode(mode) {
			return in, errors.New("Unknown folder mode")
		}
		in.Mode = mode
	}
	if v := r.PostForm.Get("versiondays"); v != "" {
		days, err := strconv.Atoi(v)
		if err != nil || days < 0 || days > MaxVersionDays {
			return in, errors.New("Keep old versions for 0 to " + strconv.Itoa(MaxVersionDays) + " days")
		}
		in.VersionDays = days
	}
	if current == nil || r.PostForm.Has("devices") {
		list, err := postList(r, "devices")
		if err != nil {
			return in, err
		}
		in.Devices = []string{}
		for _, raw := range list {
			id, err := m.eng.ParseDeviceID(raw)
			if err != nil {
				return in, errors.New("This is not a valid Syncthing device ID: " + raw)
			}
			d, found := m.store.device(id)
			if !found || d.Owner != username {
				return in, errors.New("A folder can only be shared with your own devices")
			}
			if !containsString(in.Devices, id) {
				in.Devices = append(in.Devices, id)
			}
		}
	}
	return in, nil
}

// HandleFolderAdd syncs a folder of the user's drives. With an id, it
// accepts a folder one of the user's devices offered.
func (m *Manager) HandleFolderAdd(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleFolderAdd: r=%s", logger.RequestSummary(r))
	}
	if !requirePost(w, r) {
		return
	}
	username, ok := m.currentAllowedUser(w, r)
	if !ok {
		return
	}
	in, err := m.readFolderInput(r, username, nil)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	id := strings.TrimSpace(r.PostForm.Get("id"))
	if id == "" {
		id = newFolderID()
		for _, found := m.store.folder(id); found; _, found = m.store.folder(id) {
			id = newFolderID()
		}
	} else if !validFolderID(id) {
		utils.SendErrorResponse(w, "This folder ID cannot be used")
		return
	} else if existing, found := m.store.folder(id); found {
		if existing.Owner == username {
			utils.SendErrorResponse(w, "You already sync this folder. Share it with the device instead")
		} else {
			utils.SendErrorResponse(w, "The server already has a folder with this ID. Give the folder another ID on your device and share it again")
		}
		return
	}

	vpath := strings.TrimSpace(r.PostForm.Get("path"))
	if vpath == "" || !strings.Contains(vpath, ":/") {
		utils.SendErrorResponse(w, "Pick a folder in your drives")
		return
	}
	count := 0
	for _, f := range m.store.folders() {
		if f.Owner == username {
			count++
		}
	}
	if count >= maxFoldersPerUser {
		utils.SendErrorResponse(w, "You have reached the limit of "+strconv.Itoa(maxFoldersPerUser)+" folders")
		return
	}
	loc, err := m.opt.ResolveFolder(username, vpath, true)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if err := m.checkOverlap(loc.RealPath, ""); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if in.Label == "" {
		in.Label = path.Base(strings.TrimRight(strings.ReplaceAll(vpath, "\\", "/"), "/"))
		if in.Label == "" || in.Label == "." || strings.HasSuffix(in.Label, ":") {
			in.Label = id
		}
	}

	folder := Folder{
		ID:          id,
		Owner:       username,
		Label:       in.Label,
		Path:        vpath,
		Mode:        in.Mode,
		VersionDays: in.VersionDays,
		Devices:     in.Devices,
		Added:       time.Now().Unix(),
	}
	if err := m.store.putFolder(folder); err != nil {
		utils.SendErrorResponse(w, "The folder could not be saved")
		return
	}
	logger.PrintAndLog(logTitle, username+" syncs "+vpath+" as Syncthing folder "+id, nil)
	m.changed()
	sendJSON(w, folder.ID)
}

// checkOverlap refuses a path that is, holds or is inside another folder.
func (m *Manager) checkOverlap(realPath, exceptID string) error {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.checkOverlap: realPath=%.120q exceptID=%.120q", realPath, exceptID)
	}
	m.mu.Lock()
	known := make(map[string]string, len(m.lastPath))
	for id, p := range m.lastPath {
		known[id] = p
	}
	m.mu.Unlock()
	for _, f := range m.store.folders() {
		if f.ID == exceptID {
			continue
		}
		other, ok := known[f.ID]
		if !ok {
			//Not seen since the boot, while Syncthing was off
			if loc, err := m.opt.ResolveFolder(f.Owner, f.Path, false); err == nil {
				other = loc.RealPath
			}
		}
		if pathsOverlap(realPath, other) {
			return errors.New("This folder is, holds or is inside a folder Syncthing already syncs. Pick another one")
		}
	}
	return nil
}

// ownFolder returns a folder of the signed in user named in the request.
func (m *Manager) ownFolder(w http.ResponseWriter, r *http.Request, username string) (Folder, bool) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.ownFolder: r=%s username=%.120q", logger.RequestSummary(r), username)
	}
	id := postOnly(r, "id")
	if f, found := m.store.folder(id); found && f.Owner == username {
		return f, true
	}
	utils.SendErrorResponse(w, "Folder not found")
	return Folder{}, false
}

// HandleFolderEdit changes the label, mode, versioning, devices or pause of
// one of the user's folders. A folder cannot move: remove it and add it
// again at the other place.
func (m *Manager) HandleFolderEdit(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleFolderEdit: r=%s", logger.RequestSummary(r))
	}
	if !requirePost(w, r) {
		return
	}
	username, ok := m.currentAllowedUser(w, r)
	if !ok {
		return
	}
	f, ok := m.ownFolder(w, r, username)
	if !ok {
		return
	}
	in, err := m.readFolderInput(r, username, &f)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	f.Label, f.Mode, f.VersionDays, f.Devices = in.Label, in.Mode, in.VersionDays, in.Devices
	if r.PostForm.Has("paused") {
		f.Paused = r.PostForm.Get("paused") == "true"
	}
	if err := m.store.putFolder(f); err != nil {
		utils.SendErrorResponse(w, "The folder could not be saved")
		return
	}
	m.changed()
	utils.SendOK(w)
}

// HandleFolderRemove stops syncing one of the user's folders. Its files stay.
func (m *Manager) HandleFolderRemove(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleFolderRemove: r=%s", logger.RequestSummary(r))
	}
	if !requirePost(w, r) {
		return
	}
	username, err := m.opt.CurrentUser(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	f, ok := m.ownFolder(w, r, username)
	if !ok {
		return
	}
	m.removeFolder(f)
	logger.PrintAndLog(logTitle, username+" stopped syncing "+f.Path+" (Syncthing folder "+f.ID+")", nil)
	utils.SendOK(w)
}

func (m *Manager) removeFolder(f Folder) {
	logger.Debug("fileservers/servers/syncthingserv", "Manager.removeFolder")
	m.store.deleteFolder(f.ID)
	m.mu.Lock()
	delete(m.lastPath, f.ID)
	m.mu.Unlock()
	m.changed()
}

// HandleFolderRescan looks for changes in one of the user's folders now.
func (m *Manager) HandleFolderRescan(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleFolderRescan: r=%s", logger.RequestSummary(r))
	}
	if !requirePost(w, r) {
		return
	}
	username, ok := m.currentAllowedUser(w, r)
	if !ok {
		return
	}
	f, ok := m.ownFolder(w, r, username)
	if !ok {
		return
	}
	if !m.IsEnabled() {
		utils.SendErrorResponse(w, "Syncthing is not running")
		return
	}
	if err := m.eng.Rescan(f.ID); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleOfferIgnore turns down a folder one of the user's devices offered.
func (m *Manager) HandleOfferIgnore(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleOfferIgnore: r=%s", logger.RequestSummary(r))
	}
	if !requirePost(w, r) {
		return
	}
	username, ok := m.currentAllowedUser(w, r)
	if !ok {
		return
	}
	d, ok := m.ownDevice(w, r, username)
	if !ok {
		return
	}
	folderID := postOnly(r, "folder")
	if !validFolderID(folderID) {
		utils.SendErrorResponse(w, "This folder ID cannot be used")
		return
	}
	if !containsString(d.Ignored, folderID) {
		d.Ignored = append(d.Ignored, folderID)
	}
	if err := m.store.putDevice(d); err != nil {
		utils.SendErrorResponse(w, "The device could not be saved")
		return
	}
	m.changed()
	utils.SendOK(w)
}

/* Admin */

// AdminConfig is what the settings page shows.
type AdminConfig struct {
	Running   bool
	DeviceID  string
	LastError string
	Settings  Settings
	AllGroups []string
}

// HandleConfig reads or changes the settings.
func (m *Manager) HandleConfig(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleConfig: r=%s", logger.RequestSummary(r))
	}
	if r.Method != http.MethodPost {
		m.mu.Lock()
		config := AdminConfig{Running: m.running, LastError: m.lastError}
		m.mu.Unlock()
		config.DeviceID = m.eng.DeviceID()
		config.Settings = m.store.settings()
		config.AllGroups = []string{}
		if m.opt.ListGroups != nil {
			config.AllGroups = m.opt.ListGroups()
		}
		sendJSON(w, config)
		return
	}

	settings := m.store.settings()
	if v := postOnly(r, "port"); v != "" {
		port, err := strconv.Atoi(v)
		if err != nil || port < 1 || port > 65535 {
			utils.SendErrorResponse(w, "The port must be a number from 1 to 65535")
			return
		}
		settings.Port = port
	}
	flag := func(key string, current bool) bool {
		if !r.PostForm.Has(key) {
			return current
		}
		return r.PostForm.Get(key) == "true"
	}
	settings.GlobalDiscovery = flag("global", settings.GlobalDiscovery)
	settings.LocalDiscovery = flag("local", settings.LocalDiscovery)
	settings.Relays = flag("relays", settings.Relays)
	settings.NAT = flag("nat", settings.NAT)
	if r.PostForm.Has("groups") {
		groups, err := postList(r, "groups")
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		known := map[string]bool{}
		if m.opt.ListGroups != nil {
			for _, g := range m.opt.ListGroups() {
				known[g] = true
			}
		}
		settings.Groups = []string{}
		for _, g := range groups {
			if known[g] && !containsString(settings.Groups, g) {
				settings.Groups = append(settings.Groups, g)
			}
		}
	}
	if err := m.store.setSettings(settings); err != nil {
		utils.SendErrorResponse(w, "The settings could not be saved")
		return
	}
	if err := m.changed(); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// AdminOverview lists every device and folder, and devices nobody added.
type AdminOverview struct {
	Running bool
	Devices []DeviceView
	Folders []FolderView
	Unknown []UnknownDevice
}

// HandleOverview lists what every user syncs.
func (m *Manager) HandleOverview(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleOverview: r=%s", logger.RequestSummary(r))
	}
	running, deviceReasons, folderReasons := m.snapshot()
	overview := AdminOverview{Running: running, Devices: []DeviceView{}, Folders: []FolderView{}, Unknown: []UnknownDevice{}}
	for _, d := range m.store.devices() {
		view := m.deviceView(d, running, deviceReasons)
		view.Owner = d.Owner
		overview.Devices = append(overview.Devices, view)
	}
	for _, f := range m.store.folders() {
		view := m.folderView(f, running, folderReasons)
		view.Owner = f.Owner
		overview.Folders = append(overview.Folders, view)
	}
	if running {
		overview.Unknown = m.eng.UnknownDevices()
	}
	sendJSON(w, overview)
}

// HandleAdminRemove removes any user's device or folder.
func (m *Manager) HandleAdminRemove(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "Manager.HandleAdminRemove: r=%s", logger.RequestSummary(r))
	}
	if !requirePost(w, r) {
		return
	}
	id := postOnly(r, "id")
	switch postOnly(r, "kind") {
	case "device":
		d, found := m.store.device(id)
		if !found {
			utils.SendErrorResponse(w, "Device not found")
			return
		}
		m.removeDevice(d)
		logger.PrintAndLog(logTitle, "An admin removed the Syncthing device "+d.Name+" of "+d.Owner, nil)
	case "folder":
		f, found := m.store.folder(id)
		if !found {
			utils.SendErrorResponse(w, "Folder not found")
			return
		}
		m.removeFolder(f)
		logger.PrintAndLog(logTitle, "An admin stopped the Syncthing folder "+f.Path+" of "+f.Owner, nil)
	default:
		utils.SendErrorResponse(w, "Unknown kind")
		return
	}
	utils.SendOK(w)
}

func containsString(list []string, value string) bool {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncthingserv", "containsString: len(list)=%d value=%.120q", len(list), value)
	}
	for _, v := range list {
		if v == value {
			return true
		}
	}
	return false
}
