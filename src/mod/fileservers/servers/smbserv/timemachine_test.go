package smbserv

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"

	"imuslab.com/arozos/mod/storage/smbserver/aroz"
)

func timeMachineStatus(t *testing.T, r *rig, form url.Values) (TimeMachineStatus, string) {
	t.Helper()
	var w = get(r.m.HandleTimeMachine)
	if form != nil {
		w = post(r.m.HandleTimeMachine, form)
	}
	if msg := errorOf(w); msg != "" {
		return TimeMachineStatus{}, msg
	}
	var status TimeMachineStatus
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("status %s: %v", w.Body.String(), err)
	}
	return status, ""
}

func setApple(t *testing.T, r *rig, port int, on bool, limitGB string) {
	t.Helper()
	form := url.Values{"port": {strconv.Itoa(port)}, "apple": {"false"}, "tmlimit": {limitGB}}
	if on {
		form.Set("apple", "true")
	}
	isOK(t, post(r.m.HandleConfig, form))
}

func TestTimeMachineIsOffByDefault(t *testing.T) {
	r := newRig(t)
	status, msg := timeMachineStatus(t, r, nil)
	if msg != "" || status.Enabled || status.Drive != "" {
		t.Errorf("status %+v %q", status, msg)
	}
	if _, msg := timeMachineStatus(t, r, url.Values{"drive": {"media"}}); msg == "" {
		t.Error("a drive was picked with macOS support off")
	}
	if drive, _, ok := r.m.timeMachinePick("alice"); ok || drive != "" {
		t.Errorf("pick %q %v", drive, ok)
	}
}

func TestTimeMachinePick(t *testing.T) {
	r := newRig(t)
	port := running(t, r)
	setApple(t, r, port, true, "2")

	status, msg := timeMachineStatus(t, r, nil)
	if msg != "" || !status.Enabled || status.LimitGB != 2 || status.ShareName != aroz.TimeMachineShareName {
		t.Fatalf("status %+v %q", status, msg)
	}
	if !reflect.DeepEqual(status.Drives, []ShareRow{{Name: "media", Comment: "Media"}}) {
		t.Errorf("drives %+v", status.Drives)
	}
	if _, msg := timeMachineStatus(t, r, url.Values{"drive": {"elsewhere"}}); msg == "" {
		t.Error("a drive the user does not have was accepted")
	}
	if r.m.wantTimeMachineAnnouncement() {
		t.Error("announced before anyone picked a drive")
	}

	status, msg = timeMachineStatus(t, r, url.Values{"drive": {"media"}})
	if msg != "" || status.Drive != "media" || status.Folder != "media:/Time Machine/alice" {
		t.Fatalf("after picking: %+v %q", status, msg)
	}
	if drive, max, ok := r.m.timeMachinePick("alice"); !ok || drive != "media" || max != 2<<30 {
		t.Errorf("pick %q %d %v", drive, max, ok)
	}
	if !r.m.wantTimeMachineAnnouncement() {
		t.Error("not announced after a drive was picked")
	}

	status, msg = timeMachineStatus(t, r, url.Values{"drive": {""}})
	if msg != "" || status.Drive != "" || r.m.wantTimeMachineAnnouncement() {
		t.Errorf("after clearing: %+v %q", status, msg)
	}
}

// TestTimeMachineOverSMB backs up the way a Mac does: into the TimeMachine
// share, which reports the size limit and keeps the files in the user's
// folder of the picked drive.
func TestTimeMachineOverSMB(t *testing.T) {
	r := newRig(t)
	port := running(t, r)
	setApple(t, r, port, true, "1")
	isOK(t, activate(r, "login", "a good password"))
	if _, msg := timeMachineStatus(t, r, url.Values{"drive": {"media"}}); msg != "" {
		t.Fatal(msg)
	}

	s, nc, err := dialAs(t, port, "alice", "a good password")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer nc.Close()
	names, err := s.ListSharenames()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, n := range names {
		found = found || n == aroz.TimeMachineShareName
	}
	if !found {
		t.Fatalf("no TimeMachine share in %v", names)
	}
	share, err := s.Mount(aroz.TimeMachineShareName)
	if err != nil {
		t.Fatalf("mount: %v", err)
	}
	defer share.Umount()
	if err := share.MkdirAll("Mac.sparsebundle/bands", 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := share.WriteFile("Mac.sparsebundle/bands/0", make([]byte, 4096), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := os.Stat(filepath.Join(r.dir, "Time Machine", "alice", "Mac.sparsebundle", "bands", "0")); err != nil {
		t.Errorf("the backup is not in the user's folder: %v", err)
	}
	fs, err := share.Statfs("Mac.sparsebundle")
	if err != nil {
		t.Fatalf("statfs: %v", err)
	}
	//go-smb2 calls a sector a block, and sectors per unit the fragment size
	if total := fs.TotalBlockCount() * fs.FragmentSize() * fs.BlockSize(); total != 1<<30 {
		t.Errorf("size %d, want the 1 GB limit", total)
	}

	//Turning macOS support off takes the share away
	setApple(t, r, port, false, "1")
	s2, nc2, err := dialAs(t, port, "alice", "a good password")
	if err != nil {
		t.Fatal(err)
	}
	defer nc2.Close()
	if _, err := s2.Mount(aroz.TimeMachineShareName); err == nil {
		t.Error("the TimeMachine share is still there with macOS support off")
	}
}

func TestTimeMachineLimitSetting(t *testing.T) {
	r := newRig(t)
	port := freePort(t)
	for _, bad := range []string{"-1", "lots", "1.5", "99999999999"} {
		w := post(r.m.HandleConfig, url.Values{"port": {strconv.Itoa(port)}, "apple": {"true"}, "tmlimit": {bad}})
		if errorOf(w) == "" {
			t.Errorf("limit %q was accepted", bad)
		}
	}
	isOK(t, post(r.m.HandleConfig, url.Values{"port": {strconv.Itoa(port)}, "apple": {"true"}, "tmlimit": {"500"}}))
	var config AdminConfig
	json.Unmarshal(get(r.m.HandleConfig).Body.Bytes(), &config)
	if !config.Apple || config.TimeMachineGB != 500 {
		t.Errorf("config %+v", config)
	}
	//A form without the field keeps the limit
	isOK(t, post(r.m.HandleConfig, url.Values{"port": {strconv.Itoa(port)}, "apple": {"true"}}))
	if got := r.m.timeMachineLimitGB(); got != 500 {
		t.Errorf("limit %d after a form without it", got)
	}
}

func TestParseTimeMachineLimit(t *testing.T) {
	tests := []struct {
		in   string
		want int64
		ok   bool
	}{
		{"0", 0, true},
		{" 750 ", 750, true},
		{"-1", 0, false},
		{"", 0, false},
		{"2T", 0, false},
		{"1073741825", 0, false},
	}
	for _, tt := range tests {
		got, ok := parseTimeMachineLimit(tt.in)
		if got != tt.want || ok != tt.ok {
			t.Errorf("parseTimeMachineLimit(%q) = %d, %v", tt.in, got, ok)
		}
	}
}

func TestTimeMachineRecords(t *testing.T) {
	want := []string{"sys=adVF=0x100", "dk0=adVN=TimeMachine,adVF=0x82"}
	if got := timeMachineRecords(); !reflect.DeepEqual(got, want) {
		t.Errorf("records %v, want %v", got, want)
	}
}
