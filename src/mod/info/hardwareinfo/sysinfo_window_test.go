//go:build windows

package hardwareinfo

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// The Windows handlers answer from the Win32 API; these check the JSON the
// Host Info page reads.

func callHandler(t *testing.T, handler http.HandlerFunc, out interface{}) {
	t.Helper()
	w := httptest.NewRecorder()
	handler(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
		t.Fatalf("response %q is not the expected JSON: %v", w.Body.String(), err)
	}
}

func TestWindowsCPUInfo(t *testing.T) {
	info := CPUInfo{}
	callHandler(t, GetCPUInfo, &info)
	if info.Model == "Undefined" || info.Instruction == "Undefined" {
		t.Errorf("GetCPUInfo = %+v, want the processor name and identifier", info)
	}
}

func TestWindowsDriveStat(t *testing.T) {
	drives := []LogicalDisk{}
	callHandler(t, GetDriveStat, &drives)
	system := os.Getenv("SystemDrive")
	if system == "" {
		t.Skip("SystemDrive is not set")
	}
	for _, d := range drives {
		if strings.EqualFold(d.DriveLetter, system) {
			if d.FileSystem == "" || d.FreeSpace == "" {
				t.Errorf("system drive = %+v, want its file system and free space", d)
			}
			return
		}
	}
	t.Errorf("GetDriveStat = %+v, want the system drive %s", drives, system)
}

func TestWindowsRamInfo(t *testing.T) {
	var installed int64
	callHandler(t, GetRamInfo, &installed)
	if installed <= 0 {
		t.Errorf("GetRamInfo = %d, want the installed memory", installed)
	}
}

func TestWindowsListsAreArrays(t *testing.T) {
	for name, handler := range map[string]http.HandlerFunc{"Ifconfig": Ifconfig, "GetUSB": GetUSB} {
		list := []string{}
		callHandler(t, handler, &list)
		if list == nil {
			t.Errorf("%s answered null, want a JSON array", name)
		}
	}
}
