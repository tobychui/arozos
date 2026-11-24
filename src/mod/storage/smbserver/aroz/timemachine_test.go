package aroz

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/tobychui/smbsrv"
	"imuslab.com/arozos/mod/filesystem"
)

func TestTimeMachineEligible(t *testing.T) {
	tests := []struct {
		name  string
		setup func(fsh *filesystem.FileSystemHandler)
		level string
		want  bool
	}{
		{"writable local drive", nil, "rw", true},
		{"read only for the user", nil, "r", false},
		{"no access", nil, "", false},
		{"read only drive", func(f *filesystem.FileSystemHandler) { f.ReadOnly = true }, "rw", false},
		{"closed drive", func(f *filesystem.FileSystemHandler) { f.Closed = true }, "rw", false},
		{"cloud drive", func(f *filesystem.FileSystemHandler) { f.RequireBuffer = true }, "rw", false},
		{"network drive", func(f *filesystem.FileSystemHandler) { f.Filesystem = "webdav" }, "rw", false},
		{"tmp is emptied at boot", func(f *filesystem.FileSystemHandler) { f.UUID = "tmp" }, "rw", false},
		{"drive named like the share", func(f *filesystem.FileSystemHandler) { f.UUID = "timemachine" }, "rw", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fsh, _ := drive(t, "data", "public")
			if tt.setup != nil {
				tt.setup(fsh)
			}
			account := &fakeAccount{levels: map[string]string{fsh.UUID: tt.level}}
			if got := TimeMachineEligible(fsh, account); got != tt.want {
				t.Errorf("TimeMachineEligible = %v, want %v", got, tt.want)
			}
		})
	}
	if TimeMachineEligible(nil, &fakeAccount{}) {
		t.Error("no drive is not eligible")
	}
}

// loginWithTimeMachine logs in with a Time Machine pick.
func loginWithTimeMachine(t *testing.T, account *fakeAccount, pick string, maxSize uint64, ok bool) smbsrv.UserView {
	t.Helper()
	b, err := New(Options{
		Credentials: noCredentials{},
		LookupUser:  func(string) (Account, Quota, error) { return account, nil, nil },
		TimeMachine: func(username string) (string, uint64, bool) {
			if username != "alice" {
				t.Errorf("asked for %q", username)
			}
			return pick, maxSize, ok
		},
		UseTrash: func() bool { return true },
		Trash: func(*filesystem.FileSystemHandler, string, string, string) error {
			t.Error("a Time Machine file went to the trash bin")
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	v, err := b.Login("alice")
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func findShare(v smbsrv.UserView, name string) smbsrv.Share {
	for _, s := range v.Shares() {
		if s.Name() == name {
			return s
		}
	}
	return nil
}

// TestTimeMachineShare checks where backups land: a folder of the picked
// drive, per user on a drive others use too.
func TestTimeMachineShare(t *testing.T) {
	tests := []struct {
		name      string
		hierarchy string
		folder    string //Of the backups, inside the drive
	}{
		{"own user drive", "user", "Time Machine"},
		{"shared drive", "public", "Time Machine/alice"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fsh, _ := drive(t, "data", tt.hierarchy)
			account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"data": "rw"}}
			v := loginWithTimeMachine(t, account, "data", 5<<30, true)
			if len(v.Shares()) != 2 {
				t.Fatalf("want the drive and the TimeMachine share, got %d", len(v.Shares()))
			}
			s := findShare(v, TimeMachineShareName)
			if s == nil {
				t.Fatal("no TimeMachine share")
			}
			tm, ok := s.(smbsrv.TimeMachineShare)
			if !ok {
				t.Fatal("not a smbsrv.TimeMachineShare")
			}
			if on, max := tm.TimeMachine(); !on || max != 5<<30 {
				t.Errorf("TimeMachine() = %v, %d", on, max)
			}
			plain := findShare(v, "data")
			if plain.Key() == s.Key() {
				t.Error("the drive share and the Time Machine share must have different keys")
			}
			if on, _ := plain.(smbsrv.TimeMachineShare).TimeMachine(); on {
				t.Error("the drive itself is not a Time Machine share")
			}

			if err := s.Mkdir("Mac.sparsebundle"); err != nil {
				t.Fatalf("mkdir: %v", err)
			}
			f, err := s.Open("Mac.sparsebundle/Info.plist", os.O_RDWR|os.O_CREATE)
			if err != nil {
				t.Fatalf("open: %v", err)
			}
			f.WriteAt([]byte("plist"), 0)
			if err := f.Sync(); err != nil {
				t.Errorf("sync: %v", err)
			}
			f.Close()

			real, err := fsh.FileSystemAbstraction.VirtualPathToRealPath("data:/"+tt.folder+"/Mac.sparsebundle/Info.plist", "alice")
			if err != nil {
				t.Fatal(err)
			}
			if b, err := os.ReadFile(real); err != nil || string(b) != "plist" {
				t.Errorf("backup not at %s: %q %v", real, b, err)
			}
			list, err := s.ReadDir("")
			if err != nil || len(list) != 1 || list[0].Name != "Mac.sparsebundle" {
				t.Errorf("share root lists %v, %v", list, err)
			}
			//Old backups are deleted for good, the trash bin is not asked
			if err := s.Remove("Mac.sparsebundle/Info.plist"); err != nil {
				t.Errorf("remove: %v", err)
			}
			if _, err := os.Stat(real); !os.IsNotExist(err) {
				t.Errorf("still there: %v", err)
			}
		})
	}
}

func TestNoTimeMachineShare(t *testing.T) {
	tests := []struct {
		name  string
		pick  string
		ok    bool
		level string
		extra string //Another drive's id
	}{
		{"nothing picked", "", true, "rw", ""},
		{"feature off", "data", false, "rw", ""},
		{"drive gone", "photos", true, "rw", ""},
		{"no longer writable", "data", true, "r", ""},
		{"a drive has the share's name", "data", true, "rw", "TimeMachine"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fsh, _ := drive(t, "data", "public")
			account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"data": tt.level}}
			if tt.extra != "" {
				other, _ := drive(t, tt.extra, "public")
				account.fshs = append(account.fshs, other)
				account.levels[tt.extra] = "rw"
			}
			v := loginWithTimeMachine(t, account, tt.pick, 0, tt.ok)
			for _, s := range v.Shares() {
				if on, _ := s.(smbsrv.TimeMachineShare).TimeMachine(); on {
					t.Errorf("share %s offered for Time Machine", s.Name())
				}
			}
		})
	}
}

// TestTimeMachineFolderIsConfined checks that a link inside the Time Machine
// folder cannot reach the rest of the drive.
func TestTimeMachineFolderIsConfined(t *testing.T) {
	fsh, dir := drive(t, "data", "public")
	os.WriteFile(filepath.Join(dir, "secret.txt"), []byte("x"), 0644)
	tmDir := filepath.Join(dir, "Time Machine", "alice")
	os.MkdirAll(tmDir, 0755)
	if err := os.Symlink(filepath.Join(dir, "secret.txt"), filepath.Join(tmDir, "link")); err != nil {
		t.Skip("no symlinks here:", err)
	}
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"data": "rw"}}
	s := findShare(loginWithTimeMachine(t, account, "data", 0, true), TimeMachineShareName)
	if s == nil {
		t.Fatal("no TimeMachine share")
	}
	if _, err := s.Open("link", os.O_RDONLY); err == nil {
		t.Error("a link out of the Time Machine folder was followed")
	}
}
