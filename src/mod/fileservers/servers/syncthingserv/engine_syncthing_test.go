//go:build !(linux && mipsle) && !(windows && arm) && !(windows && 386)

package syncthingserv

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/syncthing/syncthing/lib/config"
	stfs "github.com/syncthing/syncthing/lib/fs"
	"github.com/syncthing/syncthing/lib/protocol"
)

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// quietSettings keep the test device off the internet and the LAN.
func quietSettings(t *testing.T) Settings {
	return Settings{Port: freePort(t), Groups: []string{}}
}

func waitFor(t *testing.T, what string, timeout time.Duration, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestEngineRunsSyncthingAsThePlanSays(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "syncthing")
	folderDir := filepath.Join(t.TempDir(), "Phone")
	if err := os.MkdirAll(folderDir, 0755); err != nil {
		t.Fatal(err)
	}
	phone := protocol.NewDeviceID([]byte("test phone")).String()
	other := protocol.NewDeviceID([]byte("test laptop")).String()

	eng := newEngine().(*stEngine)
	cfg := engineConfig{Dir: stateDir, Name: "ArozOS test", Settings: quietSettings(t)}
	p := plan{
		Devices: []planDevice{{ID: phone, Name: "Phone"}, {ID: other, Name: "Laptop", Paused: true, Ignored: []string{"old-one"}}},
		Folders: []planFolder{{ID: "abcde-fghij", Label: "Camera", Path: folderDir, Mode: ModeBackup, VersionDays: 7, Devices: []string{phone}}},
	}
	if err := eng.Start(cfg, p); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer eng.Stop()

	myID := eng.DeviceID()
	if _, err := eng.ParseDeviceID(myID); err != nil {
		t.Fatalf("device ID %q: %v", myID, err)
	}

	raw := eng.cfg.RawCopy()
	if raw.GUI.Enabled {
		t.Errorf("the Syncthing GUI and REST API are on")
	}
	o := raw.Options
	if o.URAccepted != -1 || o.CREnabled || o.AutoUpgradeIntervalH != 0 || o.SetLowPriority || o.GlobalAnnEnabled || o.LocalAnnEnabled || o.RelaysEnabled || o.NATEnabled {
		t.Errorf("options not locked down: %+v", o)
	}
	if !slices.Equal(o.RawListenAddresses, listenAddresses(cfg.Settings)) {
		t.Errorf("listen addresses = %v", o.RawListenAddresses)
	}
	if len(raw.Folders) != 1 {
		t.Fatalf("folders = %d, want 1", len(raw.Folders))
	}
	f := raw.Folders[0]
	if f.Type != config.FolderTypeReceiveOnly || !f.IgnoreDelete || string(f.FilesystemType) != fsTypeArozOS || !f.IgnorePerms {
		t.Errorf("folder = type %v ignoreDelete %v fs %v", f.Type, f.IgnoreDelete, f.FilesystemType)
	}
	if f.Versioning.Type != "trashcan" || f.Versioning.Params["cleanoutDays"] != "7" {
		t.Errorf("versioning = %+v", f.Versioning)
	}
	sharedWith := []string{}
	for _, d := range f.Devices {
		sharedWith = append(sharedWith, d.DeviceID.String())
	}
	if !slices.Contains(sharedWith, phone) || !slices.Contains(sharedWith, myID) || slices.Contains(sharedWith, other) {
		t.Errorf("folder shared with %v", sharedWith)
	}
	for _, d := range raw.Devices {
		if d.Introducer || d.AutoAcceptFolders {
			t.Errorf("device %s may introduce or auto accept", d.Name)
		}
		if d.DeviceID.String() == other && (!d.Paused || len(d.IgnoredFolders) != 1) {
			t.Errorf("paused device = %+v", d)
		}
	}

	//Applying the same plan again changes nothing, so no folder restarts
	before := eng.cfg.RawCopy()
	if err := eng.Apply(cfg, p); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if after := eng.cfg.RawCopy(); !reflect.DeepEqual(before, after) {
		t.Errorf("applying the same plan again changed the configuration")
	}

	waitFor(t, "the folder to be scanned", 60*time.Second, func() bool {
		return eng.FolderStatus("abcde-fghij").State == "idle"
	})
	if _, err := os.Stat(filepath.Join(folderDir, ".stfolder")); err != nil {
		t.Errorf("folder marker missing: %v", err)
	}
	if err := eng.Rescan("abcde-fghij"); err != nil {
		t.Errorf("rescan: %v", err)
	}
	if bytes, ok := eng.LocalBytes("abcde-fghij"); !ok || bytes != 0 {
		t.Errorf("local bytes = %d, %v", bytes, ok)
	}

	//Changes reach Syncthing
	p.Folders[0].Mode = ModeTwoWay
	p.Folders[0].VersionDays = 0
	p.Folders[0].Paused = true
	if err := eng.Apply(cfg, p); err != nil {
		t.Fatalf("apply: %v", err)
	}
	f = eng.cfg.RawCopy().Folders[0]
	if f.Type != config.FolderTypeSendReceive || f.IgnoreDelete || f.Versioning.Type != "" || !f.Paused {
		t.Errorf("changed folder = type %v ignoreDelete %v versioning %q paused %v", f.Type, f.IgnoreDelete, f.Versioning.Type, f.Paused)
	}
	waitFor(t, "the folder to pause", 30*time.Second, func() bool {
		return eng.FolderStatus("abcde-fghij").State == "paused"
	})

	//A folder dropped from the plan leaves Syncthing
	p.Folders = nil
	eng.Apply(cfg, p)
	if n := len(eng.cfg.RawCopy().Folders); n != 0 {
		t.Errorf("folders after removal = %d", n)
	}

	//The device keeps its ID across restarts
	eng.Stop()
	if eng.DeviceID() != "" {
		t.Errorf("a stopped engine still reports a device ID")
	}
	if err := eng.Start(cfg, p); err != nil {
		t.Fatalf("restart: %v", err)
	}
	if got := eng.DeviceID(); got != myID {
		t.Errorf("device ID changed across a restart: %s, was %s", got, myID)
	}
}

func TestNoSymlinkFilesystem(t *testing.T) {
	dir := t.TempDir()
	fs := stfs.NewFilesystem(stfs.FilesystemType(fsTypeArozOS), dir)
	if err := fs.CreateSymlink("/", "escape"); !errors.Is(err, errSymlink) {
		t.Fatalf("CreateSymlink = %v, want it refused", err)
	}
	if _, err := os.Lstat(filepath.Join(dir, "escape")); !os.IsNotExist(err) {
		t.Fatalf("a symbolic link was created")
	}
	file, err := fs.Create("photo.jpg")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	file.Write([]byte("data"))
	file.Close()
	if info, err := fs.Stat("photo.jpg"); err != nil || info.Size() != 4 {
		t.Fatalf("stat = %v, %v", info, err)
	}
	if fs.Type() != stfs.FilesystemTypeBasic {
		t.Errorf("type = %v, versions must still go to a basic filesystem", fs.Type())
	}
}

func TestLogBridgeLevels(t *testing.T) {
	h := slog.Default().Handler()
	if _, ok := h.(*slogBridge); !ok {
		t.Fatalf("slog default is %T, want the bridge to the system log", h)
	}
	if h.Enabled(context.Background(), slog.LevelDebug) {
		t.Errorf("debug records reach the system log")
	}
	if !h.Enabled(context.Background(), slog.LevelWarn) {
		t.Errorf("warnings do not reach the system log")
	}
	//Attributes and groups must not panic
	slog.New(h).WithGroup("g").With("k", 1).Info("bridge test", "x", "y")
}

func TestApplyHelpersKeepSyncthingsOwnEntries(t *testing.T) {
	when := time.Unix(1700000000, 0)
	current := []config.ObservedFolder{{ID: "a", Time: when}, {ID: "b", Time: when}}
	if got := ignoredFolders(current, []string{"b", "a"}); !reflect.DeepEqual(got, current) {
		t.Errorf("the same set was rewritten: %v", got)
	}
	got := ignoredFolders(current, []string{"a", "c"})
	if len(got) != 2 || got[0].ID != "a" || got[0].Time != when || got[1].ID != "c" {
		t.Errorf("swap = %v", got)
	}

	v := config.VersioningConfiguration{Type: "trashcan", Params: map[string]string{"cleanoutDays": "30"}, CleanupIntervalS: 3600}
	same := v
	setVersioning(&v, 30)
	if !reflect.DeepEqual(v, same) {
		t.Errorf("same versioning rewritten: %+v", v)
	}
	setVersioning(&v, 0)
	if v.Type != "" || v.Params == nil {
		t.Errorf("off = %+v, want no type and an empty (not nil) map", v)
	}
}
